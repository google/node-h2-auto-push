import * as cookie from 'cookie';
import * as express from 'express';
import * as fs from 'fs';
import * as http2 from 'http2';
import * as path from 'path';

import {AssetCache, AssetCacheConfig} from './asset-cache';
import {ClientCacheChecker} from './client-cache-checker';

export {AssetCacheConfig} from './asset-cache';

type Request = express.Request&http2.Http2ServerRequest;
type Response = express.Response&http2.Http2ServerResponse;

// TODO(jinwoo): Tune these default parameters.
const DEFAULT_CACHE_CONFIG: AssetCacheConfig = {
  warmupDuration: 500,
  promotionRatio: 0.8,
  demotionRatio: 0.2,
  minimumRequests: 1,
};

const CACHE_COOKIE_KEY = '__ap_cache__';

export class AutoPush {
  private readonly assetCache: AssetCache;
  private rootDir: string|null = null;

  constructor(cacheConfig: AssetCacheConfig = DEFAULT_CACHE_CONFIG) {
    this.assetCache = new AssetCache(cacheConfig);
  }

  private setCookie(
      headers: http2.OutgoingHttpHeaders, name: string, value: string): void {
    const prev = headers['set-cookie'];
    let newCookies = prev;
    // Set as a session cookie for now.
    // TODO(jinwoo): Consider making this persistent across sessions.
    const c = cookie.serialize(name, value);
    if (Array.isArray(prev)) {
      newCookies = [...prev, c];
    } else if (typeof prev === 'string') {
      newCookies = [prev, c];
    } else {
      newCookies = c;
    }
    headers['set-cookie'] = newCookies;
  }

  private addCacheHeaders(
      headers: http2.OutgoingHttpHeaders, assetPath: string, stats: fs.Stats,
      cacheChecker: ClientCacheChecker): void {
    headers['cache-control'] = 'public, max-age=0';
    headers['last-modified'] = stats.mtime.toUTCString();

    cacheChecker.addPath(assetPath);
    this.setCookie(headers, CACHE_COOKIE_KEY, cacheChecker.serialize());
  }

  static(root: string): express.RequestHandler {
    this.rootDir = root;
    return (req: Request, res: Response, next: express.NextFunction): void => {
      const cookies = cookie.parse(req.header('cookie') || '');
      const cacheKey = cookies[CACHE_COOKIE_KEY];
      const cacheChecker = cacheKey ? ClientCacheChecker.deserialize(cacheKey) :
                                      new ClientCacheChecker();

      const reqPath = req.path;
      const stream = req.stream;
      stream.respondWithFile(path.join(root, reqPath), undefined, {
        statCheck: (stats, headers) => {
          // Piggy-back on statCheck() to record this path as a static
          // resource.
          this.assetCache.recordRequestPath(stream.session, reqPath, true);

          const ifModifiedSinceHeader = req.headers['if-modified-since'];
          const ifModifiedSince = typeof ifModifiedSinceHeader === 'string' ?
              Date.parse(ifModifiedSinceHeader) :
              null;
          if (ifModifiedSince !== null &&
              stats.mtime.getTime() <= ifModifiedSince) {
            stream.respond({':status': 304});
            return false;
          }
          this.addCacheHeaders(headers, reqPath, stats, cacheChecker);
          return true;
        },
        onError: (err) => {
          // Not a valid file. Record this path as a non-static resource.
          this.assetCache.recordRequestPath(stream.session, reqPath, false);
          next();
        },
      });

      if (stream.pushAllowed) this.autoPush(stream, req, res, cacheChecker);
    };
  }

  private autoPush(
      stream: http2.ServerHttp2Stream, req: Request, res: Response,
      cacheChecker: ClientCacheChecker) {
    // Do not auto-push more than the TCP congestion window (cwnd) size.
    // effectiveLocalWindowSize doesn't seem to reflect the actual network
    // status. But at least it gives some reasonable value we can use.
    // FIXME: The response size of the original request must also be
    // considered but there's no easy way to know that. Ignore for now.
    const windowSize = stream.session.state.effectiveLocalWindowSize;
    let pushedSize = 0;
    for (const asset of this.assetCache.getAssetsForPath(req.path)) {
      if (cacheChecker.mayHavePath(asset)) {
        console.log(`client may have ${asset}. skip auto-push.`);
        continue;
      }
      if (windowSize && pushedSize > windowSize) break;
      stream.pushStream({':path': asset}, pushStream => {
        if (!this.rootDir) throw new Error('Not mounted on a directory');
        pushStream.respondWithFile(path.join(this.rootDir, asset), undefined, {
          statCheck: (stats, headers) => {
            if (windowSize && pushedSize + stats.size > windowSize) {
              pushStream.rstWithCancel();
              return false;
            }
            pushedSize += stats.size;
            // TODO(jinwoo): The cache cookie value can be overridden by later
            // values. Fix.
            this.addCacheHeaders(headers, asset, stats, cacheChecker);
            return true;
          },
          onError: (err) => {
            console.log(err);
            pushStream.end();
          },
        });
      });
    }
  }
}

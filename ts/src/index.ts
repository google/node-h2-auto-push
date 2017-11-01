import * as cookie from 'cookie';
import * as express from 'express';
import * as fs from 'fs';
import * as http2 from 'http2';
import * as path from 'path';
import {promisify} from 'util';

const fsStat = promisify(fs.stat);

import {AssetCache, AssetCacheConfig} from './asset-cache';
import {ClientCacheChecker} from './client-cache-checker';

export {AssetCacheConfig} from './asset-cache';

type h2Request = express.Request&http2.Http2ServerRequest;
type h2Response = express.Response&http2.Http2ServerResponse;

type Request = express.Request|h2Request;
type Response = express.Response|h2Response;

function isH2Request(req: Request): req is h2Request {
  return !!(req as h2Request).stream;
}

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

  private getRootDir(): string {
    if (!this.rootDir) throw new Error('Root directory is not set');
    return this.rootDir;
  }

  private addCacheHeaders(headers: http2.OutgoingHttpHeaders, stats: fs.Stats):
      void {
    headers['cache-control'] = 'public, max-age=0';
    headers['last-modified'] = stats.mtime.toUTCString();
  }

  private async getAutoPushList(
      reqPath: string, stream: http2.ServerHttp2Stream,
      cacheChecker: ClientCacheChecker): Promise<string[]> {
    // Do not auto-push more than the TCP congestion window (cwnd) size.
    // effectiveLocalWindowSize doesn't seem to reflect the actual network
    // status. But at least it gives some reasonable value we can use.
    // FIXME: The response size of the original request must also be
    // considered but there's no easy way to know that. Ignore for now.
    const windowSize = stream.session.state.effectiveLocalWindowSize;
    let pushedSize = 0;
    const result: string[] = [];
    for (const asset of this.assetCache.getAssetsForPath(reqPath)) {
      if (cacheChecker.mayHavePath(asset)) {
        continue;
      }
      if (windowSize && pushedSize > windowSize) break;
      const stats = await fsStat(path.join(this.getRootDir(), asset));
      if (windowSize && pushedSize + stats.size > windowSize) {
        continue;
      }
      result.push(asset);
      cacheChecker.addPath(asset);
      pushedSize += stats.size;
    }
    return result;
  }

  static(root: string): express.RequestHandler {
    this.rootDir = root;
    return async(
               req: Request, res: Response,
               next: express.NextFunction): Promise<void> => {
      if (!isH2Request(req)) {
        throw new Error('auto-push middleware can only be used with http2');
      }

      const cookies = cookie.parse(req.header('cookie') || '');
      const cacheKey = cookies[CACHE_COOKIE_KEY];
      const cacheChecker = cacheKey ? ClientCacheChecker.deserialize(cacheKey) :
                                      new ClientCacheChecker();
      const reqPath = req.path;
      const stream = req.stream;

      // Calculate the auto-push list before sending the response to be able to
      // set the bloom filter cookie correctly that contains the auto-pushed
      // assets as well as the original asset. Otherwise we'll auto-push assets
      // that browser already has in future responses.
      const autoPushList = stream.pushAllowed ?
          await this.getAutoPushList(reqPath, stream, cacheChecker) :
          null;
      cacheChecker.addPath(reqPath);
      const cacheCookieValue = cacheChecker.serialize();
      // TODO(jinwoo): Consider making this persistent across sessions.
      res.cookie(CACHE_COOKIE_KEY, cacheCookieValue);

      res.sendFile(path.join(root, reqPath), (err: NodeJS.ErrnoException) => {
        if (err) {
          if (err.code === 'ENOENT') {
            this.assetCache.recordRequestPath(stream.session, reqPath, false);
          }
          next();
          return;
        }
        this.assetCache.recordRequestPath(stream.session, reqPath, true);
      });

      if (autoPushList) {
        this.autoPush(autoPushList, stream);
      }
    };
  }

  private autoPush(autoPushList: string[], stream: http2.ServerHttp2Stream) {
    for (const asset of autoPushList) {
      stream.pushStream({':path': asset}, pushStream => {
        pushStream.respondWithFile(
            path.join(this.getRootDir(), asset), undefined, {
              statCheck: (stats, headers) => {
                this.addCacheHeaders(headers, stats);
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

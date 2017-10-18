import * as express from 'express';
import * as fs from 'fs';
import * as http2 from 'http2';
import * as path from 'path';

import {AssetCache} from './asset-cache';
import {AssetCacheConfig} from './asset-cache';

export {AssetCacheConfig} from './asset-cache';

type Request = express.Request&http2.Http2ServerRequest;
type Response = express.Response&http2.Http2ServerResponse;

const DEFAULT_CACHE_CONFIG: AssetCacheConfig = {
  warmupDuration: 500,
  promotionRatio: 0.8,
  demotionRatio: 0.2,
  minimumRequests: 1,
};

export class AutoPush {
  private readonly assetCache: AssetCache;

  constructor(cacheConfig: AssetCacheConfig = DEFAULT_CACHE_CONFIG) {
    this.assetCache = new AssetCache(cacheConfig);
  }

  static(root: string): express.RequestHandler {
    return (req: Request, res: Response, next: express.NextFunction): void => {
      const reqPath = req.path;
      const stream = req.stream;
      stream.respondWithFile(path.join(root, reqPath), undefined, {
        getTrailers: (trailers) => {
          // Piggy-back on getTrailers() to record this path as a static
          // resource.
          this.assetCache.recordRequestPath(stream.session, reqPath, true);
        },
        onError: (err) => {
          // Not a valid file. Record this path as a non-static resource.
          this.assetCache.recordRequestPath(stream.session, reqPath, false);
          next();
        },
      });

      // Auto-push related assets.
      for (const asset of this.assetCache.getAssetsForPath(reqPath)) {
        stream.pushStream({':path': asset}, pushStream => {
          pushStream.respondWithFile(path.join(root, asset));
        });
      }
    };
  }
}

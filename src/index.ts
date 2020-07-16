// Copyright 2017 Google LLC.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from 'fs';
import http2 from 'http2';
import {lookup} from 'mime-types';
import path from 'path';
import {promisify} from 'util';

const fsStat = promisify(fs.stat);

import {AssetCache, AssetCacheConfig} from './asset-cache';
import {ClientCacheChecker} from './client-cache-checker';

export {AssetCacheConfig} from './asset-cache';

type PushStreamCallback = (pushStream: http2.ServerHttp2Stream) => void;

// TODO(jinwoo): Tune these default parameters.
const DEFAULT_CACHE_CONFIG: AssetCacheConfig = {
  warmupDuration: 500,
  promotionRatio: 0.8,
  demotionRatio: 0.2,
  minimumRequests: 1,
};

export interface PreprocessResult {
  newCacheCookie: string;
  pushFn: () => Promise<void>;
}

export class AutoPush {
  private readonly assetCache: AssetCache;

  constructor(
    private readonly rootDir: string,
    cacheConfig: AssetCacheConfig = DEFAULT_CACHE_CONFIG
  ) {
    this.assetCache = new AssetCache(cacheConfig);
  }

  private addCacheHeaders(
    headers: http2.OutgoingHttpHeaders,
    stats: fs.Stats,
    filePath: string
  ): void {
    headers['content-type'] = lookup(filePath) as string;
    headers['cache-control'] = 'public, max-age=0';
    headers['last-modified'] = stats.mtime.toUTCString();
  }

  recordRequestPath(
    session: http2.Http2Session,
    reqPath: string,
    isStatic: boolean
  ): void {
    this.assetCache.recordRequestPath(session, reqPath, isStatic);
  }

  async preprocessRequest(
    reqPath: string,
    stream: http2.ServerHttp2Stream,
    cacheCookie?: string
  ): Promise<PreprocessResult> {
    const cacheChecker = cacheCookie
      ? ClientCacheChecker.deserialize(cacheCookie)
      : new ClientCacheChecker();
    // Calculate the auto-push list before sending the response to be able to
    // set the bloom filter cookie correctly that contains the auto-pushed
    // assets as well as the original asset. Otherwise we'll auto-push assets
    // that browser already has in future responses.
    const pushList = await this.getAutoPushList(reqPath, stream, cacheChecker);
    cacheChecker.addPath(reqPath);
    const newCacheCookie = cacheChecker.serialize();
    return {
      newCacheCookie,
      pushFn: () => this.push(stream, pushList),
    };
  }

  private async getAutoPushList(
    reqPath: string,
    stream: http2.ServerHttp2Stream,
    cacheChecker: ClientCacheChecker
  ): Promise<string[]> {
    const result: string[] = [];
    if (!stream.pushAllowed) return result;

    // Do not auto-push more than the window size. Use remoteWindowSize, which
    // designates the remote window size for a connection, which means the
    // amount of data we can send without window size update.
    // FIXME: The response size of the original request must also be considered.
    // Ignore for now.
    const windowSize = stream.session.state.remoteWindowSize;
    if (!windowSize) return result;

    let pushedSize = 0;
    for (const asset of this.assetCache.getAssetsForPath(reqPath)) {
      if (cacheChecker.mayHavePath(asset)) {
        continue;
      }
      if (pushedSize > windowSize) break;
      try {
        const stats = await fsStat(path.join(this.rootDir, asset));
        if (pushedSize + stats.size > windowSize) {
          continue;
        }
        result.push(asset);
        cacheChecker.addPath(asset);
        pushedSize += stats.size;
      } catch (err) {
        // fsStat() failed, just skip.
      }
    }
    return result;
  }

  private async push(
    stream: http2.ServerHttp2Stream,
    pushList: string[]
  ): Promise<void> {
    const pushPromises = pushList.map(
      (asset): Promise<void> => {
        return new Promise((resolve, reject) => {
          const pushFile = (pushStream: http2.ServerHttp2Stream): void => {
            const filePath = path.join(this.rootDir, asset);
            const onFinish = () => {
              pushStream.removeListener('error', onError);
              resolve();
            };
            const onError = (err: Error) => {
              stream.emit('pushError', err);

              pushStream.removeListener('finish', onFinish);
              pushStream.end();
              reject(err);
            };
            pushStream.once('error', onError);
            pushStream.once('finish', onFinish);

            pushStream.respondWithFile(filePath, undefined, {
              statCheck: (stats, headers) => {
                this.addCacheHeaders(headers, stats, filePath);
              },
              onError: err => {
                pushStream.removeListener('error', onError);
                onError(err);
              },
            });
          };
          stream.pushStream(
            {':path': asset, 'content-type': lookup(asset) as string},
            (err, pushStream) => {
              if (err) {
                return reject(err);
              }
              pushFile(pushStream);
            }
          );
        });
      }
    );
    await Promise.all(pushPromises);
  }
}

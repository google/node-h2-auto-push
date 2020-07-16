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

import {BloomFilter} from 'bloomfilter';

const FALSE_POSITIVE_RATE = 0.01;
const LOG2_1_ERROR = Math.log2(1 / FALSE_POSITIVE_RATE);
const K = Math.round(LOG2_1_ERROR);

export class ClientCacheChecker {
  private readonly bf: BloomFilter;

  constructor(maxNumPaths: number | BloomFilter = 100) {
    if (typeof maxNumPaths === 'number') {
      this.bf = new BloomFilter(this.calculateM(maxNumPaths), K);
    } else {
      this.bf = maxNumPaths;
    }
  }

  private calculateM(maxNumPaths: number): number {
    return Math.ceil((maxNumPaths * LOG2_1_ERROR) / Math.log(2));
  }

  addPath(path: string): void {
    this.bf.add(path);
  }

  mayHavePath(path: string): boolean {
    return this.bf.test(path);
  }

  serialize(): string {
    return Buffer.from(this.bf.buckets.buffer as ArrayBuffer).toString(
      'base64'
    );
  }

  static deserialize(str: string): ClientCacheChecker {
    const buf = Buffer.from(str, 'base64');
    const buckets = new Int32Array(
      buf.buffer,
      buf.byteOffset,
      buf.length / Int32Array.BYTES_PER_ELEMENT
    );
    return new ClientCacheChecker(new BloomFilter(buckets, K));
  }
}

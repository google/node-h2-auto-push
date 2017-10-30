/// <reference path="./bloomfilter.d.ts"/>
import {BloomFilter} from 'bloomfilter';

const FALSE_POSITIVE_RATE = 0.01;
const LOG2_1_ERROR = Math.log2(1 / FALSE_POSITIVE_RATE);
const K = Math.round(LOG2_1_ERROR);

export class ClientCacheChecker {
  private readonly bf: BloomFilter;

  constructor(maxNumPaths: number|BloomFilter = 100) {
    if (typeof maxNumPaths === 'number') {
      this.bf = new BloomFilter(this.calculateM(maxNumPaths), K);
    } else {
      this.bf = maxNumPaths;
    }
  }

  private calculateM(maxNumPaths: number): number {
    return Math.ceil(maxNumPaths * LOG2_1_ERROR / Math.log(2));
  }

  addPath(path: string): void {
    this.bf.add(path);
  }

  mayHavePath(path: string): boolean {
    return this.bf.test(path);
  }

  serialize(): string {
    return Buffer.from(this.bf.buckets.buffer as ArrayBuffer)
        .toString('base64');
  }

  static deserialize(str: string): ClientCacheChecker {
    const buf = Buffer.from(str, 'base64');
    const buckets = new Int32Array(
        buf.buffer, buf.byteOffset, buf.length / Int32Array.BYTES_PER_ELEMENT);
    return new ClientCacheChecker(new BloomFilter(buckets, K));
  }
}

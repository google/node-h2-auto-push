/// <reference path="./bloomfilter.d.ts"/>
import {BloomFilter} from 'bloomfilter';

export class ClientCacheChecker {
  private readonly bf: BloomFilter;

  constructor(maxNumPaths: number|BloomFilter = 100, falsePositiveRate = 0.01) {
    if (typeof maxNumPaths === 'number') {
      const log2p = Math.log2(1 / falsePositiveRate);
      const m = Math.ceil(maxNumPaths * log2p / Math.log(2));
      const k = Math.round(log2p);
      this.bf = new BloomFilter(m, k);
    } else {
      this.bf = maxNumPaths;
    }
  }

  addPath(path: string): void {
    this.bf.add(path);
  }

  test(path: string): boolean {
    return this.bf.test(path);
  }

  serialize(): string {
    const buf = Buffer.from(this.bf.buckets.buffer);
    return buf.toString('base64');
  }

  deserialize(str: string): ClientCacheChecker {
    const buf = Buffer.from(str, 'base64');
    const buckets = new Int32Array(
        buf.buffer, buf.byteOffset, buf.length / Int32Array.BYTES_PER_ELEMENT);
    const bf = new BloomFilter(buckets, this.bf.k);
    return new ClientCacheChecker(bf);
  }
}

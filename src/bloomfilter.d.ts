declare module 'bloomfilter' {
  export class BloomFilter {
    constructor(m: number, k: number);
    constructor(buf: ArrayLike<number>, k: number);
    buckets: Int32Array;
    add(value: any): void;
    test(value: any): boolean;
    m: number;
    k: number;
  }
}

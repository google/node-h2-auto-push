import * as http2 from 'http2';

const EMPTY_ASSETS: ReadonlyArray<string> = Object.freeze([]);

type RelatedPaths = Set<string>;

export interface AssetCacheConfig {
  warmupDuration: number;
  promotionRatio: number;
  demotionRatio: number;
  minimumRequests: number;
}

interface WarmingMetricsEntry {
  successes: number;
  total: number;
  readonly paths: RelatedPaths;
}

function setEqual<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && [...a].every(value => b.has(value));
}

export class AssetCache {
  private readonly sessionMap: WeakMap<http2.Http2Session, RelatedPaths> =
      new WeakMap();
  private readonly warmingMetrics: Map<string, WarmingMetricsEntry> = new Map();
  private readonly assetMap: Map<string, RelatedPaths> = new Map();

  constructor(private readonly config: AssetCacheConfig) {}

  recordRequestPath(
      session: http2.Http2Session, path: string, isStatic: boolean): void {
    if (this.assetMap.has(path)) return;

    if (session) {
      const entry = this.sessionMap.get(session);
      if (!entry) {
        this.sessionMap.set(session, new Set());
        setTimeout(() => this.onWarm(path, session), this.config.warmupDuration);
      } else if (isStatic) {
        // Only static resources are auto-pushed.
        entry.add(path);
      }
    }
  }

  getAssetsForPath(path: string): Set<string> {
    const assets = this.assetMap.get(path);
    return new Set<string>(assets || EMPTY_ASSETS);
  }

  private onWarm(path: string, session: http2.Http2Session): void {
    if (this.assetMap.has(path)) return;

    const sessionMapEntry = this.sessionMap.get(session);
    this.sessionMap.delete(session);  // delete for future records
    if (sessionMapEntry === undefined) {
      console.warn('Session does not exist. Already deleted?');
      return;
    }

    let warmingMetricsEntry = this.warmingMetrics.get(path);
    if (warmingMetricsEntry === undefined) {
      warmingMetricsEntry = {successes: 0, total: 0, paths: sessionMapEntry};
      this.warmingMetrics.set(path, warmingMetricsEntry);
    }
    if (setEqual(sessionMapEntry, warmingMetricsEntry.paths)) {
      warmingMetricsEntry.successes++;
    }
    warmingMetricsEntry.total++;
    if (warmingMetricsEntry.total < this.config.minimumRequests) return;

    const ratio = warmingMetricsEntry.successes / warmingMetricsEntry.total;
    if (ratio >= this.config.promotionRatio) {
      this.assetMap.set(path, warmingMetricsEntry.paths);
      this.warmingMetrics.delete(path);
    } else if (ratio <= this.config.demotionRatio) {
      // Try again with the current set of paths, this may be brittle
      this.warmingMetrics.set(
          path, {successes: 1, total: 1, paths: sessionMapEntry});
    }
  }
}

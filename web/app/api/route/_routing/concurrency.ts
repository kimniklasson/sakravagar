export type RouteConcurrencySnapshot = {
  activeTotal: number;
  activeForKey: number;
  maxTotal: number;
  maxPerKey: number;
};

type RouteConcurrencyConfig = {
  maxTotal: number;
  maxPerKey: number;
  retryAfterSeconds: number;
};

export class RouteConcurrencyLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly snapshot: RouteConcurrencySnapshot;

  constructor(snapshot: RouteConcurrencySnapshot, retryAfterSeconds: number) {
    super("too many active route requests");
    this.name = "RouteConcurrencyLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.snapshot = snapshot;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isRouteConcurrencyLimitError(error: unknown): error is RouteConcurrencyLimitError {
  return error instanceof RouteConcurrencyLimitError;
}

export function createRouteConcurrencyLimiter(config: RouteConcurrencyConfig) {
  let activeTotal = 0;
  const activeByKey = new Map<string, number>();

  const snapshot = (key: string): RouteConcurrencySnapshot => ({
    activeTotal,
    activeForKey: activeByKey.get(key) ?? 0,
    maxTotal: config.maxTotal,
    maxPerKey: config.maxPerKey,
  });

  const release = (key: string) => {
    activeTotal = Math.max(0, activeTotal - 1);
    const nextForKey = Math.max(0, (activeByKey.get(key) ?? 1) - 1);
    if (nextForKey === 0) {
      activeByKey.delete(key);
    } else {
      activeByKey.set(key, nextForKey);
    }
  };

  return {
    snapshot,
    async run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const current = snapshot(key);
      if (current.activeTotal >= config.maxTotal || current.activeForKey >= config.maxPerKey) {
        throw new RouteConcurrencyLimitError(current, config.retryAfterSeconds);
      }

      activeTotal += 1;
      activeByKey.set(key, current.activeForKey + 1);
      try {
        return await task();
      } finally {
        release(key);
      }
    },
  };
}

export const routeConcurrencyLimiter = createRouteConcurrencyLimiter({
  maxTotal: envInt("ROUTE_MAX_CONCURRENT_TOTAL", 8),
  maxPerKey: envInt("ROUTE_MAX_CONCURRENT_PER_IP", 3),
  retryAfterSeconds: envInt("ROUTE_CONCURRENCY_RETRY_AFTER_SECONDS", 10),
});

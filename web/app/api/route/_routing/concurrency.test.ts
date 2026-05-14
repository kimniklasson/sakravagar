import { describe, expect, it } from "vitest";
import {
  createRouteConcurrencyLimiter,
  isRouteConcurrencyLimitError,
} from "./concurrency";

describe("route concurrency limiter", () => {
  it("limits active requests per key", async () => {
    const limiter = createRouteConcurrencyLimiter({
      maxTotal: 10,
      maxPerKey: 1,
      retryAfterSeconds: 7,
    });
    let releaseFirst = () => {};

    const first = limiter.run("ip-a", () => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));

    await expect(limiter.run("ip-a", async () => "blocked")).rejects.toMatchObject({
      retryAfterSeconds: 7,
      snapshot: {
        activeForKey: 1,
        activeTotal: 1,
        maxPerKey: 1,
        maxTotal: 10,
      },
    });

    releaseFirst();
    await first;
    await expect(limiter.run("ip-a", async () => "ok")).resolves.toBe("ok");
  });

  it("limits active requests globally and releases slots on errors", async () => {
    const limiter = createRouteConcurrencyLimiter({
      maxTotal: 1,
      maxPerKey: 3,
      retryAfterSeconds: 5,
    });
    let releaseFirst = () => {};
    const first = limiter.run("ip-a", () => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));

    const blocked = await limiter.run("ip-b", async () => "blocked").catch((error: unknown) => error);
    expect(isRouteConcurrencyLimitError(blocked)).toBe(true);
    if (isRouteConcurrencyLimitError(blocked)) {
      expect(blocked.snapshot).toMatchObject({ activeTotal: 1, activeForKey: 0 });
    }

    releaseFirst();
    await first;
    await expect(limiter.run("ip-b", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await expect(limiter.run("ip-b", async () => "released")).resolves.toBe("released");
  });
});

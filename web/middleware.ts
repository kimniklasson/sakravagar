import { NextRequest, NextResponse } from "next/server";

type RateLimitRule = {
  id: string;
  windowMs: number;
  max: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;
let pruneCounter = 0;

const endpointRules: Record<string, Partial<Record<string, RateLimitRule[]>>> = {
  "/api/geocode": {
    GET: [
      { id: "geocode-minute", windowMs: 60_000, max: 40 },
      { id: "geocode-hour", windowMs: 60 * 60_000, max: 400 },
    ],
  },
  "/api/route": {
    POST: [
      { id: "route-minute", windowMs: 60_000, max: 30 },
    ],
  },
  "/api/route-feedback": {
    POST: [
      { id: "feedback-ten-minute", windowMs: 10 * 60_000, max: 20 },
      { id: "feedback-day", windowMs: 24 * 60 * 60_000, max: 80 },
    ],
    DELETE: [
      { id: "feedback-ten-minute", windowMs: 10 * 60_000, max: 20 },
      { id: "feedback-day", windowMs: 24 * 60 * 60_000, max: 80 },
    ],
  },
  "/api/route-shares": {
    POST: [
      { id: "share-ten-minute", windowMs: 10 * 60_000, max: 12 },
      { id: "share-day", windowMs: 24 * 60 * 60_000, max: 60 },
    ],
  },
};

function clientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function pruneExpiredBuckets(now: number) {
  pruneCounter += 1;
  if (pruneCounter % 100 !== 0 && buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now || buckets.size > MAX_BUCKETS) {
      buckets.delete(key);
    }
  }
}

function hitBucket(key: string, rule: RateLimitRule, now: number): Bucket {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + rule.windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  existing.count += 1;
  return existing;
}

export function middleware(req: NextRequest) {
  const methodRules = endpointRules[req.nextUrl.pathname]?.[req.method];
  if (!methodRules?.length) return NextResponse.next();

  const now = Date.now();
  pruneExpiredBuckets(now);
  const ip = clientIp(req);

  for (const rule of methodRules) {
    const bucket = hitBucket(`${rule.id}:${ip}`, rule, now);
    if (bucket.count > rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return NextResponse.json(
        { error: "rate limit exceeded" },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds),
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/geocode",
    "/api/route",
    "/api/route-feedback",
    "/api/route-shares",
  ],
};

import { NextResponse } from "next/server";

export type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  area: number;
};

type BboxOptions = {
  required?: boolean;
  maxArea: number;
};

const MIN_LNG = -180;
const MAX_LNG = 180;
const MIN_LAT = -90;
const MAX_LAT = 90;

export function jsonResponse<T>(
  body: T,
  init: ResponseInit & { cacheSeconds?: number } = {},
) {
  const headers = new Headers(init.headers);
  if (init.cacheSeconds && init.cacheSeconds > 0) {
    headers.set(
      "Cache-Control",
      `public, s-maxage=${init.cacheSeconds}, stale-while-revalidate=${init.cacheSeconds * 2}`,
    );
  }
  return NextResponse.json(body, { ...init, headers });
}

export function parseBboxParam(
  value: string | null,
  opts: BboxOptions,
): { bbox: Bbox | null; error: string | null } {
  if (!value) {
    return opts.required
      ? { bbox: null, error: "bbox required" }
      : { bbox: null, error: null };
  }

  const nums = value.split(",").map(Number);
  if (nums.length !== 4 || !nums.every(Number.isFinite)) {
    return { bbox: null, error: "bbox must be 4 finite numbers" };
  }

  const [minLng, minLat, maxLng, maxLat] = nums as [number, number, number, number];
  if (
    minLng < MIN_LNG ||
    maxLng > MAX_LNG ||
    minLat < MIN_LAT ||
    maxLat > MAX_LAT ||
    minLng >= maxLng ||
    minLat >= maxLat
  ) {
    return { bbox: null, error: "bbox outside valid coordinate bounds" };
  }

  const area = (maxLng - minLng) * (maxLat - minLat);
  if (area > opts.maxArea) {
    return { bbox: null, error: "bbox too large" };
  }

  return { bbox: { minLng, minLat, maxLng, maxLat, area }, error: null };
}

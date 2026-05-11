import { jsonResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL;
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "Sakravagar.se MVP geocoder (https://sakravagar.se)";

const SWEDEN_VIEWBOX = "10.5,69.5,24.5,55";
const MIN_SWEDEN_LNG = 9;
const MAX_SWEDEN_LNG = 25;
const MIN_SWEDEN_LAT = 54;
const MAX_SWEDEN_LAT = 70;
const DEFAULT_RESULT_LIMIT = 5;
const MIN_RESULT_LIMIT = 1;
const MAX_RESULT_LIMIT = 8;
const NOMINATIM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NOMINATIM_CACHE_MAX_ENTRIES = 300;
const NOMINATIM_MIN_INTERVAL_MS = Number(process.env.NOMINATIM_MIN_INTERVAL_MS ?? 1100);
const NOMINATIM_MAX_WAIT_MS = 2_500;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const nominatimCache = new Map<string, CacheEntry>();
let nextNominatimAt = 0;

export type GeocodeResult = {
  id: string;
  label: string;
  shortLabel: string;
  coordinates: [number, number];
  category: string | null;
  type: string | null;
  importance: number | null;
};

type NominatimSearchResult = {
  place_id: number | string;
  display_name: string;
  lat: string;
  lon: string;
  category?: string;
  type?: string;
  importance?: number;
  address?: Record<string, string | undefined>;
};

const MUNICIPALITY_SUFFIX = "s kommun";
const MATCH_SCORE_MIN_QUERY_LENGTH = 4;

function cleanPart(part: string | null | undefined): string | null {
  const clean = part?.trim();
  return clean ? clean : null;
}

function addressValue(
  address: Record<string, string | undefined> | undefined,
  keys: string[],
): string | null {
  if (!address) return null;
  for (const key of keys) {
    const value = cleanPart(address[key]);
    if (value) return value;
  }
  return null;
}

function placeFromAddress(address: Record<string, string | undefined> | undefined): string | null {
  const place = addressValue(address, [
    "city",
    "town",
    "village",
    "municipality",
    "suburb",
    "county",
  ]);
  return place?.endsWith(MUNICIPALITY_SUFFIX)
    ? place.slice(0, -MUNICIPALITY_SUFFIX.length)
    : place;
}

function shortLabelFor(row: NominatimSearchResult): string {
  const address = row.address;
  const displayPrimary = cleanPart(row.display_name.split(",")[0]);
  const road = addressValue(address, ["road", "pedestrian", "footway", "cycleway", "path"]);
  const houseNumber = cleanPart(address?.house_number);
  const namedPlace = addressValue(address, [
    "amenity",
    "railway",
    "shop",
    "tourism",
    "leisure",
    "building",
    "neighbourhood",
    "suburb",
  ]);
  const primary = road
    ? [road, houseNumber].filter(Boolean).join(" ")
    : displayPrimary ?? namedPlace;
  const secondary = primary === displayPrimary ? namedPlace : null;
  const place = placeFromAddress(address);

  if (!primary) return row.display_name;
  const parts = [primary, secondary, place]
    .filter((part): part is string => Boolean(part))
    .filter((part, index, arr) => arr.indexOf(part) === index);
  return parts.join(", ");
}

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9åäö\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactForSearch(value: string): string {
  return normalizeForSearch(value).replace(/[\s-]+/g, "");
}

function matchScore(result: GeocodeResult, q: string): number {
  const query = normalizeForSearch(q);
  const compactQuery = compactForSearch(q);
  const short = normalizeForSearch(result.shortLabel);
  const label = normalizeForSearch(result.label);
  const primary = normalizeForSearch(result.shortLabel.split(",")[0] ?? result.shortLabel);
  const compactShort = compactForSearch(result.shortLabel);
  const compactLabel = compactForSearch(result.label);

  if (!query || !compactQuery) return 0;
  if (primary === query) return 120;
  if (primary.startsWith(query)) return 110;
  if (compactForSearch(primary).startsWith(compactQuery)) return 105;
  if (short.startsWith(query)) return 95;
  if (compactShort.startsWith(compactQuery)) return 90;
  if (primary.includes(query)) return 80;
  if (compactForSearch(primary).includes(compactQuery)) return 75;
  if (short.includes(query)) return 65;
  if (compactShort.includes(compactQuery)) return 60;
  if (label.includes(query)) return 15;
  if (compactLabel.includes(compactQuery)) return 10;
  return 0;
}

function rankResults(results: GeocodeResult[], q: string): GeocodeResult[] {
  const scored = results.map((result, index) => ({
    result,
    index,
    score: matchScore(result, q),
  }));
  const filtered = q.trim().length >= MATCH_SCORE_MIN_QUERY_LENGTH
    ? scored.filter(({ score }) => score > 0)
    : scored;

  return filtered
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const importanceA = a.result.importance ?? 0;
      const importanceB = b.result.importance ?? 0;
      if (importanceB !== importanceA) return importanceB - importanceA;
      return a.index - b.index;
    })
    .map(({ result }) => result);
}

function isCoordinateInSwedenBounds(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= MIN_SWEDEN_LNG &&
    lng <= MAX_SWEDEN_LNG &&
    lat >= MIN_SWEDEN_LAT &&
    lat <= MAX_SWEDEN_LAT
  );
}

function parseResultLimit(value: string | null): { limit: number | null; error: string | null } {
  if (value === null || value.trim() === "") {
    return { limit: DEFAULT_RESULT_LIMIT, error: null };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { limit: null, error: "limit must be a finite number" };
  }

  return {
    limit: Math.max(MIN_RESULT_LIMIT, Math.min(MAX_RESULT_LIMIT, Math.floor(parsed))),
    error: null,
  };
}

function mapResult(row: NominatimSearchResult): GeocodeResult | null {
  const lng = Number(row.lon);
  const lat = Number(row.lat);
  if (!isCoordinateInSwedenBounds(lng, lat)) return null;

  return {
    id: String(row.place_id),
    label: row.display_name,
    shortLabel: shortLabelFor(row),
    coordinates: [lng, lat],
    category: row.category ?? null,
    type: row.type ?? null,
    importance: typeof row.importance === "number" ? row.importance : null,
  };
}

function fallbackQueryFor(q: string): string | null {
  const trimmed = q.trim();
  if (trimmed.length < 5) return null;
  const withoutTrailingFragments = trimmed
    .replace(/(sk|sko|skog|väg|väge|vägen|gat|gata|gatan)$/i, "")
    .trim();
  return withoutTrailingFragments.length >= 3 && withoutTrailingFragments !== trimmed
    ? withoutTrailingFragments
    : null;
}

function cacheKey(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

function readCache<T>(key: string): T | null {
  const entry = nominatimCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    nominatimCache.delete(key);
    return null;
  }
  nominatimCache.delete(key);
  nominatimCache.set(key, entry);
  return entry.value as T;
}

function writeCache(key: string, value: unknown) {
  if (nominatimCache.size >= NOMINATIM_CACHE_MAX_ENTRIES) {
    const oldest = nominatimCache.keys().next().value;
    if (oldest) nominatimCache.delete(oldest);
  }
  nominatimCache.set(key, {
    expiresAt: Date.now() + NOMINATIM_CACHE_TTL_MS,
    value,
  });
}

async function acquireNominatimSlot(): Promise<boolean> {
  const now = Date.now();
  const startAt = Math.max(now, nextNominatimAt);
  const waitMs = startAt - now;
  if (waitMs > NOMINATIM_MAX_WAIT_MS) return false;
  nextNominatimAt = startAt + Math.max(0, NOMINATIM_MIN_INTERVAL_MS);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return true;
}

async function searchNominatim(q: string, limit: number): Promise<NominatimSearchResult[]> {
  return fetchNominatim<NominatimSearchResult[]>("/search", new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "se",
    viewbox: SWEDEN_VIEWBOX,
    bounded: "0",
    limit: String(limit),
    q,
  }));
}

async function fetchNominatim<T>(path: string, params: URLSearchParams): Promise<T> {
  if (NOMINATIM_EMAIL) params.set("email", NOMINATIM_EMAIL);
  const key = cacheKey(path, params);
  const cached = readCache<T>(key);
  if (cached) return cached;

  const slotAcquired = await acquireNominatimSlot();
  if (!slotAcquired) {
    throw new Error("nominatim rate limited");
  }

  const url = new URL(path, NOMINATIM_BASE_URL);
  url.search = params.toString();

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "sv,en;q=0.8",
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    throw new Error(`nominatim ${res.status}: ${await res.text()}`);
  }

  const value = (await res.json()) as T;
  writeCache(key, value);
  return value;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");

  try {
    if (latParam || lngParam) {
      const lat = Number(latParam);
      const lng = Number(lngParam);
      if (!isCoordinateInSwedenBounds(lng, lat)) {
        return jsonResponse({ error: "coordinates outside Sweden bounds" }, { status: 400 });
      }

      const result = await fetchNominatim<NominatimSearchResult>("/reverse", new URLSearchParams({
        format: "jsonv2",
        addressdetails: "1",
        lat: String(lat),
        lon: String(lng),
        zoom: "18",
      }));
      const mapped = mapResult(result);
      return jsonResponse({ results: mapped ? [mapped] : [] }, { cacheSeconds: 3600 });
    }

    if (q.length < 2) {
      return jsonResponse({ results: [] }, { cacheSeconds: 60 });
    }
    if (q.length > 120) {
      return jsonResponse({ error: "query too long" }, { status: 400 });
    }

    const { limit, error: limitError } = parseResultLimit(searchParams.get("limit"));
    if (limitError || limit === null) {
      return jsonResponse({ error: limitError }, { status: 400 });
    }

    let results = await searchNominatim(q, limit);
    const fallbackQuery = fallbackQueryFor(q);
    if (results.length === 0 && fallbackQuery) {
      results = await searchNominatim(fallbackQuery, limit);
    }

    const mapped = results.map(mapResult).filter((r): r is GeocodeResult => r !== null);
    return jsonResponse({ results: rankResults(mapped, q) }, { cacheSeconds: 3600 });
  } catch (err) {
    if (err instanceof Error && err.message === "nominatim rate limited") {
      return jsonResponse({ error: "geocode rate limited" }, { status: 429 });
    }
    console.error("geocode failed", err);
    return jsonResponse({ error: "geocode failed" }, { status: 502 });
  }
}

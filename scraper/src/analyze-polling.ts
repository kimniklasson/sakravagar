// Engångsskript: utvärdera om polling-intervallet är rimligt.
// Kör från scraper/: ./node_modules/.bin/tsx --env-file=../.env src/analyze-polling.ts
//
// Vi jämför två tidsbilder:
// - observed: first_seen -> last_seen, alltså hur länge vår scraper såg händelsen.
// - declared: raw.StartTime -> raw.EndTime, alltså Trafikverkets egen tidsangivelse.
//
// declared EndTime verkar vara prognos/validitet snarare än garanterad faktisk
// borttagningstid, så rekommendationen ska väga båda bilderna.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY saknas");

const client = createClient(url, key, { auth: { persistSession: false } });

type EventRow = {
  id: string;
  first_seen: string;
  last_seen: string;
  raw: unknown;
};

const { data, error } = await client
  .from("events")
  .select("id, first_seen, last_seen, raw")
  .order("first_seen", { ascending: true });

if (error) throw new Error(error.message);
if (!data || data.length === 0) {
  console.log("Inga events i databasen än.");
  process.exit(0);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next === undefined) return sorted[base] ?? 0;
  return (sorted[base] ?? 0) + rest * (next - (sorted[base] ?? 0));
}

function getRawString(raw: unknown, key: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function minutesBetween(start: string, end: string, clampNegative = false): number | null {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const diff = (endMs - startMs) / 60_000;
  if (diff < 0) return clampNegative ? 0 : null;
  return diff;
}

const rows = data as EventRow[];

const observed = rows
  .map((r) => minutesBetween(r.first_seen, r.last_seen, true))
  .filter((m): m is number => m !== null);

const declared = rows
  .map((r) => {
    const start = getRawString(r.raw, "StartTime");
    const end = getRawString(r.raw, "EndTime");
    return start && end ? minutesBetween(start, end) : null;
  })
  .filter((m): m is number => m !== null);

const firstLag = rows
  .map((r) => {
    const start = getRawString(r.raw, "StartTime");
    return start ? minutesBetween(start, r.first_seen) : null;
  })
  .filter((m): m is number => m !== null);

const beforeDeclaredEnd = rows
  .map((r) => {
    const end = getRawString(r.raw, "EndTime");
    return end ? minutesBetween(r.last_seen, end) : null;
  })
  .filter((m): m is number => m !== null);

const seenOnce = observed.filter((m) => m < 1).length;
const seenOnceShare = seenOnce / observed.length;
const observedMedian = percentile(observed, 0.5);

// Grov bucketisering
const buckets = {
  "<1 min (single obs)": 0,
  "1–30 min": 0,
  "30–60 min": 0,
  "1–3 h": 0,
  "3–12 h": 0,
  ">12 h": 0,
};
for (const m of observed) {
  if (m < 1) buckets["<1 min (single obs)"]++;
  else if (m < 30) buckets["1–30 min"]++;
  else if (m < 60) buckets["30–60 min"]++;
  else if (m < 180) buckets["1–3 h"]++;
  else if (m < 720) buckets["3–12 h"]++;
  else buckets[">12 h"]++;
}

console.log(`Analyserade ${rows.length} events`);
console.log("");
console.log("Aktiv tid (last_seen − first_seen):");
console.log(`  p50: ${observedMedian.toFixed(1)} min`);
console.log(`  p75: ${percentile(observed, 0.75).toFixed(1)} min`);
console.log(`  p90: ${percentile(observed, 0.9).toFixed(1)} min`);
console.log(`  max: ${Math.max(...observed).toFixed(1)} min`);
console.log("");
console.log(
  `Setts endast en gång (span <1 min): ${seenOnce}/${observed.length} (${(seenOnceShare * 100).toFixed(0)}%)`
);
console.log("");
console.log("Fördelning:");
for (const [label, n] of Object.entries(buckets)) {
  const bar = "█".repeat(Math.round((n / observed.length) * 40));
  console.log(`  ${label.padEnd(22)} ${n.toString().padStart(4)}  ${bar}`);
}

if (declared.length > 0) {
  console.log("");
  console.log("Trafikverkets StartTime → EndTime:");
  console.log(`  p10: ${percentile(declared, 0.1).toFixed(1)} min`);
  console.log(`  p25: ${percentile(declared, 0.25).toFixed(1)} min`);
  console.log(`  p50: ${percentile(declared, 0.5).toFixed(1)} min`);
  console.log(`  <30 min: ${declared.filter((m) => m < 30).length}/${declared.length}`);
  console.log(`  <45 min: ${declared.filter((m) => m < 45).length}/${declared.length}`);
  console.log(`  <60 min: ${declared.filter((m) => m < 60).length}/${declared.length}`);

  console.log("");
  console.log("Relation till vår observation:");
  console.log(`  first_seen efter StartTime p50: ${percentile(firstLag, 0.5).toFixed(1)} min`);
  console.log(
    `  last_seen före deklarerad EndTime p50: ${percentile(beforeDeclaredEnd, 0.5).toFixed(1)} min`
  );

  console.log("");
  console.log("Grov fångstsannolikhet vid slumpad pollingfas, baserat på StartTime/EndTime:");
  for (const interval of [15, 30, 45, 60]) {
    const capture = declared.reduce((sum, m) => sum + Math.min(1, m / interval), 0) / declared.length;
    console.log(
      `  ${interval.toString().padStart(2)} min: ${(capture * 100).toFixed(1)}% fångst, ${(
        (1 - capture) *
        100
      ).toFixed(1)}% miss-risk`
    );
  }
}

console.log("");
console.log("Tolkning:");
if (declared.length > 0 && percentile(declared, 0.1) >= 30 && seenOnceShare <= 0.5) {
  console.log("  30 min ser rimligt ut just nu.");
  console.log("  Trafikverkets egna tider är nästan alltid längre än intervallet,");
  console.log("  och single-observation-andelen är inte alarmerande för en veckas data.");
} else if (seenOnceShare > 0.6) {
  console.log(
    "  >60% av events setts bara en gång → 30 min är troligen för glest."
  );
  console.log("  Antingen korta olyckor (ta-bort:et hinner före nästa scrape)");
  console.log("  eller helt enkelt för få scrape-körningar än för att veta.");
} else if (observedMedian > 60) {
  console.log(
    "  Median aktiv-tid >60 min → 30 min är med god marginal. Kan ev. glesas ut."
  );
} else {
  console.log("  Median i 30–60 min-spannet → 30 min är rimligt. Håll kvar.");
}
console.log("  Rekommendation: håll 30 min, kör om analysen efter ytterligare 1–2 veckor.");

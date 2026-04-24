// Engångsskript: utvärdera om polling-intervallet (30 min) är rimligt.
// Kör med: pnpm --filter @trafik/scraper exec tsx --env-file=../.env src/analyze-polling.ts
//
// Idé: för varje event tittar vi på (last_seen - first_seen) = minsta tid
// händelsen var aktiv hos Trafikverket. Om många events bara setts en gång
// (span ≈ 0) missar vi troligen korta olyckor mellan körningar.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY saknas");

const client = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await client
  .from("events")
  .select("id, first_seen, last_seen")
  .order("first_seen", { ascending: true });

if (error) throw new Error(error.message);
if (!data || data.length === 0) {
  console.log("Inga events i databasen än.");
  process.exit(0);
}

const spansMin = data.map((r) => {
  const first = new Date(r.first_seen as string).getTime();
  const last = new Date(r.last_seen as string).getTime();
  return (last - first) / 60_000;
});

const sorted = [...spansMin].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
const max = sorted[sorted.length - 1] ?? 0;
const seenOnce = spansMin.filter((m) => m < 1).length;
const seenOnceShare = seenOnce / spansMin.length;

// Grov bucketisering
const buckets = {
  "<1 min (single obs)": 0,
  "1–30 min": 0,
  "30–60 min": 0,
  "1–3 h": 0,
  "3–12 h": 0,
  ">12 h": 0,
};
for (const m of spansMin) {
  if (m < 1) buckets["<1 min (single obs)"]++;
  else if (m < 30) buckets["1–30 min"]++;
  else if (m < 60) buckets["30–60 min"]++;
  else if (m < 180) buckets["1–3 h"]++;
  else if (m < 720) buckets["3–12 h"]++;
  else buckets[">12 h"]++;
}

console.log(`Analyserade ${data.length} events`);
console.log("");
console.log("Aktiv tid (last_seen − first_seen):");
console.log(`  median: ${median.toFixed(1)} min`);
console.log(`  p75:    ${p75.toFixed(1)} min`);
console.log(`  p90:    ${p90.toFixed(1)} min`);
console.log(`  max:    ${max.toFixed(1)} min`);
console.log("");
console.log(
  `Setts endast en gång (span <1 min): ${seenOnce}/${spansMin.length} (${(seenOnceShare * 100).toFixed(0)}%)`
);
console.log("");
console.log("Fördelning:");
for (const [label, n] of Object.entries(buckets)) {
  const bar = "█".repeat(Math.round((n / spansMin.length) * 40));
  console.log(`  ${label.padEnd(22)} ${n.toString().padStart(4)}  ${bar}`);
}
console.log("");
console.log("Tolkning:");
if (seenOnceShare > 0.6) {
  console.log(
    "  >60% av events setts bara en gång → 30 min är troligen för glest."
  );
  console.log("  Antingen korta olyckor (ta-bort:et hinner före nästa scrape)");
  console.log("  eller helt enkelt för få scrape-körningar än för att veta.");
} else if (median > 60) {
  console.log(
    "  Median aktiv-tid >60 min → 30 min är med god marginal. Kan ev. glesas ut."
  );
} else {
  console.log("  Median i 30–60 min-spannet → 30 min är rimligt. Håll kvar.");
}
console.log("  Obs: få datapunkter. Kör igen om en vecka för stabilare bild.");

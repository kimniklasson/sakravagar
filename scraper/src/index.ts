import { env } from "./env.js";
import { fetchDeviations } from "./trafikverket.js";
import { makeClient, upsertEvents } from "./supabase.js";
import { deviationToRow } from "./transform.js";

async function main(): Promise<void> {
  const start = Date.now();
  const now = new Date().toISOString();

  const deviations = await fetchDeviations(env.TRAFIKVERKET_API_KEY);
  const rows = deviations
    .map((d) => deviationToRow(d, now))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const skipped = deviations.length - rows.length;

  const client = makeClient();
  const { attempted, error } = await upsertEvents(client, rows);

  const elapsed = Date.now() - start;
  const summary = {
    fetched: deviations.length,
    upserted: attempted,
    skipped_no_coord: skipped,
    elapsed_ms: elapsed,
  };

  if (error) {
    console.error("[scraper] upsert error:", error.message, summary);
    process.exit(1);
  }

  console.log("[scraper] ok", summary);

  // GitHub Actions job summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### Scraper run",
        "",
        `- fetched: **${summary.fetched}**`,
        `- upserted: **${summary.upserted}**`,
        `- skipped (no coord): ${summary.skipped_no_coord}`,
        `- elapsed: ${summary.elapsed_ms} ms`,
        "",
      ].join("\n")
    );
  }
}

main().catch((err: unknown) => {
  console.error("[scraper] fatal:", err);
  process.exit(1);
});

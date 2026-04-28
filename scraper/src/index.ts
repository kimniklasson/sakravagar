import { env } from "./env.js";
import { fetchDeviations, fetchDisturbances } from "./trafikverket.js";
import { makeClient, upsertDisturbances, upsertEvents } from "./supabase.js";
import { deviationToRow, disturbanceToRow } from "./transform.js";

async function main(): Promise<void> {
  const start = Date.now();
  const now = new Date().toISOString();

  const [deviations, disturbances] = await Promise.all([
    fetchDeviations(env.TRAFIKVERKET_API_KEY),
    fetchDisturbances(env.TRAFIKVERKET_API_KEY),
  ]);
  const rows = deviations
    .map((d) => deviationToRow(d, now))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const disturbanceRows = disturbances
    .map((d) => disturbanceToRow(d, now))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const skipped = deviations.length - rows.length;
  const skippedDisturbances = disturbances.length - disturbanceRows.length;

  const client = makeClient();
  const [{ attempted, error }, disturbanceResult] = await Promise.all([
    upsertEvents(client, rows),
    upsertDisturbances(client, disturbanceRows),
  ]);

  const elapsed = Date.now() - start;
  const summary = {
    fetched: deviations.length,
    upserted: attempted,
    skipped_no_coord: skipped,
    disturbances_fetched: disturbances.length,
    disturbances_upserted: disturbanceResult.attempted,
    disturbances_skipped_no_coord: skippedDisturbances,
    elapsed_ms: elapsed,
  };

  if (error || disturbanceResult.error) {
    console.error("[scraper] upsert error:", error?.message ?? disturbanceResult.error?.message, summary);
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
        `- disturbances fetched: **${summary.disturbances_fetched}**`,
        `- disturbances upserted: **${summary.disturbances_upserted}**`,
        `- disturbances skipped (no coord): ${summary.disturbances_skipped_no_coord}`,
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

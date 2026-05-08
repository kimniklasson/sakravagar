import { env } from "./env.js";
import { fetchSituationDeviations, fetchTrafficFlows, splitSituationDeviations } from "./trafikverket.js";
import { makeClient, upsertDisturbances, upsertEvents, upsertTrafficFlows } from "./supabase.js";
import { deviationToRow, disturbanceToRow, trafficFlowToRow } from "./transform.js";

async function main(): Promise<void> {
  const start = Date.now();
  const now = new Date().toISOString();

  const [situationDeviations, trafficFlows] = await Promise.all([
    fetchSituationDeviations(env.TRAFIKVERKET_API_KEY),
    fetchTrafficFlows(env.TRAFIKVERKET_API_KEY),
  ]);
  const { deviations, disturbances } = splitSituationDeviations(situationDeviations);
  const rows = deviations
    .map((d) => deviationToRow(d, now))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const disturbanceRows = disturbances
    .map((d) => disturbanceToRow(d, now))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const trafficFlowRows = trafficFlows
    .map((f) => trafficFlowToRow(f, now))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const skipped = deviations.length - rows.length;
  const skippedDisturbances = disturbances.length - disturbanceRows.length;
  const skippedTrafficFlows = trafficFlows.length - trafficFlowRows.length;

  const client = makeClient();
  const [{ attempted, error }, disturbanceResult, trafficFlowResult] = await Promise.all([
    upsertEvents(client, rows),
    upsertDisturbances(client, disturbanceRows),
    upsertTrafficFlows(client, trafficFlowRows),
  ]);

  const elapsed = Date.now() - start;
  const summary = {
    fetched: deviations.length,
    upserted: attempted,
    skipped_no_coord: skipped,
    disturbances_fetched: disturbances.length,
    disturbances_upserted: disturbanceResult.attempted,
    disturbances_skipped_no_coord: skippedDisturbances,
    traffic_flow_fetched: trafficFlows.length,
    traffic_flow_upserted: trafficFlowResult.attempted,
    traffic_flow_skipped_no_coord: skippedTrafficFlows,
    elapsed_ms: elapsed,
  };

  if (error || disturbanceResult.error || trafficFlowResult.error) {
    console.error(
      "[scraper] upsert error:",
      error?.message ?? disturbanceResult.error?.message ?? trafficFlowResult.error?.message,
      summary,
    );
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
        `- traffic flow fetched: **${summary.traffic_flow_fetched}**`,
        `- traffic flow upserted: **${summary.traffic_flow_upserted}**`,
        `- traffic flow skipped (no coord): ${summary.traffic_flow_skipped_no_coord}`,
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

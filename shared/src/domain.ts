export const LIVE_EVENT_THRESHOLD_MS = 90 * 60 * 1000;

export type DisturbanceCategory = "roadwork" | "traffic" | "other";

export function categoryFromDisturbanceMessageType(messageType: string | null): DisturbanceCategory {
  const text = (messageType ?? "").toLowerCase();
  if (text.includes("vägarbete") || text.includes("roadwork")) return "roadwork";
  if (text.includes("kö") || text.includes("trafik") || text.includes("queue")) return "traffic";
  return "other";
}

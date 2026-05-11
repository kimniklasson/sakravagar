import { z } from "zod";

const API_URL = "https://api.trafikinfo.trafikverket.se/v2/data.json";
const SITUATION_QUERY_LIMIT = 10_000;
const TRAFIKVERKET_REQUEST_TIMEOUT_MS = 20_000;
const TRAFIKVERKET_TRAFFIC_FLOW_TIMEOUT_MS = 25_000;

// Schema för en Deviation (en enskild händelse) i API-svaret.
// Exakta fält är dokumenterade i Trafikverkets datakatalog men kan ändras över tid —
// zod-parsningen nedan kommer att skrika tydligt om det händer, vilket är meningen.
const DeviationSchema = z
  .object({
    Id: z.string(),
    IconId: z.string().optional(),
    Message: z.string().optional(),
    MessageType: z.string().optional(),
    SeverityText: z.string().optional(),
    RoadNumber: z.string().optional(),
    CountyNo: z.array(z.number()).optional(),
    ModifiedTime: z.string().optional(),
    Geometry: z
      .object({
        WGS84: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const SituationSchema = z
  .object({
    Id: z.string(),
    Deviation: z.array(DeviationSchema).default([]),
  })
  .passthrough();

const ResponseSchema = z.object({
  RESPONSE: z.object({
    RESULT: z.array(
      z.object({
        Situation: z.array(SituationSchema).optional(),
      })
    ),
  }),
});

export type Deviation = z.infer<typeof DeviationSchema>;

const TrafficFlowSchema = z
  .object({
    SiteId: z.number(),
    MeasurementTime: z.string().optional(),
    MeasurementOrCalculationPeriod: z.number().optional(),
    VehicleType: z.string().optional(),
    VehicleFlowRate: z.number().optional(),
    AverageVehicleSpeed: z.number().optional(),
    CountyNo: z.number().optional(),
    Deleted: z.boolean().optional(),
    Geometry: z
      .object({
        WGS84: z.string().optional(),
      })
      .optional(),
    RegionId: z.number().optional(),
    DataQuality: z.string().optional(),
    SpecificLane: z.string().optional(),
    MeasurementSide: z.string().optional(),
    ModifiedTime: z.string().optional(),
  })
  .passthrough();

const TrafficFlowResponseSchema = z.object({
  RESPONSE: z.object({
    RESULT: z.array(
      z.object({
        TrafficFlow: z.array(TrafficFlowSchema).optional(),
      })
    ),
  }),
});

export type TrafficFlow = z.infer<typeof TrafficFlowSchema>;

const ALLOWED_MESSAGE_TYPES = new Set(["Olycka", "Vägarbete", "Trafikstörning"]);

function xmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildQuery(apiKey: string, messageType?: string): string {
  if (messageType && !ALLOWED_MESSAGE_TYPES.has(messageType)) {
    throw new Error(`unsupported message type: ${messageType}`);
  }
  const filter = messageType
    ? `
    <FILTER>
      <EQ name="Deviation.MessageType" value="${xmlAttribute(messageType)}" />
    </FILTER>`
    : "";

  return `<REQUEST>
  <LOGIN authenticationkey="${xmlAttribute(apiKey)}" />
  <QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="${SITUATION_QUERY_LIMIT}">
    ${filter}
  </QUERY>
</REQUEST>`;
}

async function fetchTrafikverketJson(body: string, label: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${label} ${res.status}: ${body}`);
  }

  return res.json();
}

export async function fetchSituationDeviations(apiKey: string, messageType?: string): Promise<Deviation[]> {
  const json = await fetchTrafikverketJson(
    buildQuery(apiKey, messageType),
    "Trafikverket API",
    TRAFIKVERKET_REQUEST_TIMEOUT_MS,
  );
  const parsed = ResponseSchema.parse(json);

  const situations = parsed.RESPONSE.RESULT.flatMap((r) => r.Situation ?? []);
  return situations.flatMap((s) => s.Deviation);
}

export function splitSituationDeviations(deviations: Deviation[]): {
  deviations: Deviation[];
  disturbances: Deviation[];
} {
  return {
    deviations: deviations.filter((d) => d.MessageType === "Olycka"),
    disturbances: deviations.filter((d) => d.MessageType !== "Olycka"),
  };
}

export async function fetchDeviations(apiKey: string): Promise<Deviation[]> {
  const deviations = await fetchSituationDeviations(apiKey, "Olycka");
  // API:ets filter matchar hela Situationer — andra Deviations i samma Situation
  // (t.ex. Trafikmeddelande) följer med. Filtrera ner till rena olyckor här.
  return splitSituationDeviations(deviations).deviations;
}

export async function fetchDisturbances(apiKey: string): Promise<Deviation[]> {
  const deviations = await fetchSituationDeviations(apiKey);
  // Störningar är driftinfo, inte historisk olycksdata. Vi sparar allt med
  // koordinat som inte är MessageType=Olycka i separat tabell.
  return splitSituationDeviations(deviations).disturbances;
}

export async function fetchTrafficFlows(apiKey: string): Promise<TrafficFlow[]> {
  const body = `<REQUEST>
  <LOGIN authenticationkey="${apiKey}" />
  <QUERY objecttype="TrafficFlow" namespace="Road.TrafficInfo" schemaversion="1.5" limit="10000">
    <FILTER>
      <AND>
        <EQ name="Deleted" value="false" />
        <EQ name="VehicleType" value="anyVehicle" />
      </AND>
    </FILTER>
  </QUERY>
</REQUEST>`;

  const json = await fetchTrafikverketJson(
    body,
    "Trafikverket TrafficFlow API",
    TRAFIKVERKET_TRAFFIC_FLOW_TIMEOUT_MS,
  );
  const parsed = TrafficFlowResponseSchema.parse(json);
  const flows = parsed.RESPONSE.RESULT.flatMap((r) => r.TrafficFlow ?? []);
  return flows.filter((f) => f.Deleted !== true && f.VehicleType === "anyVehicle");
}

// WGS84 i Trafikverkets svar är en WKT-sträng: "POINT (15.123 58.456)".
export function parseWgs84(wkt: string | undefined): { lng: number; lat: number } | null {
  if (!wkt) return null;
  const m = wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

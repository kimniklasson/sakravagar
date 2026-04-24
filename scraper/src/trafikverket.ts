import { z } from "zod";

const API_URL = "https://api.trafikinfo.trafikverket.se/v2/data.json";

// Schema för en Deviation (en enskild händelse) i API-svaret.
// Exakta fält är dokumenterade i Trafikverkets datakatalog men kan ändras över tid —
// zod-parsningen nedan kommer att skrika tydligt om det händer, vilket är meningen.
const DeviationSchema = z
  .object({
    Id: z.string(),
    IconId: z.string().optional(),
    Message: z.string().optional(),
    MessageType: z.string().optional(),
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

function buildQuery(apiKey: string): string {
  // MessageType "Olycka" filtrerar ner till olyckshändelser.
  // Verifiera i praktiken att fältvärdet är stavat så — annars justera.
  return `<REQUEST>
  <LOGIN authenticationkey="${apiKey}" />
  <QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="1000">
    <FILTER>
      <EQ name="Deviation.MessageType" value="Olycka" />
    </FILTER>
  </QUERY>
</REQUEST>`;
}

export async function fetchDeviations(apiKey: string): Promise<Deviation[]> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: buildQuery(apiKey),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Trafikverket API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const parsed = ResponseSchema.parse(json);

  const situations = parsed.RESPONSE.RESULT.flatMap((r) => r.Situation ?? []);
  // API:ets filter matchar hela Situationer — andra Deviations i samma Situation
  // (t.ex. Trafikmeddelande) följer med. Filtrera ner till rena olyckor här.
  return situations
    .flatMap((s) => s.Deviation)
    .filter((d) => d.MessageType === "Olycka");
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

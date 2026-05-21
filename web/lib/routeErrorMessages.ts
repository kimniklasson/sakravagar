export const ROUTE_SUPPORT_EMAIL = "kontakt@sakravagar.se";

const ROUTE_SUPPORT_SENTENCE =
  `Vill du bidra till en stabilare tjänst? Hör av dig till ${ROUTE_SUPPORT_EMAIL}.`;

export const ROUTE_BUSY_MESSAGE =
  `Många testar rutter just nu. Försök igen om några sekunder. ${ROUTE_SUPPORT_SENTENCE}`;

export const ROUTE_RATE_LIMIT_MESSAGE =
  `Ruttsökningen är tillfälligt begränsad eftersom många anrop görs på kort tid. Försök igen om några sekunder. ${ROUTE_SUPPORT_SENTENCE}`;

export const ROUTE_TIMEOUT_MESSAGE =
  `Tidsgränsen nåddes för ruttsökningen. Det kan bero på hög belastning eller en tung filterkombination. Försök igen om några sekunder, med en kortare resa eller färre undvik-val. ${ROUTE_SUPPORT_SENTENCE}`;

export const ROUTE_GENERIC_FAILURE_MESSAGE =
  "Kunde inte hitta en rutt just nu. Försök igen om några sekunder.";

const TECHNICAL_ROUTE_ERRORS = new Set([
  "rate limit exceeded",
  "route request timed out",
  "routing failed",
  "too many active route requests",
]);

export function routePlanningErrorMessage(status: number, serverError?: string | null): string {
  const normalized = serverError?.trim();
  if (status === 429) {
    if (normalized && !TECHNICAL_ROUTE_ERRORS.has(normalized)) return normalized;
    return ROUTE_RATE_LIMIT_MESSAGE;
  }
  if (status === 504) {
    if (normalized && !TECHNICAL_ROUTE_ERRORS.has(normalized)) return normalized;
    return ROUTE_TIMEOUT_MESSAGE;
  }
  if (status >= 500) return ROUTE_GENERIC_FAILURE_MESSAGE;

  if (normalized && !TECHNICAL_ROUTE_ERRORS.has(normalized)) return normalized;
  return ROUTE_GENERIC_FAILURE_MESSAGE;
}

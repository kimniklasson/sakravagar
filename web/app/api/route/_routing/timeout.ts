import type { RouteAvoidState } from "@/lib/routeTypes";
import { activeAvoidOptions } from "./request";

const ROUTE_FASTEST_SERVER_TIMEOUT_MS = 20_000;
const ROUTE_FILTERED_SERVER_TIMEOUT_MS = 55_000;
const ROUTE_PREVIEW_SERVER_TIMEOUT_MS = 7_000;

export class RouteDeadlineError extends Error {
  constructor(readonly timeoutMs: number) {
    super("route request timed out");
  }
}

export function routeTimeoutMessage(): string {
  return "Tidsgränsen nåddes för sökningen. Prova igen senare, med en kortare resa eller med färre undvik-val.";
}

export function routeRequestTimeoutMs(
  preview: boolean,
  alternatives: number,
  avoid: RouteAvoidState,
): number {
  if (preview) return ROUTE_PREVIEW_SERVER_TIMEOUT_MS;
  if (alternatives === 0 || activeAvoidOptions(avoid).length === 0) return ROUTE_FASTEST_SERVER_TIMEOUT_MS;
  return ROUTE_FILTERED_SERVER_TIMEOUT_MS;
}

export function withRouteDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new RouteDeadlineError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function isRouteTimeoutError(error: unknown): boolean {
  return (
    error instanceof RouteDeadlineError ||
    (error instanceof Error && error.message.toLowerCase().includes("timed out"))
  );
}

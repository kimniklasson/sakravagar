import { describe, expect, it } from "vitest";
import { noAvoids } from "./request";
import { isRouteTimeoutError, routeRequestTimeoutMs, routeTimeoutMessage } from "./timeout";

describe("route timeout helpers", () => {
  it("uses shortest timeout for previews", () => {
    expect(routeRequestTimeoutMs(true, 2, { ...noAvoids, highSpeed: true })).toBe(7_000);
  });

  it("uses fastest timeout when no alternatives or filters are active", () => {
    expect(routeRequestTimeoutMs(false, 0, { ...noAvoids, highSpeed: true })).toBe(20_000);
    expect(routeRequestTimeoutMs(false, 2, noAvoids)).toBe(20_000);
  });

  it("uses filtered timeout when avoid filters need candidate search", () => {
    expect(routeRequestTimeoutMs(false, 2, { ...noAvoids, highSpeed: true })).toBe(55_000);
  });

  it("detects route timeout errors without matching unrelated errors", () => {
    expect(isRouteTimeoutError(new Error("GraphHopper timed out"))).toBe(true);
    expect(isRouteTimeoutError(new Error("routing failed"))).toBe(false);
  });

  it("keeps a user-facing timeout message", () => {
    expect(routeTimeoutMessage()).toContain("Tidsgränsen");
  });
});

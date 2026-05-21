import { describe, expect, it } from "vitest";
import {
  ROUTE_BUSY_MESSAGE,
  ROUTE_SUPPORT_EMAIL,
  routePlanningErrorMessage,
} from "./routeErrorMessages";

describe("route error messages", () => {
  it("maps routing rate limits to a user-facing capacity message", () => {
    const message = routePlanningErrorMessage(429, "rate limit exceeded");

    expect(message).toContain("Försök igen om några sekunder");
    expect(message).toContain(ROUTE_SUPPORT_EMAIL);
    expect(message).not.toContain("rate limit exceeded");
  });

  it("keeps a specific backend capacity message for concurrency limits", () => {
    expect(routePlanningErrorMessage(429, ROUTE_BUSY_MESSAGE)).toBe(ROUTE_BUSY_MESSAGE);
  });

  it("maps route timeouts to a user-facing retry message", () => {
    const message = routePlanningErrorMessage(504, "route request timed out");

    expect(message).toContain("Tidsgränsen");
    expect(message).toContain("färre undvik-val");
    expect(message).toContain(ROUTE_SUPPORT_EMAIL);
  });

  it("keeps specific non-technical validation messages", () => {
    expect(routePlanningErrorMessage(400, "coordinates outside Sweden bounds"))
      .toBe("coordinates outside Sweden bounds");
  });

  it("hides generic technical server failures", () => {
    expect(routePlanningErrorMessage(502, "routing failed"))
      .toBe("Kunde inte hitta en rutt just nu. Försök igen om några sekunder.");
  });
});

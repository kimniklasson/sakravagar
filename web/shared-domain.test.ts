import { describe, expect, it } from "vitest";
import { categoryFromDisturbanceMessageType } from "@trafik/shared";

describe("categoryFromDisturbanceMessageType", () => {
  it("maps roadwork message types", () => {
    expect(categoryFromDisturbanceMessageType("Vägarbete")).toBe("roadwork");
    expect(categoryFromDisturbanceMessageType("Roadwork planned")).toBe("roadwork");
  });

  it("maps traffic and queue message types", () => {
    expect(categoryFromDisturbanceMessageType("Kö på E4")).toBe("traffic");
    expect(categoryFromDisturbanceMessageType("Trafikstörning")).toBe("traffic");
    expect(categoryFromDisturbanceMessageType("Queue")).toBe("traffic");
  });

  it("falls back to other", () => {
    expect(categoryFromDisturbanceMessageType(null)).toBe("other");
    expect(categoryFromDisturbanceMessageType("Olycka")).toBe("other");
  });
});

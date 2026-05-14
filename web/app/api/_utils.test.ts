import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_IP_HEADER,
  REQUEST_ID_HEADER,
  clientIpFromRequest,
  jsonResponse,
  logApiError,
  logApiObservation,
  logApiWarning,
  parseBboxParam,
  requestIdFromRequest,
  SWEDEN_DATA_BOUNDS,
} from "./_utils";

describe("parseBboxParam", () => {
  const opts = { required: true, maxArea: 1, bounds: SWEDEN_DATA_BOUNDS };

  it("requires bbox when configured", () => {
    expect(parseBboxParam(null, opts)).toEqual({ bbox: null, error: "bbox required" });
  });

  it("allows missing bbox when optional", () => {
    expect(parseBboxParam(null, { maxArea: 1 })).toEqual({ bbox: null, error: null });
  });

  it("rejects malformed bbox values", () => {
    expect(parseBboxParam("18,59,20", opts).error).toBe("bbox must be 4 finite numbers");
    expect(parseBboxParam("18,59,nope,60", opts).error).toBe("bbox must be 4 finite numbers");
  });

  it("rejects reversed or globally invalid coordinates", () => {
    expect(parseBboxParam("20,59,18,60", opts).error).toBe("bbox outside valid coordinate bounds");
    expect(parseBboxParam("18,95,20,96", { required: true, maxArea: 10 }).error)
      .toBe("bbox outside valid coordinate bounds");
  });

  it("rejects bbox outside supported data bounds", () => {
    expect(parseBboxParam("8,59,10,60", opts).error).toBe("bbox outside supported data bounds");
  });

  it("rejects bbox above max area", () => {
    expect(parseBboxParam("18,59,20,60", opts).error).toBe("bbox too large");
  });

  it("returns parsed bbox with area", () => {
    expect(parseBboxParam("18,59,18.5,59.4", opts)).toEqual({
      bbox: {
        minLng: 18,
        minLat: 59,
        maxLng: 18.5,
        maxLat: 59.4,
        area: 0.1999999999999993,
      },
      error: null,
    });
  });
});

describe("request context helpers", () => {
  it("reads valid request ids and ignores malformed ones", () => {
    const valid = new Request("https://example.test", {
      headers: { [REQUEST_ID_HEADER]: "route-req_123456" },
    });
    expect(requestIdFromRequest(valid)).toBe("route-req_123456");

    const malformed = new Request("https://example.test", {
      headers: { [REQUEST_ID_HEADER]: "no" },
    });
    expect(requestIdFromRequest(malformed)).not.toBe("no");
  });

  it("reads forwarded client ip from middleware first", () => {
    const req = new Request("https://example.test", {
      headers: {
        [CLIENT_IP_HEADER]: "203.0.113.10",
        "x-forwarded-for": "198.51.100.20",
      },
    });
    expect(clientIpFromRequest(req)).toBe("203.0.113.10");
  });

  it("adds request id to json responses", () => {
    const res = jsonResponse({ ok: true }, { requestId: "req-12345678" });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-12345678");
  });

  it("logs structured API observations", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logApiObservation("events", { requestId: "req-12345678", rowCount: 3 });

    expect(spy).toHaveBeenCalledWith("api_observation", {
      event: "api_observation",
      route: "events",
      status: "ok",
      requestId: "req-12345678",
      rowCount: 3,
    });
    spy.mockRestore();
  });

  it("logs structured API errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logApiError("example failed", new Error("boom"), { requestId: "req-12345678" });

    expect(spy).toHaveBeenCalledWith("api_error", expect.objectContaining({
      event: "api_error",
      label: "example failed",
      requestId: "req-12345678",
      error: expect.objectContaining({ name: "Error", message: "boom" }),
    }));
    spy.mockRestore();
  });

  it("logs structured API warnings", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logApiWarning(
      "example degraded",
      { code: "PGRST202", message: "missing rpc" },
      { requestId: "req-12345678" },
    );

    expect(spy).toHaveBeenCalledWith("api_warning", {
      event: "api_warning",
      label: "example degraded",
      requestId: "req-12345678",
      error: {
        code: "PGRST202",
        details: undefined,
        hint: undefined,
        message: "missing rpc",
      },
    });
    spy.mockRestore();
  });
});

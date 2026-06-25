import { describe, expect, it } from "vitest";
import {
  sanitizePiWebReason,
  resolvePiWebBridgeMode,
  probePiWebBridge,
  listPiWebModels,
  runPiWebSession,
  type PiWebBridgeConfig
} from "../index.js";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; contentType?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (key: string) => (key.toLowerCase() === "content-type" ? (init.contentType ?? "application/json") : null) },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    body: null as unknown
  };
}

function sseResponse(frames: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    }
  });
  return { ok: true, status: 200, headers: { get: () => "text/event-stream" }, json: async () => ({}), text: async () => "", body: stream };
}

const base: PiWebBridgeConfig = { baseUrl: "http://pi.test", mode: "auto", timeoutMs: 2000 };

describe("sanitizePiWebReason", () => {
  it("replaces HTML bodies and strips control characters", () => {
    expect(sanitizePiWebReason("<!DOCTYPE html><html>...</html>")).toBe("(non-JSON HTML response)");
    expect(sanitizePiWebReason("line1\n\tline2")).toBe("line1 line2");
  });
  it("truncates long reasons", () => {
    expect(sanitizePiWebReason("x".repeat(300)).endsWith("...")).toBe(true);
  });
});

describe("resolvePiWebBridgeMode", () => {
  it("normalizes to auto|on|off", () => {
    expect(resolvePiWebBridgeMode(undefined)).toBe("auto");
    expect(resolvePiWebBridgeMode("ON")).toBe("on");
    expect(resolvePiWebBridgeMode("off")).toBe("off");
    expect(resolvePiWebBridgeMode("weird")).toBe("auto");
  });
});

describe("probePiWebBridge", () => {
  it("is disabled when mode is off", async () => {
    const probe = await probePiWebBridge({ ...base, mode: "off" });
    expect(probe.enabled).toBe(false);
    expect(probe.reachable).toBe(false);
  });
  it("is reachable when /api/models returns JSON", async () => {
    const probe = await probePiWebBridge({ ...base, fetchImpl: (async () => jsonResponse({ version: "0.6.0", modelList: [] })) as unknown as typeof fetch });
    expect(probe.reachable).toBe(true);
    expect(probe.version).toBe("0.6.0");
  });
  it("is not reachable when the port serves HTML (not pi-web)", async () => {
    const probe = await probePiWebBridge({ ...base, fetchImpl: (async () => jsonResponse("<html></html>", { contentType: "text/html" })) as unknown as typeof fetch });
    expect(probe.reachable).toBe(false);
  });
  it("is unreachable when fetch throws", async () => {
    const probe = await probePiWebBridge({ ...base, fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
    expect(probe.reachable).toBe(false);
  });
});

describe("listPiWebModels", () => {
  it("maps modelList entries", async () => {
    const models = await listPiWebModels({ ...base, fetchImpl: (async () => jsonResponse({ modelList: [{ id: "gpt-image-2", provider: "vdamo", name: "GPT Image 2" }] })) as unknown as typeof fetch });
    expect(models).toEqual([{ id: "gpt-image-2", provider: "vdamo", name: "GPT Image 2" }]);
  });
  it("returns [] when disabled", async () => {
    expect(await listPiWebModels({ ...base, mode: "off" })).toEqual([]);
  });
});

describe("runPiWebSession", () => {
  it("fails fast (no fetch) when disabled", async () => {
    const result = await runPiWebSession({ ...base, mode: "off" }, { sessionId: "s", goal: "", prompt: "p", output: "PNG", files: [] });
    expect(result.ok).toBe(false);
    expect(result.reachable).toBe(false);
  });

  it("captures assistant output from the event stream on success", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.includes("/api/agent/new")) return jsonResponse({ success: true, sessionId: "sess-1" });
      if (url.includes("/events")) return sseResponse([
        'data: {"type":"connected","sessionId":"sess-1"}\n\n',
        'data: {"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"OK done"}]}}\n\n',
        'data: {"type":"turn_end"}\n\n'
      ]);
      if (url.includes("/api/sessions/")) return jsonResponse({ context: { messages: [] }, tree: [] });
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const result = await runPiWebSession({ ...base, fetchImpl }, { sessionId: "s", goal: "g", prompt: "do it", output: "PNG", files: [] });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("done");
    expect(result.output).toContain("OK done");
    expect(result.piSessionId).toBe("sess-1");
  });

  it("reports failure when /api/agent/new errors", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "boom" }, { ok: false, status: 500 })) as unknown as typeof fetch;
    const result = await runPiWebSession({ ...base, fetchImpl }, { sessionId: "s", goal: "", prompt: "p", output: "PNG", files: [] });
    expect(result.ok).toBe(false);
  });

  it("stays unconfirmed (no false positive) when the turn returns no output", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/api/agent/new")) return jsonResponse({ success: true, sessionId: "sess-2" });
      if (url.includes("/events")) return sseResponse(['data: {"type":"connected"}\n\n']);
      if (url.includes("/api/sessions/")) return jsonResponse({ context: { messages: [] }, tree: [] });
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const result = await runPiWebSession({ ...base, timeoutMs: 500, fetchImpl }, { sessionId: "s", goal: "", prompt: "p", output: "PNG", files: [] });
    expect(result.ok).toBe(false);
    expect(result.output).toBe("");
  });
});

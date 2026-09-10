/**
 * B-arij-247, half two: what protects `/api/*` once the listener is
 * deliberately NOT on loopback.
 *
 * `proxy.ts` cannot see the peer address — Next hands it a request, not a
 * socket — so every "is this local?" answer it can give comes from the `Host`
 * header, which any non-browser client writes itself:
 *
 *   curl -H 'Host: localhost' http://<lan-ip>:3000/api/settings
 *
 * The only boundary that survives that is a credential the caller has to
 * possess. Remote mode is entered by setting `ARIJ_REMOTE_TOKEN` (the
 * launcher mints one per boot when asked to bind a remote host); in that mode
 * the credential — not the header — decides.
 *
 * Two flows must keep working: the browser UI (cookie, so fetch, EventSource
 * and multipart uploads all carry it without touching a single call site) and
 * the session-scoped MCP channel (its own bearer, which this layer cannot
 * validate and must not shadow).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  REMOTE_TOKEN_COOKIE,
  REMOTE_TOKEN_ENV_VAR,
  REMOTE_TOKEN_HEADER,
} from "@/lib/security/remote-access";

const TOKEN = "per-boot-secret-token-value";

async function getProxy() {
  vi.resetModules();
  const mod = await import("@/proxy");
  return mod.proxy;
}

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, { headers });
}

/** The attacker's request: a LAN socket, a `Host` header that lies. */
function spoofedHostRequest(
  path = "/api/settings",
  headers: Record<string, string> = {},
): NextRequest {
  return makeRequest(`http://192.168.1.50:3000${path}`, {
    host: "localhost:3000",
    ...headers,
  });
}

describe("remote mode: the credential is the boundary", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv(REMOTE_TOKEN_ENV_VAR, TOKEN);
  });

  it("refuses a spoofed Host with no credential", async () => {
    const proxy = await getProxy();
    const res = proxy(spoofedHostRequest());
    expect(res.status).toBe(401);
  });

  it("refuses a spoofed Host AND a spoofed Origin", async () => {
    const proxy = await getProxy();
    const res = proxy(
      spoofedHostRequest("/api/settings", { origin: "http://localhost:3000" }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses every write route the epic names, not just one", async () => {
    const proxy = await getProxy();
    for (const path of [
      "/api/settings",
      "/api/settings/mcp-servers",
      "/api/projects/abc/epics/def/build",
    ]) {
      expect(proxy(spoofedHostRequest(path)).status).toBe(401);
    }
  });

  it("refuses a wrong credential", async () => {
    const proxy = await getProxy();
    const res = proxy(
      spoofedHostRequest("/api/settings", {
        [REMOTE_TOKEN_HEADER]: "not-the-token",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses a credential that is only a prefix of the real one", async () => {
    const proxy = await getProxy();
    const res = proxy(
      spoofedHostRequest("/api/settings", {
        [REMOTE_TOKEN_HEADER]: TOKEN.slice(0, 8),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("never echoes the expected or the presented secret", async () => {
    const proxy = await getProxy();
    const res = proxy(
      spoofedHostRequest("/api/settings", {
        [REMOTE_TOKEN_HEADER]: "guessed-secret-abcdef",
      }),
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("guessed-secret-abcdef");
  });

  it("logs nothing on a refusal", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const proxy = await getProxy();
    proxy(
      spoofedHostRequest("/api/settings", {
        [REMOTE_TOKEN_HEADER]: "guessed-secret-abcdef",
      }),
    );
    for (const spy of [error, warn, log]) expect(spy).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
    log.mockRestore();
  });

  it("also refuses an uncredentialled request that is honestly loopback", async () => {
    // Remote mode cannot tell a genuine loopback peer from a spoofed one, so
    // it does not try: `Host: localhost` buys nothing here either.
    const proxy = await getProxy();
    const res = proxy(
      makeRequest("http://localhost:3000/api/settings", {
        host: "localhost:3000",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("remote mode: the credentialled client still works", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv(REMOTE_TOKEN_ENV_VAR, TOKEN);
  });

  it("accepts the browser cookie the bootstrap hands out", async () => {
    const proxy = await getProxy();
    const res = proxy(
      makeRequest("http://192.168.1.10:3000/api/projects", {
        host: "192.168.1.10:3000",
        origin: "http://192.168.1.10:3000",
        cookie: `${REMOTE_TOKEN_COOKIE}=${TOKEN}`,
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("accepts the cookie on the SSE and upload paths too", async () => {
    // One cookie covers fetch, EventSource and multipart POST alike — that is
    // the reason the credential is a cookie and not a bespoke header.
    const proxy = await getProxy();
    for (const path of [
      "/api/projects/abc/events",
      "/api/projects/abc/documents",
    ]) {
      const res = proxy(
        makeRequest(`http://192.168.1.10:3000${path}`, {
          host: "192.168.1.10:3000",
          cookie: `${REMOTE_TOKEN_COOKIE}=${TOKEN}`,
        }),
      );
      expect(res.status).not.toBe(401);
    }
  });

  it("accepts an explicit header for a scripted client", async () => {
    const proxy = await getProxy();
    const res = proxy(
      spoofedHostRequest("/api/settings", { [REMOTE_TOKEN_HEADER]: TOKEN }),
    );
    expect(res.status).not.toBe(401);
  });

  it("accepts a bearer for a scripted client", async () => {
    const proxy = await getProxy();
    const res = proxy(
      spoofedHostRequest("/api/settings", {
        authorization: `Bearer ${TOKEN}`,
      }),
    );
    expect(res.status).not.toBe(401);
  });

  it("lets the bootstrap route through so it can check the token itself", async () => {
    const proxy = await getProxy();
    const res = proxy(
      makeRequest(
        `http://192.168.1.10:3000/api/auth/remote?token=${TOKEN}`,
        { host: "192.168.1.10:3000" },
      ),
    );
    expect(res.status).not.toBe(401);
  });

  it("leaves the session-scoped MCP channel to its own bearer", async () => {
    // The shim POSTs `Authorization: Bearer <session token>`; the proxy has no
    // database and cannot resolve it, so it must not answer for those routes.
    const proxy = await getProxy();
    const res = proxy(
      makeRequest("http://localhost:3000/api/mcp/get-ticket", {
        host: "localhost:3000",
        authorization: "Bearer session-scoped-mcp-token",
      }),
    );
    expect(res.status).not.toBe(401);
  });

  it("rejects a cross-site Origin even with a credential", async () => {
    const proxy = await getProxy();
    const res = proxy(
      makeRequest("http://192.168.1.10:3000/api/settings", {
        host: "192.168.1.10:3000",
        origin: "http://evil.example.com",
        cookie: `${REMOTE_TOKEN_COOKIE}=${TOKEN}`,
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("local mode is unchanged", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks for no credential when no remote token is configured", async () => {
    const proxy = await getProxy();
    const res = proxy(
      makeRequest("http://localhost:3000/api/projects", {
        host: "localhost:3000",
      }),
    );
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("treats a blank remote token as no remote mode at all", async () => {
    vi.stubEnv(REMOTE_TOKEN_ENV_VAR, "   ");
    const proxy = await getProxy();
    const res = proxy(
      makeRequest("http://localhost:3000/api/projects", {
        host: "localhost:3000",
      }),
    );
    expect(res.status).not.toBe(401);
  });
});

/**
 * The credential handoff: how a browser on the LAN ever gets the per-boot
 * token into a cookie.
 *
 * The launcher prints one URL. Opening it is the ONLY place the token travels
 * in a query string; the route trades it for an HttpOnly cookie and redirects,
 * so the secret leaves the address bar immediately and every later request —
 * fetch, EventSource, multipart upload — carries it without a call site
 * knowing it exists.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  REMOTE_TOKEN_COOKIE,
  REMOTE_TOKEN_ENV_VAR,
} from "@/lib/security/remote-access";

const TOKEN = "per-boot-secret-token-value";

async function get(url: string) {
  vi.resetModules();
  const { GET } = await import("@/app/api/auth/remote/route");
  return GET(new NextRequest(url, { headers: { host: "192.168.1.10:3000" } }));
}

describe("GET /api/auth/remote", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv(REMOTE_TOKEN_ENV_VAR, TOKEN);
  });

  it("trades a correct token for a cookie and redirects off the URL", async () => {
    const res = await get(
      `http://192.168.1.10:3000/api/auth/remote?token=${TOKEN}`,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${REMOTE_TOKEN_COOKIE}=${TOKEN}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/");
  });

  it("refuses a wrong token without setting anything", async () => {
    const res = await get(
      "http://192.168.1.10:3000/api/auth/remote?token=wrong-value",
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a missing token", async () => {
    const res = await get("http://192.168.1.10:3000/api/auth/remote");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("leaks neither the expected nor the presented value", async () => {
    const res = await get(
      "http://192.168.1.10:3000/api/auth/remote?token=guessed-value-xyz",
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("guessed-value-xyz");
  });

  it("is not a route at all when remote mode is off", async () => {
    // On a loopback-only boot there is no credential to hand out, and an
    // endpoint that answers anyway is a probe surface for nothing.
    vi.stubEnv(REMOTE_TOKEN_ENV_VAR, "");
    const res = await get(
      `http://localhost:3000/api/auth/remote?token=${TOKEN}`,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("serves an HTML bootstrap page when Accept is text/html without requiring query token", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/auth/remote/route");
    const req = new NextRequest("http://192.168.1.10:3000/api/auth/remote", {
      headers: {
        host: "192.168.1.10:3000",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("location.hash");
    expect(html).toContain("POST");
  });
});

describe("POST /api/auth/remote", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv(REMOTE_TOKEN_ENV_VAR, TOKEN);
  });

  it("exchanges a token via POST body for an HttpOnly cookie without putting secrets in URL", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/auth/remote/route");
    const req = new NextRequest("http://192.168.1.10:3000/api/auth/remote", {
      method: "POST",
      headers: {
        host: "192.168.1.10:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: TOKEN }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${REMOTE_TOKEN_COOKIE}=${TOKEN}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/");
  });

  it("refuses a wrong token via POST body without setting cookie", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/auth/remote/route");
    const req = new NextRequest("http://192.168.1.10:3000/api/auth/remote", {
      method: "POST",
      headers: {
        host: "192.168.1.10:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: "wrong-token-value" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("request logging suppression", () => {
  it("suppresses server request logging for /api/auth/remote so secrets do not leak into logs", async () => {
    const { logRequests } = await import("next/dist/server/dev/log-requests");
    const nextConfig = (await import("@/next.config")).default;
    const logging = nextConfig.logging as { incomingRequests?: any } | undefined;
    expect(logging?.incomingRequests).toBeDefined();

    for (const statusCode of [200, 303, 401]) {
      let captured = "";
      const origWrite = process.stdout.write;
      try {
        process.stdout.write = ((chunk: any) => {
          captured += String(chunk);
          return true;
        }) as any;

        const req = {
          url: `/api/auth/remote?token=${TOKEN}`,
          method: "GET",
        };
        const res = { statusCode };
        (logRequests as any)(req, res, logging, BigInt(0), BigInt(1000000));
      } finally {
        process.stdout.write = origWrite;
      }
      expect(captured).toBe("");
      expect(captured).not.toContain(TOKEN);
    }
  });
});


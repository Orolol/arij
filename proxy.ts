import { NextRequest, NextResponse } from "next/server";
import {
  MCP_ROUTE_PREFIX,
  REMOTE_AUTH_BOOTSTRAP_PATH,
  credentialMatches,
  extractHostname,
  isLoopbackHostname,
  presentedRemoteCredential,
  readRemoteToken,
} from "@/lib/security/remote-access";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isLocalHost(headerValue: string | null): boolean {
  if (!headerValue) return false;
  return LOCAL_HOSTS.includes(extractHostname(headerValue));
}

function getAllowedOrigins(): string[] {
  return (
    process.env.ALLOWED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

/**
 * The Origin guard, shared by both modes: a browser on another site must not
 * be able to drive this API with the user's ambient credentials.
 *
 * `sameOriginHost` lets remote mode work without forcing the operator to
 * declare their own address in ALLOWED_ORIGINS — a page served from
 * `http://box.lan:3000` legitimately sends that as its Origin. It is not a
 * security claim on its own (Host is spoofable, which is the whole reason
 * this file exists); the credential is. This only closes the cross-site case.
 */
function refuseForeignOrigin(
  origin: string | null,
  sameOriginHost: string | null,
): NextResponse | null {
  if (!origin) return null;
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.includes(origin)) return null;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return NextResponse.json(
      { error: "Forbidden: invalid origin" },
      { status: 403 }
    );
  }

  if (isLoopbackHostname(originUrl.hostname)) return null;
  if (sameOriginHost && originUrl.host === sameOriginHost) return null;

  return NextResponse.json(
    { error: "Forbidden: non-local origin" },
    { status: 403 }
  );
}

/**
 * The `/api/*` boundary.
 *
 * DEFAULT MODE — the listener is on loopback (`bin/launch-plan.mjs` and the
 * package scripts both pass `-H 127.0.0.1`), so reaching this code at all
 * already means a local peer. The Host/Origin checks below are the second
 * line, for a listener someone widened by hand.
 *
 * REMOTE MODE — `ARIJ_REMOTE_TOKEN` is set, so the operator has deliberately
 * exposed the app. Here Host proves nothing: this function is given a request,
 * not a socket, and `curl -H 'Host: localhost'` satisfies any header-based
 * check from anywhere on the network. The per-boot credential is the boundary,
 * and it applies to loopback-looking requests too — there is no way to tell
 * one from a forgery at this layer, so neither is trusted.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const remoteToken = readRemoteToken();

  if (remoteToken) {
    const { pathname } = request.nextUrl;

    // Validates the token itself and trades it for the cookie; requiring the
    // cookie to get the cookie would make remote mode unreachable.
    if (pathname === REMOTE_AUTH_BOOTSTRAP_PATH) return NextResponse.next();

    // Session-scoped MCP bearers are resolved against the database by the
    // routes themselves. This layer has no database and must not answer.
    if (pathname.startsWith(MCP_ROUTE_PREFIX)) return NextResponse.next();

    if (!credentialMatches(presentedRemoteCredential(request), remoteToken)) {
      // Nothing about the presented value goes into the body or a log: a
      // rejection message that quotes what was tried is an oracle.
      return NextResponse.json(
        { error: "Unauthorized: missing or invalid Arij access credential" },
        { status: 401 }
      );
    }

    return refuseForeignOrigin(origin, host) ?? NextResponse.next();
  }

  if (!isLocalHost(host)) {
    const allowedOrigins = getAllowedOrigins();
    if (!origin || !allowedOrigins.includes(origin)) {
      return NextResponse.json(
        { error: "Forbidden: non-local request" },
        { status: 403 }
      );
    }
  }

  // Loopback-only mode keeps its stricter reading: an Origin must be local or
  // explicitly allowed. Same-origin is NOT a licence here, because a non-local
  // Host has already been refused above.
  if (origin) {
    const allowedOrigins = getAllowedOrigins();
    try {
      const originHost = new URL(origin).hostname;
      if (!LOCAL_HOSTS.includes(originHost) && !allowedOrigins.includes(origin)) {
        return NextResponse.json(
          { error: "Forbidden: non-local origin" },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Forbidden: invalid origin" },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};

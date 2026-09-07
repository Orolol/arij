/**
 * The credential handoff for remote mode.
 *
 * `bin/launch-plan.mjs` prints one URL when it is asked to bind a non-loopback
 * host. Opening it is the ONLY moment the per-boot token travels in a query
 * string; this route trades it for an HttpOnly cookie and redirects, so the
 * secret leaves the address bar (and the browser history entry) immediately
 * and every later request — `fetch`, `EventSource`, multipart upload — carries
 * it same-origin without any call site knowing it exists.
 *
 * `proxy.ts` exempts this one path from the credential check, because it IS
 * the credential check.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  REMOTE_TOKEN_COOKIE,
  REMOTE_TOKEN_QUERY_PARAM,
  credentialMatches,
  readRemoteToken,
} from "@/lib/security/remote-access";

/** A boot's credential is worthless after that boot; a week is generous. */
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function GET(request: NextRequest) {
  const expected = readRemoteToken();

  // Loopback-only boot: there is no credential to hand out, and an endpoint
  // that answers anyway is a probe surface for nothing.
  if (!expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const presented = request.nextUrl.searchParams.get(REMOTE_TOKEN_QUERY_PARAM);

  if (!credentialMatches(presented, expected)) {
    // No detail, and nothing logged: neither the expected value nor the
    // attempt may appear anywhere a reader could turn into an oracle.
    return NextResponse.json(
      { error: "Unauthorized: invalid Arij access credential" },
      { status: 401 }
    );
  }

  // 303, so the browser follows with a GET and the token-bearing URL is gone.
  // A relative Location keeps the redirect on whatever host the operator
  // actually reached — deriving an absolute one from `Host` would echo a
  // spoofable header straight back into the browser's address bar.
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: "/" },
  });
  response.cookies.set({
    name: REMOTE_TOKEN_COOKIE,
    value: expected,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    // Only over TLS when the request itself arrived over TLS — remote mode on
    // a plain-HTTP LAN address would otherwise set a cookie the browser never
    // sends back.
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}

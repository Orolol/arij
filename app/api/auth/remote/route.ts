/**
 * The credential handoff for remote mode.
 *
 * `bin/launch-plan.mjs` prints one bootstrap URL when asked to bind a non-loopback
 * host. The credential travels in a URL hash fragment (`#token=...`), so it is
 * never transmitted to the server in a request line and never appears in server
 * request logs. The browser loads the bootstrap page via GET, extracts the token
 * from the fragment client-side, and exchanges it via POST for an HttpOnly cookie.
 *
 * Scripted clients and direct GET queries (`?token=...`) are also supported.
 * `next.config.ts` suppresses request logging for this route, so no credential
 * ever appears in development logs.
 *
 * `proxy.ts` exempts this path from the proxy credential check because it IS
 * the credential check.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  REMOTE_TOKEN_COOKIE,
  REMOTE_TOKEN_QUERY_PARAM,
  credentialMatches,
  presentedRemoteCredential,
  readRemoteToken,
} from "@/lib/security/remote-access";

/** A boot's credential is worthless after that boot; a week is generous. */
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function setAuthCookie(
  response: NextResponse,
  token: string,
  isHttps: boolean,
) {
  response.cookies.set({
    name: REMOTE_TOKEN_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    secure: isHttps,
  });
}

export async function POST(request: NextRequest) {
  const expected = readRemoteToken();
  if (!expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let presented: string | null = null;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const body = await request.json();
      if (body && typeof body.token === "string") {
        presented = body.token.trim();
      }
    } catch {
      // Ignored: checked below
    }
  } else if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      const formData = await request.formData();
      const val = formData.get(REMOTE_TOKEN_QUERY_PARAM);
      if (typeof val === "string") {
        presented = val.trim();
      }
    } catch {
      // Ignored
    }
  }

  if (!presented) {
    presented = presentedRemoteCredential(request);
  }

  if (!credentialMatches(presented, expected)) {
    return NextResponse.json(
      { error: "Unauthorized: invalid Arij access credential" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  setAuthCookie(response, expected, request.nextUrl.protocol === "https:");
  return response;
}

export async function GET(request: NextRequest) {
  const expected = readRemoteToken();

  // Loopback-only boot: there is no credential to hand out, and an endpoint
  // that answers anyway is a probe surface for nothing.
  if (!expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const presented = request.nextUrl.searchParams.get(REMOTE_TOKEN_QUERY_PARAM);

  if (presented) {
    if (!credentialMatches(presented, expected)) {
      return NextResponse.json(
        { error: "Unauthorized: invalid Arij access credential" },
        { status: 401 },
      );
    }

    const response = new NextResponse(null, {
      status: 303,
      headers: { location: "/" },
    });
    setAuthCookie(response, expected, request.nextUrl.protocol === "https:");
    return response;
  }

  // If no query parameter was passed and the client accepts HTML (browser navigation),
  // serve an HTML page that reads the fragment client-side and exchanges it via POST.
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Arij Remote Access</title>
</head>
<body>
  <div id="status" style="font-family:sans-serif;padding:2rem;">Authenticating remote session...</div>
  <script>
    (async function() {
      const statusEl = document.getElementById("status");
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const token = params.get("token") || hash;
      if (!token) {
        statusEl.textContent = "Unauthorized: invalid Arij access credential";
        return;
      }
      try {
        const res = await fetch("/api/auth/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token })
        });
        if (res.ok) {
          window.location.replace("/");
        } else {
          statusEl.textContent = "Unauthorized: invalid Arij access credential";
        }
      } catch (err) {
        statusEl.textContent = "Authentication failed: " + err.message;
      }
    })();
  </script>
</body>
</html>`;
    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  return NextResponse.json(
    { error: "Unauthorized: invalid Arij access credential" },
    { status: 401 },
  );
}

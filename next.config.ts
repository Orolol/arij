import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { extractHost, isLoopbackHost } from "./bin/launch-plan.mjs";

function getListeningServerAddresses(): string[] {
  const handles = (process as any)._getActiveHandles?.() ?? [];
  const addresses: string[] = [];
  for (const handle of handles) {
    if (
      handle &&
      typeof handle.address === "function" &&
      handle.listening === true
    ) {
      const addr = handle.address();
      if (addr) {
        if (typeof addr === "string") {
          addresses.push(addr);
        } else if (typeof addr === "object" && typeof addr.address === "string") {
          addresses.push(addr.address);
        }
      }
    }
  }
  return addresses;
}

// Prevent unauthenticated remote binding when Next is invoked directly without the launcher
function enforceListenerSecurity(): void {
  if (process.env.ARIJ_REMOTE_TOKEN?.trim()) {
    return;
  }

  // 1. Inspect direct Next CLI invocation arguments when present
  try {
    const argv = process.argv.slice(1);
    const isDirectNext = argv.some(
      (arg) =>
        typeof arg === "string" &&
        (arg.endsWith("/next") || arg.endsWith("\\next") || arg === "next")
    );
    const isServingCommand = argv.includes("dev") || argv.includes("start");
    if (isDirectNext && isServingCommand) {
      const hostInfo = extractHost(argv);
      // Next does NOT read ARIJ_HOST. If not passed on CLI, Next defaults to 0.0.0.0
      const host = hostInfo.value ?? "0.0.0.0";
      if (!isLoopbackHost(host)) {
        throw new Error(
          `Arij refuses to bind remote interface (${host}) without an access credential. Start with 'arij' or set ARIJ_REMOTE_TOKEN.`
        );
      }
    }
  } catch (err: any) {
    if (err.message?.includes("Arij refuses to bind remote")) {
      throw err;
    }
  }

  // 2. Inspect authoritative server listener addresses from Node's handle table
  // (survives Next's worker boundary in `next dev` and checks the actual bound socket)
  const listeningAddresses = getListeningServerAddresses();
  for (const addr of listeningAddresses) {
    if (!isLoopbackHost(addr)) {
      throw new Error(
        `Arij refuses to bind remote interface (${addr}) without an access credential. Start with 'arij' or set ARIJ_REMOTE_TOKEN.`
      );
    }
  }
}

enforceListenerSecurity();

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "pdfjs-dist"],

  logging: {
    incomingRequests: {
      ignore: [/^\/api\/auth\/remote/],
    },
  },

  /**
   * The loopback hosts `proxy.ts` already accepts for `/api/*`.
   *
   * Next 16.3 blocks cross-site requests to `/_next/*` dev resources against a
   * default allowlist of `['**.localhost', 'localhost']` plus whatever
   * `--hostname` bound. Chrome labels the chunk `<script>` loads of a page
   * served from an IP literal `Sec-Fetch-Site: cross-site`, so on
   * `http://127.0.0.1:3000` every `/_next/static/chunks/*.js` came back 403
   * while `http://localhost:3000` worked.
   *
   * Nothing announces that. The API answers — the proxy trusts `127.0.0.1` —
   * and the server markup renders, so the page looks like it loaded; hydration
   * just never runs and the board sits inert. Measured on 16.3.3: with
   * `Sec-Fetch-Mode: no-cors` + `Sec-Fetch-Site: cross-site`, a `127.0.0.1`
   * referer got 403 and a `localhost` referer got 200.
   *
   * `localhost` is already in Next's default allowlist; these two are the
   * spellings that were missing. The list is deliberately the loopback set and
   * nothing wider — this closes the gap between the two layers rather than
   * turning the protection off. Development only: the enforcement does not
   * exist in a production server, which serves `127.0.0.1` fine.
   */
  allowedDevOrigins: ["127.0.0.1", "[::1]"],

  experimental: {
    /**
     * `proxy.ts` matches `/api/:path*`, so Next buffers every API request
     * body up to this cap and hands the route only what fitted. The default is
     * 10485760 (10MB).
     *
     * In Arij, the highest supported upload limit is for document uploads
     * (20MB in `lib/documents/upload-constants.ts`, which also covers chat
     * attachments at 10MB in `lib/uploads/image-attachments.ts`).
     *
     * 1MB of headroom (21MB total) separates the platform cap from the 20MB
     * document limit, so an upload sitting at the limit is not truncated by the
     * multipart form overhead, and an oversized file is refused by the app's
     * typed size guard rather than by platform truncation. Anything past this
     * cap still gets the route's 413.
     */
    proxyClientMaxBodySize: 21 * 1024 * 1024,
  },
};

/**
 * next-intl, WITHOUT its routing layer. The plugin only registers
 * `lib/i18n/request.ts` as the per-request locale/messages source; the
 * locale is a stored setting (see lib/i18n/locales.ts), never a `[lang]`
 * segment, and `proxy.ts` is untouched.
 */
const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

export default withNextIntl(nextConfig);

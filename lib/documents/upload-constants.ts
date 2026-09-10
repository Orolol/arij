/**
 * Constants and helpers for document uploads.
 *
 * Client-safe: no `db`, no `fs`, no Next.js import.
 */

/**
 * The application's limit on one uploaded document file (20 MiB).
 *
 * It must stay strictly below `experimental.proxyClientMaxBodySize` in
 * `next.config.ts`: `proxy.ts` matches `/api/:path*`, so Next buffers the
 * request body up to that cap. A file at the limit overflows the cap once
 * multipart form overhead is added if there is no headroom — the body then
 * reaches the route truncated and parsing throws before the size guard runs.
 */
export const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Derived, so the wording of the limit cannot drift away from the byte constant. */
export const MAX_DOCUMENT_UPLOAD_LABEL = `${MAX_DOCUMENT_UPLOAD_BYTES / 1024 / 1024}MB`;

/**
 * Why an upload whose multipart body could not be parsed is refused.
 *
 * A request body over the platform's cap reaches the route truncated, so
 * `request.formData()` throws before the file size guard ever sees the file.
 * This is the wording used instead, naming the same limit.
 *
 * `bodyBytes` is the request's declared `content-length` when it carried one.
 * It measures the whole multipart body, not the file alone, which is why the
 * message says so: a file of exactly the limit still overflows once the form
 * envelope is added, and "20.0MB. Max: 20MB" would otherwise read as a
 * contradiction.
 */
export function oversizedDocumentUploadReason(bodyBytes: number | null): string {
  if (bodyBytes === null) {
    return `Upload too large. Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`;
  }

  const megabytes = (bodyBytes / 1024 / 1024).toFixed(1);
  return `Upload too large (${megabytes}MB including form overhead). Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`;
}

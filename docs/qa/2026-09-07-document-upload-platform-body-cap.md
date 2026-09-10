# Document Upload Platform Body Cap Alignment and Multipart Error Handling

**Ticket:** `sf6_MY_YX8HP` — *Document uploads above 11 MiB return 500 despite 20 MiB route limit*
**Merge-base:** `main` at `0aa985ce`
**Verification:** Vitest suite (all 19 tests in `__tests__/documents-upload-platform-body-cap.test.ts` passing, 18 red on base; 64 tests across 9 related suites passing), TypeScript clean (`tsc --noEmit`), ESLint clean, and executable automated HTTP integration tests running against an isolated real Next.js server with proxy enabled.

---

## 1. Problem and Root Cause

POSTing any file larger than 11 MiB to `/api/projects/:id/documents` returned HTTP 500 with an empty body, resulting in UI display: `Failed to upload (HTTP 500)`.

### Root Cause
1. `next.config.ts` configured `experimental.proxyClientMaxBodySize` to 11 MiB (`11 * 1024 * 1024`). This cap was originally sized for chat uploads (which have a 10 MiB limit + 1 MiB headroom).
2. Because `proxy.ts` matches `/api/:path*`, Next.js buffers request bodies for all `/api/*` routes up to `proxyClientMaxBodySize` and truncates anything beyond.
3. `/api/projects/:id/documents` allowed 20 MiB (`MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024`).
4. Any upload larger than 11 MiB arrived truncated at the route handler.
5. In `app/api/projects/[projectId]/documents/route.ts`, `await request.formData()` was unhandled. Calling `.formData()` on a truncated multipart body threw an unhandled `TypeError: Failed to parse body as FormData.`, causing Next.js to return HTTP 500 with an empty body.
6. A 12 MiB file (well under the 20 MiB limit) failed with 500 instead of being accepted (201).
7. A 21 MiB file (over the 20 MiB limit) also failed with 500 instead of receiving a typed JSON size rejection.

---

## 2. Changes Made

### 1. `next.config.ts`
Raised `experimental.proxyClientMaxBodySize` to 21 MiB (`21 * 1024 * 1024`).
This provides 1 MiB of headroom above the application's highest upload limit (20 MiB document uploads), comfortably accommodating multipart form boundaries, headers, and filename overhead.

### 2. `lib/documents/upload-constants.ts`
Created shared, client-safe constants and error formatters:
- `MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024` (20 MiB)
- `MAX_DOCUMENT_UPLOAD_LABEL = "20MB"`
- `oversizedDocumentUploadReason(bodyBytes: number | null): string` — produces `"Upload too large (${megabytes}MB including form overhead). Max: 20MB"` when body bytes are declared/measured, or `"Upload too large. Max: 20MB"` when absent.

### 3. `app/api/projects/[projectId]/documents/route.ts`
- Wrapped request parsing in a `try / catch` block with streaming byte tracking via `TransformStream`:
  - Bytes read from `request.body` are counted as they stream.
  - On parse failure, the route distinguishes confirmed overflow from generic parse failure:
    - If declared `content-length` exceeds `MAX_DOCUMENT_UPLOAD_BYTES`, or if `bytesRead` exceeds `MAX_DOCUMENT_UPLOAD_BYTES`, returns HTTP 413 with `{ error: oversizedDocumentUploadReason(bodyBytes) }`.
    - Otherwise (e.g. small malformed body with declared length, or small chunked 5-byte malformed body without `content-length`), returns HTTP 400 with `{ error: "Could not read the upload. Expected a multipart form body." }`.
- For parsed files exceeding `MAX_DOCUMENT_UPLOAD_BYTES`, returns HTTP 413 with `{ error: "File too large (${megabytes}MB). Max: 20MB" }`.

### 4. `lib/documents/import.ts`
Imported and reused `MAX_DOCUMENT_UPLOAD_BYTES` and `MAX_DOCUMENT_UPLOAD_LABEL` from `upload-constants.ts` to ensure consistency between manual uploads and repository document imports.

### 5. `__tests__/helpers/upload-request.ts`
Added `MAX_DOCUMENT_UPLOAD_BYTES`, `MAX_DOCUMENT_UPLOAD_LABEL`, and `oversizedDocumentUploadReason` helpers for test suites.

### 6. `__tests__/documents-upload-platform-body-cap.test.ts`
Comprehensive regression suite featuring:
- **Unit Suite (12 tests)**:
  - Platform cap headroom verification above document limit and multipart envelope.
  - 12 MiB document upload acceptance through proxy simulation (201 Created).
  - Exact 20 MiB limit acceptance (201 Created).
  - 1 byte under 20 MiB limit acceptance (201 Created).
  - 1 byte over 20 MiB limit rejection (413 Payload Too Large).
  - 20.5 MiB document rejection with typed guard message (413 Payload Too Large).
  - Truncated oversized upload with declared `content-length` (413 Payload Too Large).
  - Small malformed chunked upload without `content-length` (400 Bad Request).
  - Genuinely oversized chunked upload without `content-length` (413 Payload Too Large).
  - Small malformed body with declared `content-length` (400 Bad Request).
  - 15 MiB image document upload acceptance (201 Created).
  - Vitest test collection verification.
- **Executable Automated HTTP Integration Suite (7 tests)**:
  - Spawns an isolated real Next.js dev server on an ephemeral loopback port with `proxy.ts` active and an ephemeral SQLite database.
  - 12 MiB text file upload: returns **201 Created**.
  - 20 MiB text file upload (exact route limit): returns **201 Created**.
  - 20.5 MiB text file upload (over route limit, within 21 MiB buffer): returns **413** `{"error":"File too large (20.5MB). Max: 20MB"}`.
  - 22 MiB text file upload (above 21 MiB buffer cap): returns **413** `{"error":"Upload too large (22.0MB including form overhead). Max: 20MB"}`.
  - 5-byte malformed body with Content-Length: returns **400** `{"error":"Could not read the upload. Expected a multipart form body."}`.
  - 5-byte small malformed chunked body without Content-Length: returns **400** `{"error":"Could not read the upload. Expected a multipart form body."}`.
  - 22 MiB genuinely oversized chunked body without Content-Length: returns **413** with `Max: 20MB`.
  - Process group cleanly terminated and scratch databases/storage wiped in `afterAll`.

---

## 3. Red -> Green Proof

### Against unfixed merge-base (`0aa985ce`):
- 18 of 19 tests in `__tests__/documents-upload-platform-body-cap.test.ts` failed:
  - All 11 functional unit tests failed with `TypeError: Failed to parse body as FormData.` or `AssertionError`.
  - All 7 executable HTTP integration tests failed with `expected 500 to be 201`, `expected 500 to be 413`, or `expected 500 to be 400` due to Next.js unhandled 500.
- 1 test passed (vitest collection check).

### Against fixed branch:
- All 19 tests in `__tests__/documents-upload-platform-body-cap.test.ts` passed (in 2.5s).
- All 9 related test files passed (64 tests).
- `npx tsc --noEmit`: 0 errors.
- `npx eslint`: 0 errors, 0 warnings.

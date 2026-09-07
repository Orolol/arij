# Document Upload Platform Body Cap Alignment and Multipart Error Handling

**Ticket:** `sf6_MY_YX8HP` — *Document uploads above 11 MiB return 500 despite 20 MiB route limit*
**Merge-base:** `main` at `0aa985ce`
**Verification:** Vitest suite (648 files, 8806 tests green), TypeScript clean, ESLint clean, and live HTTP verification via real Next.js dev server on port 3888 through the actual proxy.

---

## 1. Problem and Root Cause

POSTing any file larger than 11 MiB to `/api/projects/:id/documents` returned HTTP 500 with an empty body, resulting in UI display: `Failed to upload (HTTP 500)`.

### Root Cause
1. `next.config.ts` configured `experimental.proxyClientMaxBodySize` to 11 MiB (`11 * 1024 * 1024`). This cap was originally chosen for chat uploads (which have a 10 MiB limit + 1 MiB headroom).
2. Because `proxy.ts` matches `/api/:path*`, Next.js buffers request bodies for all `/api/*` routes up to `proxyClientMaxBodySize` and truncates anything beyond.
3. `/api/projects/:id/documents` allowed 20 MiB (`MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024`).
4. Any upload larger than 11 MiB arrived truncated at the route handler.
5. In `app/api/projects/[projectId]/documents/route.ts`, `const formData = await request.formData()` was unhandled. Calling `.formData()` on a truncated multipart body threw an unhandled `TypeError: Failed to parse body as FormData.`, causing Next.js to return HTTP 500 with an empty body.
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
- `oversizedDocumentUploadReason(bodyBytes: number | null): string` — produces `"Upload too large (${megabytes}MB including form overhead). Max: 20MB"` when body bytes are declared, or `"Upload too large. Max: 20MB"` when absent.

### 3. `app/api/projects/[projectId]/documents/route.ts`
- Wrapped `request.formData()` in a `try / catch` block:
  - If parsing fails and declared `content-length` is `<= MAX_DOCUMENT_UPLOAD_BYTES`, returns HTTP 400 with `{ error: "Could not read the upload. Expected a multipart form body." }`.
  - If parsing fails and declared `content-length` exceeds the limit (or is missing), returns HTTP 413 with `{ error: oversizedDocumentUploadReason(bodyBytes) }`.
- For parsed files exceeding `MAX_DOCUMENT_UPLOAD_BYTES`, returns HTTP 413 with `{ error: "File too large (${megabytes}MB). Max: 20MB" }`.

### 4. `lib/documents/import.ts`
Imported and reused `MAX_DOCUMENT_UPLOAD_BYTES` and `MAX_DOCUMENT_UPLOAD_LABEL` from `upload-constants.ts` to ensure consistency between manual uploads and repository document imports.

### 5. `__tests__/helpers/upload-request.ts`
Added `MAX_DOCUMENT_UPLOAD_BYTES`, `MAX_DOCUMENT_UPLOAD_LABEL`, and `oversizedDocumentUploadReason` helpers for test suites.

### 6. `__tests__/documents-upload-platform-body-cap.test.ts`
Added regression tests covering:
- Headroom of `PLATFORM_MAX_BODY_BYTES` above document limit and multipart envelope.
- 12 MiB document upload acceptance through proxy (201 Created).
- Exact 20 MiB limit acceptance (201 Created).
- 1 byte under 20 MiB limit acceptance (201 Created).
- 1 byte over 20 MiB limit rejection (413 Payload Too Large).
- 20.5 MiB document rejection with guard message (413 Payload Too Large).
- Truncated oversized uploads (e.g. 30 MiB) rejection (413 Payload Too Large).
- Truncated uploads without `content-length` rejection (413 Payload Too Large).
- Small malformed multipart request rejection (400 Bad Request).
- 15 MiB image document upload acceptance (201 Created).
- Vitest test collection verification.

---

## 3. Red -> Green Proof

Against unfixed merge-base (`0aa985ce`):
- 10 of 11 tests in `__tests__/documents-upload-platform-body-cap.test.ts` failed (all 10 functional tests failed with `TypeError: Failed to parse body as FormData.` or `AssertionError` on platform cap and delivery).
- 1 test passed (vitest collection check).

Against fixed branch:
- All 11 tests in `__tests__/documents-upload-platform-body-cap.test.ts` passed.
- All 8 related test files passed (58 tests).
- Full Vitest suite: 648 files, 8806 tests passed.

---

## 4. Live Server End-to-End Verification

Tested with real HTTP requests using `curl` against a dedicated Next.js dev server instance running on port 3888 (with active proxy and `proxyClientMaxBodySize: 22020096`):

| Test Case | Payload | Before Fix | After Fix |
|---|---|---|---|
| Under limit | 9.0 MiB text | 201 Created | **201 Created** |
| Below limit, above old cap | 12.0 MiB text | 500 (empty body) | **201 Created** |
| At exact route limit | 20.0 MiB text | 500 (empty body) | **201 Created** |
| Over route limit, within buffer | 20.5 MiB text | 500 (empty body) | **413** `{"error":"File too large (20.5MB). Max: 20MB"}` |
| Over proxy buffer cap | 21.0 MiB text | 500 (empty body) | **413** `{"error":"Upload too large (21.0MB including form overhead). Max: 20MB"}` |
| Far above proxy buffer cap | 30.0 MiB text | 500 (empty body) | **413** `{"error":"Upload too large (30.0MB including form overhead). Max: 20MB"}` |
| Malformed multipart | Corrupted body | 500 (empty body) | **400** `{"error":"Could not read the upload. Expected a multipart form body."}` |
| Missing file | Empty form | 400 | **400** `{"error":"No file provided"}` |

Server log during execution verified that Next.js emitted only informational warnings (`Request body exceeded 21MB...`) without any unhandled exceptions or 500 errors.
All scratch test artifacts, server processes, and database test rows were cleaned up after testing.

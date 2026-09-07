// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import vitestConfig from "@/vitest.config";
import { dbMockState, resetDbMockState, mockRouteContext } from "@/__tests__/helpers/db-mock";
import {
  PLATFORM_MAX_BODY_BYTES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENT_UPLOAD_LABEL,
  oversizedDocumentUploadReason,
  fileOfSize,
  multipartEnvelopeBytes,
  platformUpload,
} from "@/__tests__/helpers/upload-request";
import { proxy } from "@/proxy";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const mockConvertToMarkdown = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("@/lib/converters", () => ({
  convertToMarkdown: mockConvertToMarkdown,
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "doc-1"),
}));

vi.mock("fs", () => ({ default: fsMock, ...fsMock }));

import { POST } from "@/app/api/projects/[projectId]/documents/route";

describe("document upload under the platform body cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockConvertToMarkdown.mockResolvedValue("# Converted markdown");
  });

  it("keeps the platform cap above the document limit with room for the envelope", () => {
    expect(PLATFORM_MAX_BODY_BYTES).toBeGreaterThan(
      MAX_DOCUMENT_UPLOAD_BYTES + multipartEnvelopeBytes("spec.md", "text/markdown")
    );
  });

  it("accepts a 12 MiB document upload through the proxy", async () => {
    dbMockState.getQueue = [
      null,
      {
        id: "doc-1",
        projectId: "proj-1",
        originalFilename: "spec.md",
        kind: "text",
        markdownContent: "# Converted markdown",
      },
    ];

    const file = fileOfSize("spec.md", "text/markdown", 12 * 1024 * 1024);
    const { request } = platformUpload(file);
    request.headers.set("host", "localhost:3000");

    const proxyRes = proxy(request);
    expect(proxyRes.status).not.toBe(403);

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.id).toBe("doc-1");
    expect(mockConvertToMarkdown).toHaveBeenCalledTimes(1);
  });

  it("accepts an upload one byte under the 20 MiB limit", async () => {
    dbMockState.getQueue = [
      null,
      {
        id: "doc-1",
        projectId: "proj-1",
        originalFilename: "spec.md",
        kind: "text",
        markdownContent: "# Converted markdown",
      },
    ];

    const file = fileOfSize("spec.md", "text/markdown", MAX_DOCUMENT_UPLOAD_BYTES - 1);
    const { request } = platformUpload(file);
    request.headers.set("host", "localhost:3000");

    const proxyRes = proxy(request);
    expect(proxyRes.status).not.toBe(403);

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(201);
  });

  it("accepts a document sitting exactly on the 20 MiB limit", async () => {
    dbMockState.getQueue = [
      null,
      {
        id: "doc-1",
        projectId: "proj-1",
        originalFilename: "spec.md",
        kind: "text",
        markdownContent: "# Converted markdown",
      },
    ];

    const file = fileOfSize("spec.md", "text/markdown", MAX_DOCUMENT_UPLOAD_BYTES);
    const { request } = platformUpload(file);
    request.headers.set("host", "localhost:3000");

    const proxyRes = proxy(request);
    expect(proxyRes.status).not.toBe(403);

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(201);
  });

  it("refuses an upload one byte over the limit with 413 and guard message", async () => {
    const file = fileOfSize("over.md", "text/markdown", MAX_DOCUMENT_UPLOAD_BYTES + 1);
    const { request, delivered, bodyBytes } = platformUpload(file);
    request.headers.set("host", "localhost:3000");

    expect(bodyBytes).toBeLessThanOrEqual(PLATFORM_MAX_BODY_BYTES);
    expect(delivered).toBe(true);

    const proxyRes = proxy(request);
    expect(proxyRes.status).not.toBe(403);

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(413);

    const raw = await res.text();
    expect(raw).not.toBe("");
    const json = JSON.parse(raw);
    expect(json.error).toBe(`File too large (20.0MB). Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`);
    expect(mockConvertToMarkdown).not.toHaveBeenCalled();
  });

  it("answers a document just over the limit (20.5 MiB) with typed size rejection", async () => {
    const file = fileOfSize("huge.md", "text/markdown", MAX_DOCUMENT_UPLOAD_BYTES + 512 * 1024);
    const { request, delivered } = platformUpload(file);
    request.headers.set("host", "localhost:3000");

    expect(delivered).toBe(true);
    const proxyRes = proxy(request);
    expect(proxyRes.status).not.toBe(403);

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: `File too large (20.5MB). Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`,
    });
    expect(mockConvertToMarkdown).not.toHaveBeenCalled();
  });

  it("answers an oversized truncated upload with 413 and names the limit", async () => {
    const file = fileOfSize("oversized.md", "text/markdown", 30 * 1024 * 1024);
    const { request, bodyBytes } = platformUpload(file);
    request.headers.set("host", "localhost:3000");

    const proxyRes = proxy(request);
    expect(proxyRes.status).not.toBe(403);

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(413);
    const raw = await res.text();
    expect(raw).not.toBe("");
    const json = JSON.parse(raw);
    expect(json.error).toBe(oversizedDocumentUploadReason(bodyBytes));
    expect(json.error).toContain(`Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`);
    expect(mockConvertToMarkdown).not.toHaveBeenCalled();
  });

  it("answers a truncated upload with no declared content-length with 413", async () => {
    const headers = new Headers({
      host: "localhost:3000",
      "content-type": "multipart/form-data; boundary=----boundary",
    });
    const request = {
      headers,
      formData: async () => {
        throw new TypeError("Failed to parse body as FormData.");
      },
    } as unknown as import("next/server").NextRequest;

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: `Upload too large. Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`,
    });
  });

  it("does not blame the size limit for a small unparseable multipart body", async () => {
    const headers = new Headers({
      host: "localhost:3000",
      "content-length": "1024",
      "content-type": "multipart/form-data; boundary=----boundary",
    });
    const request = {
      headers,
      formData: async () => {
        throw new TypeError("Failed to parse body as FormData.");
      },
    } as unknown as import("next/server").NextRequest;

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Could not read the upload. Expected a multipart form body.",
    });
  });

  it("accepts an image document upload within the 20 MiB limit", async () => {
    dbMockState.getQueue = [
      null,
      {
        id: "doc-1",
        projectId: "proj-1",
        originalFilename: "architecture.png",
        kind: "image",
        markdownContent: null,
        imagePath: "data/documents/proj-1/doc-1-architecture.png",
      },
    ];

    const file = fileOfSize("architecture.png", "image/png", 15 * 1024 * 1024);
    const { request } = platformUpload(file);
    request.headers.set("host", "localhost:3000");

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(201);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("is collected by vitest rather than swept up by an exclude", () => {
    const repoRelative = path
      .relative(process.cwd(), fileURLToPath(import.meta.url))
      .split(path.sep);

    expect(repoRelative[0]).toBe("__tests__");
    expect(repoRelative.at(-1)).toMatch(/\.test\.ts$/);
    expect(vitestConfig.test?.include).toContain("**/*.test.{ts,tsx,mjs}");

    const excludedTrees = (vitestConfig.test?.exclude ?? []).map((pattern) =>
      pattern.replace(/^\*\*\//, "").replace(/\/\*\*$/, "")
    );
    expect(excludedTrees.length).toBeGreaterThan(0);
    for (const tree of excludedTrees) {
      expect(repoRelative).not.toContain(tree);
    }
  });
});

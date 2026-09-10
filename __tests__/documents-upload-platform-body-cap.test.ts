// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
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

  it("returns 400 for a small malformed chunked upload without content-length", async () => {
    const headers = new Headers({
      host: "localhost:3000",
      "content-type": "multipart/form-data; boundary=----boundary",
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.close();
      },
    });
    const request = new Request("http://localhost:3000/api/projects/proj-1/documents", {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: string }) as unknown as import("next/server").NextRequest;

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Could not read the upload. Expected a multipart form body.",
    });
  });

  it("answers a genuinely oversized chunked upload without content-length with 413", async () => {
    const headers = new Headers({
      host: "localhost:3000",
      "content-type": "multipart/form-data; boundary=----boundary",
    });
    const totalBytes = 21 * 1024 * 1024;
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= totalBytes) {
          controller.close();
          return;
        }
        const chunkSize = 1024 * 1024;
        const chunk = new Uint8Array(chunkSize);
        sent += chunkSize;
        controller.enqueue(chunk);
      },
    });
    const request = new Request("http://localhost:3000/api/projects/proj-1/documents", {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: string }) as unknown as import("next/server").NextRequest;

    const res = await POST(request, mockRouteContext({ projectId: "proj-1" }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("Upload too large (21.0MB including form overhead). Max: 20MB");
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

describe("executable HTTP integration against isolated Next.js server with proxy", () => {
  let port: number;
  let serverProc: ChildProcess;
  let dbPath: string;
  let projectId: string;

  beforeAll(async () => {
    port = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
      srv.on("error", reject);
    });

    dbPath = path.join(
      os.tmpdir(),
      `test-upload-suite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    const repoRoot = process.cwd();

    serverProc = spawn("node", ["./node_modules/next/dist/bin/next", "dev", "--port", String(port)], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        PORT: String(port),
        ARIJ_DB_PATH: dbPath,
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let ready = false;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const statusCode = await new Promise<number>((res, rej) => {
          const req = http.get(`http://127.0.0.1:${port}/api/projects`, (r) => {
            r.resume();
            res(r.statusCode ?? 0);
          });
          req.on("error", rej);
          req.setTimeout(1000);
        });
        if (statusCode === 200) {
          ready = true;
          break;
        }
      } catch {}
    }

    if (!ready) {
      if (serverProc.pid) {
        try {
          process.kill(-serverProc.pid, "SIGTERM");
        } catch {}
      }
      throw new Error(`Server failed to start on port ${port} within timeout`);
    }

    projectId = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/api/projects`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: `localhost:${port}`,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => {
            const json = JSON.parse(body);
            resolve(json.data.id);
          });
        }
      );
      req.on("error", reject);
      req.write(JSON.stringify({ name: "Live Upload Integration Project" }));
      req.end();
    });
  }, 60_000);

  afterAll(async () => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    if (serverProc?.pid) {
      try {
        process.kill(-serverProc.pid, "SIGTERM");
      } catch {}
    }
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        realFs.unlinkSync(f);
      } catch {}
    }
    if (projectId) {
      const storageDir = path.join(process.cwd(), "data", "documents", projectId);
      try {
        realFs.rmSync(storageDir, { recursive: true, force: true });
      } catch {}
    }
  });

  function executeUpload({
    fileName,
    fileSize,
    rawBody = null,
    chunked = false,
    boundary = "----LiveUploadBoundary",
  }: {
    fileName?: string;
    fileSize?: number;
    rawBody?: string | Buffer | null;
    chunked?: boolean;
    boundary?: string;
  }): Promise<{ status: number; body: string; json: any }> {
    return new Promise((resolve, reject) => {
      let header: Buffer | undefined;
      let footer: Buffer | undefined;
      if (!rawBody) {
        header = Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
            `Content-Type: text/plain\r\n\r\n`
        );
        footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      }

      const headers: Record<string, string> = {
        host: `localhost:${port}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      };

      if (!chunked) {
        const total = rawBody
          ? (typeof rawBody === "string" ? Buffer.byteLength(rawBody) : rawBody.length)
          : header!.length + (fileSize ?? 0) + footer!.length;
        headers["content-length"] = String(total);
      }

      const req = http.request(
        `http://127.0.0.1:${port}/api/projects/${projectId}/documents`,
        {
          method: "POST",
          headers,
        },
        (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => {
            let json = null;
            try {
              json = JSON.parse(body);
            } catch {}
            resolve({ status: res.statusCode ?? 0, body, json });
          });
        }
      );
      req.on("error", reject);

      if (rawBody) {
        req.write(rawBody);
        req.end();
      } else {
        req.write(header!);
        const chunkSize = 1024 * 1024;
        let written = 0;
        const totalFile = fileSize ?? 0;
        while (written < totalFile) {
          const toWrite = Math.min(chunkSize, totalFile - written);
          req.write(Buffer.alloc(toWrite, 0x61));
          written += toWrite;
        }
        req.write(footer!);
        req.end();
      }
    });
  }

  it("accepts a 12 MiB text document through real proxy buffering (201 Created)", async () => {
    const res = await executeUpload({ fileName: "live-12mb.txt", fileSize: 12 * 1024 * 1024 });
    expect(res.status).toBe(201);
    expect(res.json?.data?.id).toBeDefined();
    expect(res.json?.data?.originalFilename).toBe("live-12mb.txt");
    expect(res.json?.data?.kind).toBe("text");
  }, 30_000);

  it("accepts a 20 MiB document sitting exactly on the route limit (201 Created)", async () => {
    const res = await executeUpload({ fileName: "live-20mb.txt", fileSize: 20 * 1024 * 1024 });
    expect(res.status).toBe(201);
    expect(res.json?.data?.id).toBeDefined();
    expect(res.json?.data?.originalFilename).toBe("live-20mb.txt");
  }, 30_000);

  it("refuses a 20.5 MiB document with typed size 413 (within 21 MiB buffer, over 20 MiB limit)", async () => {
    const res = await executeUpload({
      fileName: "live-20.5mb.txt",
      fileSize: Math.floor(20.5 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(res.json?.error).toBe(`File too large (20.5MB). Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`);
  }, 30_000);

  it("refuses a 22 MiB document exceeding 21 MiB buffer cap with 413 and names the limit", async () => {
    const res = await executeUpload({ fileName: "live-22mb.txt", fileSize: 22 * 1024 * 1024 });
    expect(res.status).toBe(413);
    expect(res.json?.error).toBe(
      `Upload too large (22.0MB including form overhead). Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`
    );
  }, 30_000);

  it("returns 400 for a small malformed multipart payload with declared Content-Length", async () => {
    const res = await executeUpload({ rawBody: "12345", chunked: false });
    expect(res.status).toBe(400);
    expect(res.json?.error).toBe("Could not read the upload. Expected a multipart form body.");
  }, 30_000);

  it("returns 400 for a small malformed chunked upload without Content-Length", async () => {
    const res = await executeUpload({ rawBody: "12345", chunked: true });
    expect(res.status).toBe(400);
    expect(res.json?.error).toBe("Could not read the upload. Expected a multipart form body.");
  }, 30_000);

  it("refuses a genuinely oversized chunked upload exceeding the 21 MiB buffer cap with 413", async () => {
    const res = await executeUpload({
      fileName: "live-22mb-chunked.txt",
      fileSize: 22 * 1024 * 1024,
      chunked: true,
    });
    expect(res.status).toBe(413);
    expect(res.json?.error).toContain(`Max: ${MAX_DOCUMENT_UPLOAD_LABEL}`);
  }, 30_000);
});

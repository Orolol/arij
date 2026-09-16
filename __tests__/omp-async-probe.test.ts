import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("child_process", () => ({ default: { execFile: mock.execFile }, execFile: mock.execFile }));
import { probeOmpVersion, resetOmpVersionProbeForTests } from "@/lib/providers/omp-version";
beforeEach(() => { vi.clearAllMocks(); resetOmpVersionProbeForTests(); });
it("shares one asynchronous probe between concurrent callers and caches refusals", async () => {
  const first = probeOmpVersion();
  const second = probeOmpVersion();
  expect(mock.execFile).toHaveBeenCalledTimes(1);
  const callback = mock.execFile.mock.calls[0][3];
  callback(null, "omp/17.0.0", "");
  expect(await first).toEqual({ status: "ok", version: "17.0.0" });
  expect(await second).toEqual(await first);
  await probeOmpVersion();
  expect(mock.execFile).toHaveBeenCalledTimes(1);
});
it("bounds a hanging probe and reports unreadable output", async () => {
  mock.execFile.mockImplementation((_file, _args, options, callback) => {
    expect(options).toMatchObject({ timeout: 5000 });
    callback(new Error("timeout"), "", "");
  });
  expect(await probeOmpVersion()).toMatchObject({ status: "unreadable" });
});

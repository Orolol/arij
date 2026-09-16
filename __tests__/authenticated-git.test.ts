import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ raw: vi.fn(), env: vi.fn(), git: vi.fn() }));
vi.mock("simple-git", () => ({ default: mocks.git }));
vi.mock("@/lib/github/client", () => ({ getGitHubTokenFromSettings: () => "private-secret" }));
import { runAuthenticatedGit } from "@/lib/git/authenticated";
beforeEach(() => { vi.clearAllMocks(); mocks.env.mockReturnValue({ raw: mocks.raw }); mocks.git.mockReturnValue({ env: mocks.env }); mocks.raw.mockResolvedValue("done"); });
it("scopes ephemeral credentials to GitHub and propagates cancellation", async () => {
  const signal = new AbortController().signal;
  await runAuthenticatedGit("/repo", ["fetch", "origin"], { signal });
  expect(mocks.git).toHaveBeenCalledWith(expect.objectContaining({ baseDir: "/repo", abort: signal }));
  expect(mocks.env).toHaveBeenCalledWith(expect.objectContaining({ GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" }));
  expect(mocks.raw).toHaveBeenCalledWith(["-c", expect.stringMatching(/^http\.https:\/\/github\.com\/\.extraHeader=Authorization: Basic /), "fetch", "origin"]);
});
it("never exposes the authenticated command in a failure", async () => {
  const secret = Buffer.from("x-access-token:private-secret").toString("base64");
  mocks.raw.mockRejectedValue(new Error(`git -c http.https://github.com/.extraHeader=Authorization: Basic ${secret} failed`));
  await expect(runAuthenticatedGit("/repo", ["push", "origin", "main"])).rejects.not.toThrow(secret);
});
it("does not add credentials when explicitly disabled", async () => {
  await runAuthenticatedGit("/repo", ["fetch", "origin"], { token: null });
  expect(mocks.raw).toHaveBeenCalledWith(["fetch", "origin"]);
});

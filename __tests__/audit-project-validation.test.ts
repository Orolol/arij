import { describe, expect, it } from "vitest";
import { createProjectSchema, updateProjectSchema } from "@/lib/validation/schemas";

describe("GitHub project references", () => {
  it.each(["foo", "owner/../repo", "../repo", "owner/-repo", "owner/repo/extra"])("rejects %s on both write paths", (githubOwnerRepo) => {
    expect(createProjectSchema.safeParse({ name: "Demo", githubOwnerRepo }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ githubOwnerRepo }).success).toBe(false);
  });
  it.each([null, "openai/example.repo"])("accepts %s", (githubOwnerRepo) => {
    expect(updateProjectSchema.safeParse({ githubOwnerRepo }).success).toBe(true);
  });
});

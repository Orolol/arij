import { NextRequest, NextResponse } from "next/server";
import { parseGitHubRepoInput } from "@/lib/git/remote";
import { cloneProjectSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

export async function POST(request: NextRequest) {
  const validated = await validateBody(cloneProjectSchema, request);
  if (isValidationError(validated)) return validated;

  const { url, branch } = validated.data;

  const parsed = parseGitHubRepoInput(url);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Not a valid GitHub repository. Use https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo.",
      },
      { status: 400 }
    );
  }

  // The clone service itself lands with the "Service de clone git" epic; this
  // route already resolves the request so the git layer only ever receives an
  // owner/repo pair that passed strict validation.
  return NextResponse.json(
    {
      error: "Clone service is not available yet.",
      data: {
        owner: parsed.owner,
        repo: parsed.repo,
        ownerRepo: parsed.ownerRepo,
        cloneUrl: parsed.cloneUrl,
        branch: branch ?? null,
      },
    },
    { status: 501 }
  );
}

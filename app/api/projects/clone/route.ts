import { NextRequest, NextResponse } from "next/server";
import { parseGitHubRepoInput } from "@/lib/git/remote";
import {
  cloneGitHubRepo,
  CloneServiceUnavailableError,
} from "@/lib/git/clone";
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

  // The git layer only ever receives an owner/repo pair that passed strict
  // validation. The service body lands with the "Service de clone git" epic.
  try {
    const result = await cloneGitHubRepo({
      repo: parsed,
      branch: branch ?? null,
    });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof CloneServiceUnavailableError) {
      return NextResponse.json({ error: e.message }, { status: 501 });
    }

    // A raw git error can echo back the `http.extraHeader` Authorization value,
    // so nothing from the git layer reaches the client until the clone epic
    // adds its redaction helper.
    console.error("[clone] Clone failed:", e);
    return NextResponse.json(
      { error: "Clone failed. Check the repository URL and your GitHub token." },
      { status: 500 }
    );
  }
}

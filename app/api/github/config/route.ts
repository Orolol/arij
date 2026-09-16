import { NextResponse } from "next/server";
import { getGitHubTokenFromSettings } from "@/lib/github/client";
export function GET() {
  return NextResponse.json({ data: { tokenSet: Boolean(getGitHubTokenFromSettings()) } });
}

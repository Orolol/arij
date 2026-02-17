import { NextRequest, NextResponse } from "next/server";
import {
  getLabelMapping,
  saveLabelMapping,
} from "@/lib/github/label-mapping";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const mapping = getLabelMapping(projectId);
  return NextResponse.json({ data: mapping });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const body = await request.json();

  const featureLabels = Array.isArray(body.featureLabels)
    ? body.featureLabels.filter((l: unknown) => typeof l === "string")
    : undefined;
  const bugLabels = Array.isArray(body.bugLabels)
    ? body.bugLabels.filter((l: unknown) => typeof l === "string")
    : undefined;

  if (!featureLabels && !bugLabels) {
    return NextResponse.json(
      { error: "Provide featureLabels or bugLabels" },
      { status: 400 }
    );
  }

  const current = getLabelMapping(projectId);
  const updated = {
    featureLabels: featureLabels || current.featureLabels,
    bugLabels: bugLabels || current.bugLabels,
  };

  saveLabelMapping(updated, projectId);
  return NextResponse.json({ data: updated });
}

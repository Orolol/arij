import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import {
  getLabelMapping,
  saveLabelMapping,
} from "@/lib/github/label-mapping";

type Params = { params: Promise<{ projectId: string }> };

const labelMappingSchema = z.object({
  featureLabels: z.array(z.string()).optional(),
  bugLabels: z.array(z.string()).optional(),
});

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const mapping = getLabelMapping(projectId);
  return NextResponse.json({ data: mapping });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const validated = await validateBody(labelMappingSchema, request);
  if (isValidationError(validated)) return validated;
  const { featureLabels, bugLabels } = validated.data;

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

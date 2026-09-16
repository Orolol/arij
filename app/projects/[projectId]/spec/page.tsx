"use client";

import { useParams } from "next/navigation";
import { SpecWorkspace } from "@/components/spec/SpecWorkspace";

export default function SpecRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  return <SpecWorkspace key={projectId} projectId={projectId} />;
}

"use client";

import { MentionTextarea } from "@/components/documents/MentionTextarea";

interface SpecEditorProps {
  projectId: string;
  value: string;
  onChange: (value: string) => void;
}

export function SpecEditor({ projectId, value, onChange }: SpecEditorProps) {
  return (
    <MentionTextarea
      projectId={projectId}
      value={value}
      onValueChange={onChange}
      placeholder="Write your project specification in markdown..."
      className="min-h-[460px] rounded-[10px] font-mono text-[13px] leading-[1.7]"
    />
  );
}

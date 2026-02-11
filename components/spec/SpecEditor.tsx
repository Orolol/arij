"use client";

import { Textarea } from "@/components/ui/textarea";

interface SpecEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function SpecEditor({ value, onChange }: SpecEditorProps) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Write your project specification in markdown..."
      className="min-h-[500px] font-mono text-sm"
    />
  );
}

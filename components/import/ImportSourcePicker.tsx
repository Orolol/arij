"use client";

import { FolderOpen, Github } from "lucide-react";
import { cn } from "@/lib/utils";

export type ImportSource = "local" | "github";

interface ImportSourcePickerProps {
  value: ImportSource;
  onChange: (source: ImportSource) => void;
}

const OPTIONS: Array<{
  value: ImportSource;
  label: string;
  hint: string;
  Icon: typeof FolderOpen;
}> = [
  {
    value: "local",
    label: "Local folder",
    hint: "A repository already on this machine",
    Icon: FolderOpen,
  },
  {
    value: "github",
    label: "GitHub URL",
    hint: "Arij clones it into its workspace",
    Icon: Github,
  },
];

/** Where the project comes from: a path on disk, or a repository to clone. */
export function ImportSourcePicker({ value, onChange }: ImportSourcePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Import source"
      className="grid grid-cols-2 gap-3 mb-6"
    >
      {OPTIONS.map(({ value: option, label, hint, Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            )}
          >
            <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

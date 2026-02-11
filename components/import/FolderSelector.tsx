"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderOpen } from "lucide-react";

interface FolderSelectorProps {
  onAnalyze: (path: string) => void;
}

export function FolderSelector({ onAnalyze }: FolderSelectorProps) {
  const [path, setPath] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Enter the full path to your existing project folder. Claude Code will
        analyze its structure and generate epics and user stories.
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/your/project"
            className="pl-10"
          />
        </div>
        <Button onClick={() => onAnalyze(path)} disabled={!path.trim()}>
          Analyze
        </Button>
      </div>
    </div>
  );
}

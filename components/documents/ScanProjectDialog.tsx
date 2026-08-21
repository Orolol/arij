"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FolderSearch, Loader2 } from "lucide-react";

interface ScannedFile {
  name: string;
  relativePath: string;
  sizeBytes: number;
}

interface ScanResult {
  root: string;
  files: ScannedFile[];
  errors: string[];
  truncated: boolean;
}

interface ScanProjectDialogProps {
  projectId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "Scanner le projet" — one click opens the dialog and immediately runs the
 * filesystem scan (POST /api/projects/:id/documents/scan), listing every
 * detected document with its name, repo-relative path and size. Import of the
 * selected files and already-imported dedup are handled by a sibling ticket.
 */
export function ScanProjectDialog({ projectId }: ScanProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/scan`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Scan failed (HTTP ${res.status}).`);
        return;
      }
      setResult(data.data as ScanResult);
    } catch {
      setError("Scan failed: could not reach the server.");
    } finally {
      setScanning(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) runScan();
  }, [open, runScan]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setError(null);
        }
      }}
    >
      <Button
        variant="outline"
        size="sm"
        className="gap-[7px]"
        onClick={() => setOpen(true)}
      >
        <FolderSearch className="h-[14px] w-[14px]" />
        Scanner le projet
      </Button>
      <DialogContent className="rounded-[14px] shadow-[0_18px_40px_rgba(58,48,44,.14)] sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold">
            Scanner le projet
          </DialogTitle>
          <DialogDescription>
            Documents détectés dans le dépôt (pdf, md, txt, doc, docx). Les
            répertoires .git, node_modules, dist, build, etc. sont ignorés.
          </DialogDescription>
        </DialogHeader>

        {scanning && (
          <div className="flex items-center gap-2 py-[18px] text-[13.5px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Scan en cours...</span>
          </div>
        )}

        {error && <p className="text-[13px] text-destructive">{error}</p>}

        {result && !scanning && (
          <div className="flex flex-col gap-[10px]">
            {result.errors.length > 0 && (
              <div className="flex flex-col gap-[4px] rounded-[8px] border border-destructive/40 bg-destructive/5 p-[10px]">
                {result.errors.map((scanError) => (
                  <p
                    key={scanError}
                    className="font-mono text-[11.5px] text-destructive"
                  >
                    {scanError}
                  </p>
                ))}
              </div>
            )}
            {result.truncated && (
              <p className="text-[12.5px] text-muted-foreground">
                Liste tronquée aux 500 premiers fichiers.
              </p>
            )}
            {result.files.length === 0 ? (
              <p className="py-[10px] text-[13.5px] text-muted-foreground">
                Aucun document détecté dans le projet.
              </p>
            ) : (
              <div className="flex max-h-[380px] flex-col overflow-y-auto rounded-[8px] border border-border">
                {result.files.map((file) => (
                  <div
                    key={file.relativePath}
                    className="flex items-baseline gap-[10px] border-b border-border px-[12px] py-[8px] last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {file.name}
                    </span>
                    <span className="min-w-0 flex-[2] truncate font-mono text-[11px] text-meta">
                      {file.relativePath}
                    </span>
                    <span className="flex-none font-mono text-[11px] text-meta">
                      {formatSize(file.sizeBytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[12px] text-muted-foreground">
              {result.files.length} document
              {result.files.length === 1 ? "" : "s"} détecté
              {result.files.length === 1 ? "" : "s"}.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

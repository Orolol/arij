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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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

interface SkippedImportFile {
  relativePath: string;
  reason: string;
}

interface ImportResponse {
  imported: Array<{ originalFilename: string }>;
  skipped: SkippedImportFile[];
}

interface ScanProjectDialogProps {
  projectId: string;
  /** Refreshes the page's document list after a scan import lands. */
  onImported?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "Scanner le projet" — one click opens the dialog and immediately runs the
 * filesystem scan (POST /api/projects/:id/documents/scan), listing every
 * detected document with its name, repo-relative path and size.
 *
 * Nothing is imported without an explicit user selection: checkboxes start
 * unchecked ("Tout sélectionner" sweeps the importable files), and files
 * whose basename already exists in the project's documents are marked
 * « déjà importé » and cannot be re-imported — mirroring the upload route's
 * case-insensitive uniqueness rule.
 */
export function ScanProjectDialog({
  projectId,
  onImported,
}: ScanProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    importedCount: number;
    skipped: SkippedImportFile[];
  } | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    setSelected(new Set());
    setImportSummary(null);
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

  // Basenames already registered as project documents — the same key the
  // upload route dedups on (case-insensitive originalFilename).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/documents`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const docs = (Array.isArray(data.data) ? data.data : []) as Array<{
          originalFilename: string;
        }>;
        setExistingNames(
          new Set(docs.map((doc) => doc.originalFilename.toLowerCase()))
        );
      } catch {
        // A failed name lookup must not block scanning: worst case the user
        // selects an already-imported file and the server skips it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (open) runScan();
  }, [open, runScan]);

  const isImportable = useCallback(
    (file: ScannedFile) => !existingNames.has(file.name.toLowerCase()),
    [existingNames]
  );

  const importableFiles = result?.files.filter(isImportable) ?? [];
  const allSelected =
    importableFiles.length > 0 &&
    importableFiles.every((file) => selected.has(file.relativePath));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const file of importableFiles) next.delete(file.relativePath);
      } else {
        for (const file of importableFiles) next.add(file.relativePath);
      }
      return next;
    });
  }

  function toggleFile(relativePath: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }

  async function importSelection() {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relativePaths: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Import failed (HTTP ${res.status}).`);
        return;
      }
      const payload = data.data as ImportResponse;
      setExistingNames((prev) => {
        const next = new Set(prev);
        for (const doc of payload.imported) {
          next.add(doc.originalFilename.toLowerCase());
        }
        return next;
      });
      setSelected(new Set());
      setImportSummary({
        importedCount: payload.imported.length,
        skipped: payload.skipped,
      });
      onImported?.();
    } catch {
      setError("Import failed: could not reach the server.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setError(null);
          setSelected(new Set());
          setImportSummary(null);
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
            Cochez les fichiers à importer.
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
              <>
                <label className="flex cursor-pointer items-center gap-[8px] text-[13px] font-medium">
                  <Checkbox
                    checked={allSelected}
                    disabled={importableFiles.length === 0}
                    onCheckedChange={toggleAll}
                    aria-label="Tout sélectionner"
                  />
                  Tout sélectionner
                </label>
                <div className="flex max-h-[380px] flex-col overflow-y-auto rounded-[8px] border border-border">
                  {result.files.map((file) => {
                    const alreadyImported = !isImportable(file);
                    return (
                      <label
                        key={file.relativePath}
                        className={`flex items-center gap-[10px] border-b border-border px-[12px] py-[8px] last:border-b-0 ${
                          alreadyImported ? "opacity-60" : "cursor-pointer"
                        }`}
                      >
                        <Checkbox
                          checked={selected.has(file.relativePath)}
                          disabled={alreadyImported}
                          onCheckedChange={() => toggleFile(file.relativePath)}
                          aria-label={`Sélectionner ${file.relativePath}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {file.name}
                        </span>
                        {alreadyImported && (
                          <Badge
                            variant="secondary"
                            className="flex-none text-[10px]"
                          >
                            déjà importé
                          </Badge>
                        )}
                        <span className="min-w-0 flex-[2] truncate font-mono text-[11px] text-meta">
                          {file.relativePath}
                        </span>
                        <span className="flex-none font-mono text-[11px] text-meta">
                          {formatSize(file.sizeBytes)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-[10px]">
              <p className="text-[12px] text-muted-foreground">
                {result.files.length} document
                {result.files.length === 1 ? "" : "s"} détecté
                {result.files.length === 1 ? "" : "s"} ·{" "}
                {selected.size} sélectionné{selected.size === 1 ? "" : "s"}
              </p>
              <Button
                size="sm"
                className="gap-[7px]"
                disabled={selected.size === 0 || importing}
                onClick={importSelection}
              >
                {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Importer la sélection
                {selected.size > 0 ? ` (${selected.size})` : ""}
              </Button>
            </div>
            {importSummary && (
              <div className="flex flex-col gap-[4px] rounded-[8px] border border-border bg-muted/40 p-[10px]">
                <p className="text-[12.5px]">
                  {importSummary.importedCount} document
                  {importSummary.importedCount === 1 ? "" : "s"} importé
                  {importSummary.importedCount === 1 ? "" : "s"}.
                </p>
                {importSummary.skipped.length > 0 && (
                  <div className="flex flex-col gap-[2px]">
                    {importSummary.skipped.map((entry) => (
                      <p
                        key={entry.relativePath}
                        className="font-mono text-[11px] text-muted-foreground"
                      >
                        {entry.relativePath} — {entry.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

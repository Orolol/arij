"use client";

interface DocumentViewerProps {
  kind: "text" | "image";
  markdownContent: string | null;
  imagePath: string | null;
}

export function DocumentViewer({
  kind,
  markdownContent,
  imagePath,
}: DocumentViewerProps) {
  if (kind === "image") {
    return (
      <div className="max-h-[600px] overflow-auto rounded-[12px] border border-border bg-card p-[18px]">
        <p className="text-[13px] font-medium">Image Document</p>
        <p className="mt-[6px] break-all font-mono text-[11.5px] text-meta">
          Filesystem path: {imagePath || "(missing path)"}
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[600px] overflow-auto rounded-[12px] border border-border bg-card p-[18px]">
      <div className="whitespace-pre-wrap text-[13.5px] leading-[1.7] text-foreground">
        {markdownContent || ""}
      </div>
    </div>
  );
}

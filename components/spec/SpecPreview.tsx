"use client";

interface SpecPreviewProps {
  markdown: string;
}

export function SpecPreview({ markdown }: SpecPreviewProps) {
  if (!markdown) {
    return (
      <p className="text-muted-foreground text-sm py-4">
        No specification written yet. Use the editor or generate one from the
        chat.
      </p>
    );
  }

  return (
    <div className="border border-border rounded-lg p-6 max-h-[600px] overflow-auto">
      <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap">
        {markdown}
      </div>
    </div>
  );
}

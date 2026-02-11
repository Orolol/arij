"use client";

import { useEffect, useState } from "react";

interface DocumentViewerProps {
  markdown: string;
}

export function DocumentViewer({ markdown }: DocumentViewerProps) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    // Convert markdown to HTML on client side
    // We use a simple approach: render the raw markdown in a pre block
    // For production, you'd call an API endpoint or use a client-side markdown lib
    setHtml(markdown);
  }, [markdown]);

  return (
    <div className="border border-border rounded-lg p-4 max-h-[600px] overflow-auto">
      <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap">
        {html}
      </div>
    </div>
  );
}

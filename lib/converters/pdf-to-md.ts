export async function pdfToMarkdown(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid SSR issues with pdfjs-dist/canvas
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

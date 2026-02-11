import mammoth from "mammoth";

// mammoth ships convertToMarkdown at runtime but the bundled type
// declarations do not include it.  Augment the type so TypeScript is happy.
const mammothWithMarkdown = mammoth as typeof mammoth & {
  convertToMarkdown: typeof mammoth.convertToHtml;
};

export async function docxToMarkdown(buffer: Buffer): Promise<string> {
  const result = await mammothWithMarkdown.convertToMarkdown({ buffer });
  return result.value;
}

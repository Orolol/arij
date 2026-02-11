import { docxToMarkdown } from "./docx-to-md";

const MIME_PDF = "application/pdf";
const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_MARKDOWN = "text/markdown";
const MIME_PLAIN = "text/plain";

export async function convertToMarkdown(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  switch (mimeType) {
    case MIME_PDF: {
      const { pdfToMarkdown } = await import("./pdf-to-md");
      return pdfToMarkdown(buffer);
    }

    case MIME_DOCX:
      return docxToMarkdown(buffer);

    case MIME_MARKDOWN:
    case MIME_PLAIN:
      return buffer.toString("utf-8");

    default:
      throw new Error(
        `Unsupported file type "${mimeType}" for file "${fileName}"`,
      );
  }
}

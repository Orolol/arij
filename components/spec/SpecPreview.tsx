"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SpecPreviewProps {
  markdown: string;
}

export function SpecPreview({ markdown }: SpecPreviewProps) {
  if (!markdown) {
    return (
      <p className="text-[14px] text-muted-foreground">
        No specification written yet. Use the editor or generate one from the
        chat.
      </p>
    );
  }

  return (
    <div className="text-[14.5px] leading-[1.7] text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-[12px] mt-[26px] text-[26px] font-semibold tracking-[-0.01em] first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-[10px] mt-[26px] text-[20px] font-semibold first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-[10px] mt-[26px] text-[17px] font-semibold first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-[8px] mt-[20px] text-[15px] font-semibold first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="mb-[12px] last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-[12px] list-disc pl-[20px] leading-[1.8]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-[12px] list-decimal pl-[20px] leading-[1.8]">
              {children}
            </ol>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-[12px] border-l-2 border-border pl-[14px] text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-[22px] border-border-soft" />,
          code: ({ className, children }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code className="font-mono text-[12.5px]">{children}</code>
              );
            }
            return (
              <code className="rounded bg-band px-[5px] py-[2px] font-mono text-[12.5px]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-[12px] overflow-x-auto rounded-[10px] bg-band p-[14px] leading-[1.7]">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-[12px] overflow-x-auto">
              <table className="w-full text-[13.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-[10px] py-[7px] text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border-soft px-[10px] py-[7px] align-top">
              {children}
            </td>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

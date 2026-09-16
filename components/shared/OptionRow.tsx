import { cn } from "@/lib/utils";

/** A labelled option and its optional explanation in a settings dialog. */
export function OptionRow({
  label,
  htmlFor,
  hint,
  last = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-t border-border-soft py-[11px]",
        last && "border-b"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="text-[12.5px] text-muted-foreground"
          >
            {label}
          </label>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">{label}</span>
        )}
        <div className="flex shrink-0 items-center gap-[6px] text-[13px]">
          {children}
        </div>
      </div>
      {hint && <p className="text-[11.5px] text-meta">{hint}</p>}
    </div>
  );
}


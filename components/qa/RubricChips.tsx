"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The checklist chips of LA RUBRIQUE — the bold headings of the feature-review
 * checklist the reviewers are actually handed, read from the real prompt
 * section rather than restated here.
 */
export interface RubricChipsProps {
  items: readonly string[];
  className?: string;
}

export function RubricChips({ items, className }: RubricChipsProps) {
  // No copy here: every chip is a checklist item, resolved by the caller.
  return (
    <div className={cn("flex flex-wrap gap-[7px]", className)}>
      {items.map((item) => (
        <span
          key={item}
          data-testid="qa-rubric-chip"
          className="flex h-[27px] items-center gap-[6px] rounded-full bg-card px-[11px] font-sans text-[12px] font-medium text-foreground"
        >
          <Check
            size={11}
            aria-hidden="true"
            className="shrink-0 text-strata-live-deep"
          />
          {item}
        </span>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { compactElapsed, formatElapsed } from "@/lib/utils/format-elapsed";

/**
 * The ticking elapsed-time numeral (5a session cards 21px, 6a overlay header
 * 19px, 8a session header 20px).
 *
 * Owns its own 1s interval, cleared on unmount. Do NOT format elapsed time
 * inline during a parent's render the way `components/dashboard/ProjectGrid.tsx`
 * does — such a chrono only advances on the parent's 10s poll.
 */

export interface ChronoProps {
  /** ISO timestamp the session started at. */
  startedAt: string;
  /** px. 21 on 5a cards, 20 on the 8a header, 19 on the 6a overlay header. */
  size?: number;
  tone?: "live" | "ink";
  className?: string;
}

export function Chrono({
  startedAt,
  size = 21,
  tone = "live",
  className,
}: ChronoProps) {
  const [label, setLabel] = useState(() => compactElapsed(formatElapsed(startedAt)));

  useEffect(() => {
    function tick() {
      setLabel(compactElapsed(formatElapsed(startedAt)));
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    // The server and the first client paint can straddle a second boundary.
    <span
      data-slot="chrono"
      className={cn(
        // tabular-nums ALWAYS, even where a frame omits it — that is a canvas
        // oversight, and a per-second ticker without tabular figures jitters.
        "shrink-0 font-mono font-bold tabular-nums",
        tone === "ink" ? "text-foreground" : "text-strata-live-deep",
        className,
      )}
      // Open number, so it stays inline; everything enumerable is a class.
      style={{ fontSize: `${size}px` }}
      suppressHydrationWarning
    >
      {label}
    </span>
  );
}

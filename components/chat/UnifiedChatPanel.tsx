"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageSquare, PanelRightClose, PanelRightOpen, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/chat/ChatPanel";

const DEFAULT_PANEL_RATIO = 0.4;
const MIN_PANE_WIDTH = 300;
const DIVIDER_WIDTH = 6;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type UnifiedPanelState = "collapsed" | "expanded" | "hidden";

export interface UnifiedChatPanelHandle {
  openChat: () => void;
  openNewEpic: () => void;
  collapse: () => void;
  hide: () => void;
}

interface UnifiedChatPanelProps {
  projectId: string;
  children: ReactNode;
}

export const UnifiedChatPanel = forwardRef<UnifiedChatPanelHandle, UnifiedChatPanelProps>(
  function UnifiedChatPanel({ projectId, children }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [panelState, setPanelState] = useState<UnifiedPanelState>("collapsed");
    const [panelRatio, setPanelRatio] = useState(DEFAULT_PANEL_RATIO);
    const [isDragging, setIsDragging] = useState(false);

    const storageKey = useMemo(
      () => `arij.unified-chat-panel.ratio.${projectId}`,
      [projectId],
    );

    const getContainerWidth = useCallback(() => {
      if (typeof window === "undefined") {
        return 1200;
      }
      return containerRef.current?.clientWidth || window.innerWidth || 1200;
    }, []);

    const computePanelWidth = useCallback(
      (ratio: number) => {
        const totalWidth = getContainerWidth();
        const minRatio = MIN_PANE_WIDTH / totalWidth;
        const maxRatio = (totalWidth - MIN_PANE_WIDTH - DIVIDER_WIDTH) / totalWidth;
        const safeRatio = clamp(ratio, minRatio, maxRatio);
        return Math.round(totalWidth * safeRatio);
      },
      [getContainerWidth],
    );

    const panelWidthPx = computePanelWidth(panelRatio);

    const openExpanded = useCallback(() => {
      setPanelState("expanded");
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        openChat() {
          openExpanded();
        },
        openNewEpic() {
          openExpanded();
        },
        collapse() {
          setPanelState("collapsed");
        },
        hide() {
          setPanelState("hidden");
        },
      }),
      [openExpanded],
    );

    useEffect(() => {
      if (typeof window === "undefined") {
        return;
      }
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return;
      }
      setPanelRatio(parsed);
    }, [storageKey]);

    useEffect(() => {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(storageKey, panelRatio.toFixed(4));
    }, [panelRatio, storageKey]);

    useEffect(() => {
      if (!isDragging || panelState !== "expanded") {
        return;
      }

      function onMove(event: MouseEvent) {
        const totalWidth = getContainerWidth();
        const nextPanelWidth = clamp(
          totalWidth - event.clientX,
          MIN_PANE_WIDTH,
          totalWidth - MIN_PANE_WIDTH - DIVIDER_WIDTH,
        );
        setPanelRatio(nextPanelWidth / totalWidth);
      }

      function onUp() {
        setIsDragging(false);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);

      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
    }, [isDragging, panelState, getContainerWidth]);

    useEffect(() => {
      function onEscape(event: KeyboardEvent) {
        if (event.key === "Escape") {
          setPanelState((state) => (state === "expanded" ? "collapsed" : state));
        }
      }

      window.addEventListener("keydown", onEscape);
      return () => window.removeEventListener("keydown", onEscape);
    }, []);

    function handleResetDivider() {
      setPanelRatio(DEFAULT_PANEL_RATIO);
    }

    if (panelState === "expanded") {
      return (
        <div ref={containerRef} className="flex h-full w-full overflow-hidden">
          <div
            className="h-full min-w-[300px] overflow-hidden"
            style={{ width: `calc(100% - ${panelWidthPx}px - ${DIVIDER_WIDTH}px)` }}
          >
            {children}
          </div>

          <button
            type="button"
            aria-label="Resize panel"
            data-testid="panel-divider"
            onMouseDown={() => setIsDragging(true)}
            onDoubleClick={handleResetDivider}
            className={cn(
              "h-full w-[6px] shrink-0 border-l border-r border-border/60 bg-muted/60 transition-colors",
              isDragging ? "bg-primary/30" : "hover:bg-primary/20",
            )}
          />

          <aside
            className="h-full shrink-0 border-l border-border bg-background/95 backdrop-blur transition-all duration-200"
            style={{ width: panelWidthPx }}
            data-testid="unified-panel-expanded"
          >
            <div className="flex h-10 items-center justify-end gap-1 border-b border-border px-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPanelState("collapsed")}
                aria-label="Collapse panel"
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPanelState("hidden")}
                aria-label="Hide panel"
              >
                <EyeOff className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-2.5rem)]">
              <ChatPanel projectId={projectId} />
            </div>
          </aside>
        </div>
      );
    }

    return (
      <div ref={containerRef} className="relative h-full w-full overflow-hidden">
        <div className="h-full w-full">{children}</div>

        {panelState === "collapsed" && (
          <button
            type="button"
            onClick={() => setPanelState("expanded")}
            className="absolute inset-y-0 right-0 z-30 flex w-[max(56px,5vw)] items-center justify-center border-l border-border bg-muted/60 text-muted-foreground backdrop-blur transition-colors hover:bg-muted/80 hover:text-foreground"
            aria-label="Open chat panel"
            data-testid="collapsed-chat-strip"
          >
            <span className="flex flex-col items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em]">
              <MessageSquare className="h-4 w-4" />
              Chat
            </span>
          </button>
        )}

        {panelState === "hidden" && (
          <button
            type="button"
            onClick={() => setPanelState("collapsed")}
            className="absolute right-2 top-2 z-30 rounded-full border border-border bg-background/95 p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
            aria-label="Show chat strip"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  },
);

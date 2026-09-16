"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { SurfaceCard } from "@/components/piscine/SurfaceCard";

export interface ToastItem {
  id: string;
  type: ToastTone;
  message: string;
  href?: string;
  actionLabel?: string;
}

/**
 * The ONE tone vocabulary. Every surface aliases this rather than re-declaring
 * the union — three copies of it had already drifted out of one file each.
 */
export type ToastTone = "success" | "error" | "warning";

/** The optional deep link a toast can carry, e.g. to the session in the way. */
export interface ToastAction {
  href: string;
  label?: string;
}

/** What a surface calls to raise one. See `useToastStack`. */
export type RaiseToast = (
  tone: ToastTone,
  message: string,
  action?: ToastAction,
) => void;

export const TOAST_DURATION_MS = 8000;
export const MAX_TOASTS = 4;

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** The app's ONE toast stack; the portal is what escapes a page's scroll containers. */
export function ToastStack({ items, onDismiss, testId }: {
  items: readonly ToastItem[];
  onDismiss: (id: string) => void;
  testId?: string;
}) {
  const t = useTranslations("Toast");
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  if (!mounted) return null;
  return createPortal(
    /*
      `aria-live` is what keeps this region out of a modal's hidden subtree,
      and it is load-bearing rather than decorative.

      A Radix `DialogContent` calls `hideOthers(content)` from `aria-hidden`,
      which stamps `aria-hidden="true"` on every other child of `document.body`
      — this portal included. The toast stayed painted over the dialog
      (`z-[100]` against `z-50`) while the region, the `alert` and the dismiss
      button all dropped out of the accessibility tree, so a failure raised
      from an open dialog was never announced. That is not an edge case: the
      story detail page keeps its delete dialog open when the DELETE fails and
      raises the error toast over it, `/projects/:id` raises toasts from its
      epic, quick-capture and bug dialogs, and `QaScreen` raises one from
      `DismissDialog`.

      `hideOthers` sweeps `[aria-live], script` and adds those nodes to the set
      it keeps — its documented opt-out for exactly this case. It has to sit on
      the SECTION, not on a toast: the sweep snapshots the DOM when the dialog
      opens, and by then the section exists (it renders empty) while the toast
      that the failure is about does not.

      `off` is the value because it is already the computed default, so writing
      it claims the opt-out and changes nothing else. `polite` here would make
      the container a second live region and announce the same insertion twice.
      Measured in Chrome over this exact shape: the region exposes no live
      property at all, while the `alert` inside it still computes
      `live: assertive`, `atomic: true` — an ancestor `off` does not suppress a
      descendant that declares its own. Pinned in
      `__tests__/toast-under-open-dialog.test.tsx`.

      The dialog stays modal, so its focus trap still owns Tab while it is
      open — the announcement is restored, not the tab order. See that test
      file for the boundary.
    */
    <section aria-label={t("stack.label")} aria-live="off" className="pointer-events-none fixed right-4 top-[76px] z-[100] flex max-h-[calc(100dvh-92px)] w-[380px] max-w-[calc(100vw-32px)] flex-col gap-3 overflow-y-auto">
      {items.slice(-MAX_TOASTS).map((item) => (
        <Toast key={item.id} item={item} onDismiss={onDismiss} testId={testId} />
      ))}
    </section>,
    document.body,
  );
}

function Toast({ item, onDismiss, testId }: {
  item: ToastItem;
  onDismiss: (id: string) => void;
  testId?: string;
}) {
  const t = useTranslations("Toast");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Errors remain until dismissed. Reading or following a link pauses expiry.
  useEffect(() => {
    if (hovered || focused || item.type !== "success") return;
    const timer = setTimeout(() => onDismiss(item.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [hovered, focused, item.id, item.type, onDismiss]);
  const Icon = item.type === "success" ? CheckCircle2 : TriangleAlert;
  return (
    <SurfaceCard
      role={item.type === "success" ? "status" : "alert"}
      aria-atomic="true"
      data-testid={testId}
      data-toast-type={item.type}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className="pointer-events-auto flex items-start gap-3 border-border-strong p-4 font-sans text-[13px] text-foreground shadow-lg"
    >
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p>{item.message}</p>
        {item.href ? (
          <a href={item.href} className="mt-2 inline-block font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            {/* Where an action-less link lands, when the caller names
                nothing better. */}
            {item.actionLabel || t("stack.defaultAction")}
          </a>
        ) : null}
      </div>
      {/*
        This label was the last French string in the interface, and it carried
        no accent — so neither the epic's own accent grep nor a French-word
        scan found it. It surfaced only because a sweep read the file. Its
        French is seeded in `fr/Notifications.json`, and the three unit tests
        plus `e2e/desk-toasts.spec.ts` that pinned the old bytes were updated
        with it.
      */}
      <button type="button" aria-label={t("stack.dismiss")} onClick={() => onDismiss(item.id)} className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <X size={15} aria-hidden="true" />
      </button>
    </SurfaceCard>
  );
}

"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  className?: string;
  /**
   * Id of this field's control, applied to *both* of its states: the read
   * state is a real `<button>`, which HTML counts as labelable, so a caller's
   * single visible `<label htmlFor={...}>` associates the plain way whichever
   * state is mounted — and stays clickable in the read state, which is the one
   * users land on. It used to reach the editing control only, so `htmlFor`
   * resolved to nothing until the field was already open.
   */
  id?: string;
  /**
   * Id of the element naming this field. Composed with the read state's own
   * value below rather than used alone: `aria-labelledby` overrides name from
   * content, so pointing it at the label by itself computed the region's name
   * to "Description" and dropped the stored text — a screen reader in focus
   * mode then announced the field and nothing about what it holds.
   *
   * Optional. A caller that names nothing leaves the button named from its
   * content, which is the value, so the field is never anonymous.
   */
  "aria-labelledby"?: string;
}

export function InlineEdit({
  value,
  onSave,
  multiline = false,
  className = "",
  id,
  "aria-labelledby": ariaLabelledBy,
}: InlineEditProps) {
  const t = useTranslations("Kanban");
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const readRef = useRef<HTMLButtonElement>(null);
  // Names the value inside the read state so it can be composed into the
  // field's accessible name. Generated: two mounted copies sharing a static id
  // would both point at the first one's text.
  const valueId = useId();
  /**
   * Set only by the keyboard exits below. Leaving edit mode unmounts the
   * focused control, so without this focus falls to <body> and the next Tab
   * restarts at the top of the document — WCAG 2.4.3, on the very journey the
   * read state's button role exists to enable.
   *
   * A blur is deliberately NOT a keyboard exit: clicking or tabbing elsewhere
   * is the user aiming somewhere, and pulling focus back would fight them.
   */
  const restoreFocusRef = useRef(false);

  /**
   * A new `value` from outside replaces the draft — adjusted DURING RENDER,
   * not from an effect: the effect form is state derived from a prop, which
   * the React Compiler refuses outright (and, refusing, stops reading the
   * whole component). Same idiom as `DismissDialog` and `DeskCommandPalette`.
   */
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setEditValue(value);
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      readRef.current?.focus();
    }
  }, [editing]);

  function handleSave() {
    setEditing(false);
    if (editValue.trim() !== value) {
      onSave(editValue.trim());
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      restoreFocusRef.current = true;
      handleSave();
    }
    if (e.key === "Escape") {
      restoreFocusRef.current = true;
      setEditValue(value);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        // A real element rather than a div wearing `role="button"`: that is
        // what makes `id` labelable above, and it retires the hand-rolled
        // tabIndex and Enter/Space handling this used to carry, since the
        // browser supplies both.
        type="button"
        ref={readRef}
        id={id}
        aria-labelledby={
          ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined
        }
        onClick={() => setEditing(true)}
        className={cn(
          "-mx-2 cursor-pointer rounded-[7px] px-2 py-[2px] transition-colors hover:bg-band",
          // A button is inline-block and centres its text where the <div> was
          // a left-aligned block, so both have to be restored by hand. The
          // width is the <div>'s own box: a block box with `-mx-2` measured
          // 100% + 1rem, and a button does not fill its line on `display:
          // block` alone — `w-full` would shrink the hover band by that 1rem
          // and shift it left.
          "block w-[calc(100%+1rem)] text-left",
          // Tab order reaches this region, so it has to show where focus is.
          // Same ring the Piscine controls paint, and deliberately with no
          // `outline-none` beside it — the two cancel in Tailwind v4 and the
          // ring silently stops being drawn (B-arij-JJ5FdaHpX7d6).
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        <span
          id={valueId}
          className={cn(!value && "italic text-muted-foreground")}
        >
          {value || t("inlineEdit.empty")}
        </span>
      </button>
    );
  }

  if (multiline) {
    return (
      <Textarea
        id={id}
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        rows={3}
        className={cn("rounded-[8px]", className)}
      />
    );
  }

  return (
    <Input
      id={id}
      ref={inputRef as React.RefObject<HTMLInputElement>}
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onBlur={handleSave}
      onKeyDown={handleKeyDown}
      className={cn("rounded-[8px]", className)}
    />
  );
}

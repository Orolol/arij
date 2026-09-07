import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineEdit } from "@/components/kanban/InlineEdit";
import { StoryDetailPanel } from "@/components/story/StoryDetailPanel";

/**
 * `InlineEdit` used to render two different things under one field: a
 * `<div role="button">` in the read state — the state users land on — and a
 * real `<textarea>`/`<input>` carrying the `id` once activated. A `<div>` is
 * not a *labelable* element, so the read state could only be named with
 * `aria-labelledby` while the edit state was named with `htmlFor`. One field,
 * two naming mechanisms, and three symptoms fall out of that split:
 *
 *  1. `htmlFor` dangled in the read state — `getElementById` returned null, so
 *     the visible label was inert and `<label for>` pointed at nothing, an HTML
 *     conformance error in the default state.
 *  2. `aria-labelledby` pointing only at the label made the accessible name
 *     "Description" — the stored text was not part of it, so a screen reader in
 *     focus mode announced the field and none of its content.
 *  3. the `markdown` branch rendered block and interactive content (`<p>`,
 *     `<ul>`, `<a>`) inside `role="button"`, which is invalid and would make
 *     any link in there unreachable.
 *
 * The read state is now a real `<button>`, which is labelable: one `htmlFor`
 * associates in *both* states, and the element type makes symptom 3
 * structurally impossible rather than merely unused.
 *
 * Every query goes through the accessible name or the real label association
 * on purpose — a test-id query passes while the association stays broken.
 */

const story = {
  id: "story-1",
  epicId: "epic-1",
  title: "Ship the label fix",
  description: "The panel must name its fields.",
  acceptanceCriteria: "Given a screen reader, when the panel opens, then...",
  status: "todo",
  position: 0,
  createdAt: "2026-09-05T10:00:00.000Z",
  epic: null,
};

function renderPanel() {
  return render(<StoryDetailPanel story={story} onUpdate={vi.fn()} />);
}

/** The visible `<label>` a caller renders, found by its text. */
function visibleLabel(container: HTMLElement, text: string): HTMLLabelElement {
  const label = Array.from(container.querySelectorAll("label")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!label) throw new Error(`no <label> reading "${text}"`);
  return label;
}

describe("InlineEdit read state: label association", () => {
  /**
   * Symptom 1, at its root: `htmlFor` naming a control that does not exist.
   * Asserted through the DOM lookup the browser itself performs, so it fails
   * for the same reason the browser's does.
   */
  it("resolves the caller's htmlFor to a control in the read state", () => {
    const { container } = renderPanel();

    for (const text of ["Description", "Acceptance Criteria"]) {
      const label = visibleLabel(container, text);
      const target = document.getElementById(label.htmlFor);

      expect(target, `<label for="${label.htmlFor}"> resolves`).not.toBeNull();
      expect(target).toBe(screen.getByRole("button", { name: RegExp(text) }));
    }
  });

  /**
   * The same association, stated as the behaviour a user gets from it: a
   * `<label>` whose `for` resolves to a labelable control forwards its click.
   * The read `<div>` could not receive that click at all.
   */
  it("opens the editor when the visible label is clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();

    await user.click(visibleLabel(container, "Description"));

    const editor = screen.getByLabelText("Description");
    expect(editor.tagName).toBe("TEXTAREA");
  });

  /**
   * Symptom 3's root. A real `<button>` cannot legally contain `<p>`/`<a>`,
   * which is what retires the `markdown` branch instead of leaving it latent.
   */
  it("renders the read state as a real button, not a div with a role", () => {
    renderPanel();

    const field = screen.getByRole("button", { name: /Description/ });

    expect(field.tagName).toBe("BUTTON");
    // `type` matters: a bare <button> inside a form submits it on Enter.
    expect(field).toHaveAttribute("type", "button");
    // Native activation, so no hand-rolled tabIndex/Enter/Space is left behind.
    expect(field).not.toHaveAttribute("tabindex");
  });

  it("nests no block or interactive content inside the activation target", () => {
    renderPanel();

    const field = screen.getByRole("button", { name: /Description/ });

    expect(
      field.querySelectorAll(
        "p, ul, ol, li, h1, h2, h3, h4, h5, h6, blockquote, hr, a, button, input, textarea, select",
      ),
    ).toHaveLength(0);
  });
});

describe("InlineEdit read state: accessible name", () => {
  /**
   * Symptom 2. Named only by the label, the region computed to "Description"
   * and a screen reader in focus mode announced "Description, button" with
   * nothing about the content — the value survived only as a child node, which
   * focus mode does not read. The name has to carry both.
   */
  it("carries the value as well as the label", () => {
    renderPanel();

    expect(
      screen.getByRole("button", {
        name: "Description The panel must name its fields.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Acceptance Criteria Given a screen reader, when the panel opens, then...",
      }),
    ).toBeInTheDocument();
  });

  /** An empty field names its placeholder rather than going anonymous. */
  it("falls back to the empty-state text when there is no value", () => {
    render(
      <>
        <label id="title-label" htmlFor="title-field">
          Title
        </label>
        <InlineEdit
          id="title-field"
          aria-labelledby="title-label"
          value=""
          onSave={vi.fn()}
        />
      </>,
    );

    expect(
      screen.getByRole("button", { name: "Title Click to edit" }),
    ).toBeInTheDocument();
  });

  /**
   * A caller that names nothing — StoryDetailPanel's title field — keeps
   * naming the button from its own content, so dropping `aria-labelledby`
   * never yields an anonymous control.
   */
  it("names an unlabelled field from its own value", () => {
    renderPanel();

    expect(
      screen.getByRole("button", { name: "Ship the label fix" }),
    ).toBeInTheDocument();
  });
});

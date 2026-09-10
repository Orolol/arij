/**
 * Arij's own machine-readable HTML comment markers.
 *
 * Several writers embed metadata in a ticket comment as an HTML comment —
 * `<!-- arij:regression-report -->` (lib/verify/regression-report.ts) and
 * `<!-- arij:dead-session=<id> -->` (lib/pipeline/forensic.ts). Both documents
 * say the marker "stays invisible in rendered markdown", which is what an HTML
 * comment means in CommonMark. It is NOT what `react-markdown` does: without
 * `rehype-raw` it escapes raw HTML instead of parsing it, so the marker reaches
 * the screen as its own literal text — the worst of both worlds, since the
 * reader gets the machine's bookkeeping and loses the fact that it was never
 * meant to be read.
 *
 * The renderer therefore drops them (components/chat/MarkdownContent.tsx),
 * which covers every surface at once: the ticket conversation, the story
 * thread, the QA report and the ticket description all pass through it.
 *
 * Two kinds of copy of this pattern are deliberately NOT folded in here,
 * because they answer a different question and unifying them would change
 * behaviour: `lib/pipeline/forensic.ts` EXTRACTS the id out of the marker, and
 * `lib/telescope/collect.ts` + `lib/workflow/dreaming.ts` strip the marker
 * server-side when building a digest (one of them collapses it to a single
 * space rather than removing it). Only the render path needs "remove this from
 * what a human reads".
 */

/**
 * Every Arij marker, whatever its payload. Anchored on the `arij:` prefix so a
 * comment that legitimately carries an HTML comment of its own keeps it.
 *
 * Only ever used with `String.replace`, which resets a global regexp's
 * `lastIndex`; never with `test`/`exec`, where that state would be sticky.
 */
export const ARIJ_MARKER = /<!--\s*arij:[^>]*-->/gi;

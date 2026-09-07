/**
 * A busy flag set before an externally supplied callback must clear on every
 * way that callback can end — including the one the type does not mention.
 *
 * `onMerge: () => Promise<unknown>` says the callback returns a promise. It
 * does not say the callback cannot `throw` before returning one, and a
 * handler written as
 *
 *     setMerging(true);
 *     await onMerge().finally(() => setMerging(false));
 *
 * only attaches the cleanup once `onMerge()` has already returned. A
 * synchronous throw unwinds through the call expression, `.finally` is never
 * reached, and `merging` stays true for the life of the component: the Merge
 * button spins and is disabled forever, with no way back but a remount.
 *
 * The shape came in with this epic's fix for the React Compiler bail — a
 * `finally` CLAUSE stops the compiler at lowering and leaves the whole
 * component unread, so the clauses became `.finally` CALLS. The call is the
 * right answer; attaching it to the callback's own return value was not.
 * `DeskComposer` already settles the callback through an async wrapper, which
 * turns a synchronous throw into a rejection before anything is attached to
 * it; these three handlers and `InlineCommentForm` did not.
 *
 * Both endings are pinned per handler: a synchronous throw and a rejected
 * promise. The rejection still reaches the caller in both cases — that is the
 * documented contract of the original change and is asserted here too, so a
 * future "fix" that swallows the error fails this test rather than passing it.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewActions } from "@/components/review/ReviewActions";
import { InlineCommentForm } from "@/components/review/InlineCommentForm";

afterEach(cleanup);

/**
 * React discards the promise an event handler returns, so a rejection that
 * correctly reaches the caller lands as an unhandled rejection and vitest
 * fails the file on it. The listener below claims those rejections for the
 * duration of one interaction and hands them back, which is also how the test
 * asserts that the error was NOT swallowed.
 */
async function claimingRejections<T>(run: () => Promise<T>): Promise<unknown[]> {
  const caught: unknown[] = [];
  const claim = (reason: unknown) => void caught.push(reason);
  process.on("unhandledRejection", claim);
  try {
    await run();
    // Let the rejection settle and reach the listener.
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off("unhandledRejection", claim);
  }
  return caught;
}

const BOOM = "callback exploded";

/** A callback that throws before it ever returns a promise. */
const throwsSynchronously = () => {
  throw new Error(BOOM);
};
/** A callback that returns a promise and rejects it. */
const rejects = () => Promise.reject(new Error(BOOM));

const ENDINGS: [string, () => Promise<unknown>][] = [
  ["a synchronous throw", throwsSynchronously as unknown as () => Promise<unknown>],
  ["a rejected promise", rejects],
];

function renderActions(overrides: Partial<React.ComponentProps<typeof ReviewActions>>) {
  return render(
    <ReviewActions
      projectId="p1"
      epicId="e1"
      epicStatus="to_merge"
      openCount={1}
      comments={[
        {
          id: "c1",
          filePath: "lib/a.ts",
          lineNumber: 3,
          body: "look here",
          status: "open",
        } as never,
      ]}
      onBackToDev={vi.fn(async () => undefined)}
      onMerge={vi.fn(async () => undefined)}
      onResolveAll={vi.fn(async () => undefined)}
      {...overrides}
    />,
  );
}

describe("review callbacks that end badly", () => {
  for (const [ending, callback] of ENDINGS) {
    it(`clears the merge spinner after ${ending}`, async () => {
      const user = userEvent.setup();
      renderActions({ onMerge: callback });
      const merge = screen.getByRole("button", { name: /merge/i });
      expect(merge).toBeEnabled();

      const caught = await claimingRejections(() => user.click(merge));

      await waitFor(() => expect(merge).toBeEnabled());
      expect(caught.map((e) => (e as Error).message)).toEqual([BOOM]);
    });

    it(`clears the resolve-all spinner after ${ending}`, async () => {
      const user = userEvent.setup();
      renderActions({ onResolveAll: callback });
      const resolve = screen.getByRole("button", { name: /resolve all/i });
      expect(resolve).toBeEnabled();

      const caught = await claimingRejections(() => user.click(resolve));

      await waitFor(() => expect(resolve).toBeEnabled());
      expect(caught.map((e) => (e as Error).message)).toEqual([BOOM]);
    });

    it(`clears the send-to-dev spinner after ${ending}`, async () => {
      const user = userEvent.setup();
      renderActions({ onBackToDev: callback as () => Promise<unknown> });
      await user.click(screen.getByRole("button", { name: /back to dev/i }));
      const send = await screen.findByRole("button", { name: /send to dev/i });
      expect(send).toBeEnabled();

      const caught = await claimingRejections(() => user.click(send));

      await waitFor(() => expect(send).toBeEnabled());
      expect(caught.map((e) => (e as Error).message)).toEqual([BOOM]);
    });

    it(`clears the inline comment spinner after ${ending}`, async () => {
      const user = userEvent.setup();
      render(
        <InlineCommentForm
          onSubmit={callback as () => Promise<unknown>}
          onCancel={vi.fn()}
        />,
      );
      await user.type(screen.getByRole("textbox"), "a note");
      const comment = screen.getByRole("button", { name: /comment/i });
      expect(comment).toBeEnabled();

      const caught = await claimingRejections(() => user.click(comment));

      await waitFor(() => expect(comment).toBeEnabled());
      expect(caught.map((e) => (e as Error).message)).toEqual([BOOM]);
    });
  }
});

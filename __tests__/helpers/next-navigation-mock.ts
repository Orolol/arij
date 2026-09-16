/**
 * A `vi.mock("next/navigation")` factory that mocks the WHOLE surface, not
 * the two hooks one test happens to call.
 *
 * THE FAILURE THIS PREVENTS. The suite carried 29 hand-written navigation
 * mocks, and 18 of them declared one hook — most often
 * `useRouter: () => ({ refresh: vi.fn() })`. The moment a component starts
 * calling `router.push`, that mock throws `push is not a function` from
 * inside a render, which reads as a component bug rather than a stale test
 * double. `db-mock.ts` exists because the same thing happened with the
 * database; this is the navigation half.
 *
 * Usage — `vi.mock` is hoisted, so the factory must not close over a local:
 *
 *     vi.mock("next/navigation", async () =>
 *       (await import("@/__tests__/helpers/next-navigation-mock")).nextNavigationMock(),
 *     );
 *
 * A test that needs a specific route path or params passes them:
 *
 *     vi.mock("next/navigation", async () =>
 *       (await import("@/__tests__/helpers/next-navigation-mock")).nextNavigationMock({
 *         params: { projectId: "proj-1" },
 *         pathname: "/projects/proj-1/tickets",
 *       }),
 *     );
 *
 * `useSearchParams` returns a real `URLSearchParams`, and callers that want
 * the router to keep the address bar in sync should use
 * `helpers/app-router-url.ts` INSTEAD of mocking that hook — it models the
 * App Router's own history hookup, which a stub cannot.
 */

export interface NextNavigationMockOptions {
  params?: Record<string, string>;
  pathname?: string;
  searchParams?: URLSearchParams | Record<string, string> | string;
  /** Seed the not-found path, for a component that renders `notFound()`. */
  notFoundMessage?: string;
}

export interface NextNavigationMock {
  useRouter(): {
    push: (...args: unknown[]) => void;
    replace: (...args: unknown[]) => void;
    refresh: () => void;
    back: () => void;
    forward: () => void;
    prefetch: (...args: unknown[]) => void;
  };
  useParams(): Record<string, string>;
  usePathname(): string;
  useSearchParams(): URLSearchParams;
  redirect(url: string): never;
  notFound(): never;
}

/** `URLSearchParams` from any of the shapes a test wants to pass. */
function toSearchParams(
  input: NextNavigationMockOptions["searchParams"],
): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  if (typeof input === "string") return new URLSearchParams(input);
  return new URLSearchParams(input ?? {});
}

/**
 * The mock module. Every router method is a no-op rather than absent, and
 * `redirect`/`notFound` THROW — a component that relies on them to stop
 * rendering must not be handed an `undefined` that lets execution continue
 * into a state production never reaches.
 */
export function nextNavigationMock(
  options: NextNavigationMockOptions = {},
): NextNavigationMock {
  const params = options.params ?? {};
  const pathname = options.pathname ?? "/";
  const searchParams = toSearchParams(options.searchParams);

  return {
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      refresh: () => {},
      back: () => {},
      forward: () => {},
      prefetch: () => {},
    }),
    useParams: () => params,
    usePathname: () => pathname,
    useSearchParams: () => searchParams,
    redirect: (url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    },
    notFound: () => {
      throw new Error(options.notFoundMessage ?? "NEXT_HTTP_ERROR_FALLBACK;404");
    },
  };
}

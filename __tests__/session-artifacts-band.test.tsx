/**
 * SessionArtifactsBand — the visual proofs build agents attach through
 * `attach_artifact`, back on screen in the ticket overlay after
 * `SessionArtifactGallery` left with the old EpicDetail panel (7fec5315).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { SessionArtifactsBand } from "@/components/ticket/SessionArtifactsBand";
import type { SessionArtifactSummary } from "@/lib/agent-sessions/artifact-view";

const ARTIFACTS: SessionArtifactSummary[] = [
  {
    id: "artifact-one",
    agentSessionId: "session-one-abcdef",
    epicId: "epic-1",
    caption: "Settings saved with the new confirmation state",
    createdAt: "2026-08-25T10:30:00.000Z",
  },
  {
    id: "artifact two/odd",
    agentSessionId: "session-two-123456",
    epicId: "epic-1",
    caption: "Responsive settings layout on mobile",
    createdAt: null,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionArtifactsBand", () => {
  it("renders nothing while there is no proof and nothing went wrong", () => {
    const { container } = render(
      <SessionArtifactsBand
        projectId="project-one"
        artifacts={[]}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each proof as a captioned thumbnail served by its opaque id", () => {
    render(
      <SessionArtifactsBand
        projectId="project one"
        artifacts={ARTIFACTS}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    const band = screen.getByTestId("ticket-artifacts-band");
    expect(band).toHaveTextContent("Visual proof");
    expect(band).toHaveTextContent("2 screenshots");
    expect(band).toHaveTextContent("Settings saved with the new confirmation state");
    expect(band).toHaveTextContent("Responsive settings layout on mobile");

    const first = screen.getByAltText("Settings saved with the new confirmation state");
    expect(first).toHaveAttribute("src", "/api/projects/project%20one/artifacts/artifact-one");
    expect(
      screen.getByAltText("Responsive settings layout on mobile"),
    ).toHaveAttribute("src", "/api/projects/project%20one/artifacts/artifact%20two%2Fodd");

    // Which session produced it, linked to that session's screen.
    const sessionLink = screen.getAllByRole("link", { name: /session #/ })[0];
    expect(sessionLink).toHaveAttribute(
      "href",
      "/projects/project%20one/sessions/session-one-abcdef",
    );
  });

  it("opens the full image with its caption and closes it on Escape without closing the ticket", () => {
    const ticketEscape = vi.fn();
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) ticketEscape();
    };
    window.addEventListener("keydown", onWindowKey);

    render(
      <SessionArtifactsBand
        projectId="project-one"
        artifacts={ARTIFACTS}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open visual proof: Settings saved with the new confirmation state",
      }),
    );

    const lightbox = screen.getByTestId("image-lightbox");
    expect(
      within(lightbox).getByText("Settings saved with the new confirmation state"),
    ).toBeInTheDocument();
    expect(within(lightbox).getByRole("img")).toHaveAttribute(
      "src",
      "/api/projects/project-one/artifacts/artifact-one",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("image-lightbox")).toBeNull();
    expect(ticketEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("says a failed load in words and offers a retry", () => {
    const onRetry = vi.fn();
    render(
      <SessionArtifactsBand
        projectId="project-one"
        artifacts={[]}
        error="Failed to load visual proofs"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load visual proofs");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the last proofs on screen beside a failed refresh", () => {
    render(
      <SessionArtifactsBand
        projectId="project-one"
        artifacts={ARTIFACTS}
        error="Failed to load visual proofs"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

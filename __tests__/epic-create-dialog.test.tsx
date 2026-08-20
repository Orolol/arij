import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EpicCreateDialog } from "@/components/kanban/EpicCreateDialog";

describe("EpicCreateDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function renderDialog() {
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();

    render(
      <EpicCreateDialog
        projectId="proj-1"
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );

    return { onOpenChange, onCreated };
  }

  function mockFetchOk() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "epic-1", userStoriesCreated: 0 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return JSON.parse(init.body as string);
  }

  it("creates a title-only epic without touching any agent route", async () => {
    const fetchMock = mockFetchOk();
    const { onOpenChange, onCreated } = renderDialog();

    fireEvent.change(screen.getByTestId("epic-title-input"), {
      target: { value: "  Direct epic  " },
    });
    fireEvent.click(screen.getByTestId("epic-create-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/proj-1/epics");
    expect(lastBody(fetchMock)).toEqual({
      title: "Direct epic",
      description: null,
      status: "backlog",
      type: "feature",
      userStories: [],
    });

    // No chat / build / conversation call — the manual path is agent-free.
    for (const [url] of fetchMock.mock.calls) {
      expect(url).not.toMatch(/\/(chat|build|conversations|review)/);
    }

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalledWith("epic-1");
  });

  it("posts added user stories in one request", async () => {
    const fetchMock = mockFetchOk();
    const user = userEvent.setup();
    renderDialog();

    fireEvent.change(screen.getByTestId("epic-title-input"), {
      target: { value: "Direct epic" },
    });

    await user.click(screen.getByTestId("add-user-story"));
    await user.click(screen.getByTestId("add-user-story"));

    const titles = screen.getAllByTestId("user-story-title-input");
    expect(titles).toHaveLength(2);
    fireEvent.change(titles[0], { target: { value: "First story" } });
    fireEvent.change(titles[1], { target: { value: "Second story" } });

    const criteria = screen.getAllByTestId("user-story-criteria-input");
    fireEvent.change(criteria[0], { target: { value: "- [ ] works" } });

    fireEvent.click(screen.getByTestId("epic-create-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastBody(fetchMock).userStories).toEqual([
      { title: "First story", description: null, acceptanceCriteria: "- [ ] works" },
      { title: "Second story", description: null, acceptanceCriteria: null },
    ]);
  });

  it("blocks submit and shows an error when the title is blank", async () => {
    const fetchMock = mockFetchOk();
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByTestId("epic-create-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("epic-title-error")).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("blocks submit when an added user story has no title", async () => {
    const fetchMock = mockFetchOk();
    const user = userEvent.setup();
    renderDialog();

    fireEvent.change(screen.getByTestId("epic-title-input"), {
      target: { value: "Direct epic" },
    });
    await user.click(screen.getByTestId("add-user-story"));
    fireEvent.click(screen.getByTestId("epic-create-submit"));

    await waitFor(() =>
      expect(screen.getByText("User story title is required")).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes a user story block", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId("add-user-story"));
    await user.click(screen.getByTestId("add-user-story"));
    expect(screen.getAllByTestId("user-story-block")).toHaveLength(2);

    await user.click(screen.getAllByTestId("remove-user-story")[0]);
    expect(screen.getAllByTestId("user-story-block")).toHaveLength(1);
  });

  it("keeps the dialog open with the draft intact when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Failed to create epic" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { onOpenChange, onCreated } = renderDialog();

    fireEvent.change(screen.getByTestId("epic-title-input"), {
      target: { value: "Direct epic" },
    });
    fireEvent.click(screen.getByTestId("epic-create-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("epic-create-error")).toHaveTextContent(
        "Failed to create epic",
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId("epic-title-input")).toHaveValue("Direct epic");
  });
});

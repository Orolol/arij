"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserStoryQuickActions } from "@/components/epic/UserStoryQuickActions";
import { Plus, Trash2, Check, Circle, Loader2 } from "lucide-react";
import Link from "next/link";

interface UserStory {
  id: string;
  title: string;
  status: string;
}

interface EpicUserStoriesSectionProps {
  projectId: string;
  userStories: UserStory[];
  newStoryTitle: string;
  onNewStoryTitleChange: (value: string) => void;
  onAddStory: () => void;
  onUpdateStory: (id: string, updates: { status: string }) => void;
  onDeleteStory: (id: string) => void;
  onRefresh: () => void;
  actionsLocked: boolean;
}

const statusIcon = (status: string) => {
  switch (status) {
    case "done":
      return <Check className="h-3.5 w-3.5 text-green-500" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 text-yellow-500" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

/**
 * User story checklist for an epic: status toggle, quick agent actions,
 * delete, and the add-story input. State lives in the parent; this is
 * pure presentation.
 */
export function EpicUserStoriesSection({
  projectId,
  userStories,
  newStoryTitle,
  onNewStoryTitleChange,
  onAddStory,
  onUpdateStory,
  onDeleteStory,
  onRefresh,
  actionsLocked,
}: EpicUserStoriesSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">
          User Stories ({userStories.length})
        </h4>
      </div>

      <TooltipProvider>
        <div className="space-y-1">
          {userStories.map((us) => (
            <div
              key={us.id}
              className="flex items-center gap-2 p-2 rounded hover:bg-accent/50 group"
            >
              <button
                onClick={() => {
                  const next =
                    us.status === "done"
                      ? "todo"
                      : us.status === "todo"
                        ? "in_progress"
                        : "done";
                  onUpdateStory(us.id, { status: next });
                }}
              >
                {statusIcon(us.status)}
              </button>
              <Link
                href={`/projects/${projectId}/stories/${us.id}`}
                className={`flex-1 text-sm hover:underline ${
                  us.status === "done"
                    ? "line-through text-muted-foreground"
                    : ""
                }`}
              >
                {us.title}
              </Link>
              <UserStoryQuickActions
                projectId={projectId}
                story={us}
                onRefresh={onRefresh}
                isLocked={actionsLocked}
                lockReason="Another agent is already running for this epic."
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={() => onDeleteStory(us.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </TooltipProvider>

      <div className="flex gap-2 mt-2">
        <Input
          value={newStoryTitle}
          onChange={(e) => onNewStoryTitleChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAddStory()}
          placeholder="Add user story..."
          className="text-sm h-8"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={onAddStory}
          disabled={!newStoryTitle.trim()}
          className="h-8"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

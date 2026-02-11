export const KANBAN_COLUMNS = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

export type KanbanStatus = (typeof KANBAN_COLUMNS)[number];

export const COLUMN_LABELS: Record<KanbanStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export const PRIORITY_LABELS: Record<number, string> = {
  0: "Low",
  1: "Medium",
  2: "High",
  3: "Critical",
};

export const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-muted text-muted-foreground",
  1: "bg-blue-500/10 text-blue-500",
  2: "bg-yellow-500/10 text-yellow-500",
  3: "bg-red-500/10 text-red-500",
};

export interface KanbanEpic {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  position: number;
  branchName: string | null;
  confidence: number | null;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
  usCount: number;
  usDone: number;
}

export interface BoardState {
  columns: Record<KanbanStatus, KanbanEpic[]>;
}

export interface ReorderItem {
  id: string;
  status: string;
  position: number;
}

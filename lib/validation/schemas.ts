import { z } from "zod";

// --- Project schemas ---

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(5000).nullish(),
  gitRepoPath: z.string().max(1000).nullish(),
  githubOwnerRepo: z.string().max(200).nullish(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullish(),
  gitRepoPath: z.string().max(1000).nullish(),
  githubOwnerRepo: z.string().max(200).nullish(),
  status: z
    .enum(["ideation", "specifying", "building", "done", "archived"])
    .optional(),
  spec: z.string().nullish(),
});

export const importProjectSchema = z.object({
  path: z.string().min(1, "path is required"),
});

// --- Epic schemas ---

const userStoryInput = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  acceptanceCriteria: z.string().nullish(),
});

const dependencyInput = z.object({
  ticketId: z.string(),
  dependsOnTicketId: z.string(),
});

export const createEpicSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(10000).nullish(),
  priority: z.number().int().min(0).max(3).optional(),
  status: z
    .enum(["backlog", "todo", "in_progress", "review", "done"])
    .optional(),
  type: z.enum(["feature", "bug"]).optional(),
  branchName: z.string().max(300).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  evidence: z.string().max(10000).nullish(),
  linkedEpicId: z.string().nullish(),
  images: z.array(z.string()).nullish(),
  userStories: z.array(userStoryInput).optional(),
  dependencies: z.array(dependencyInput).optional(),
});

export const updateEpicSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).nullish(),
  priority: z.number().int().min(0).max(3).optional(),
  status: z
    .enum(["backlog", "todo", "in_progress", "review", "done"])
    .optional(),
  position: z.number().int().min(0).optional(),
  branchName: z.string().max(300).nullish(),
});

// --- Story schemas ---

export const createStorySchema = z.object({
  epicId: z.string().min(1, "epicId is required"),
  title: z.string().min(1, "title is required").max(500),
  description: z.string().max(10000).nullish(),
  acceptanceCriteria: z.string().max(10000).nullish(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
});

export const updateStorySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullish(),
  acceptanceCriteria: z.string().max(10000).nullish(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  position: z.number().int().min(0).optional(),
});

// Bulk story PATCH uses `id` in the body
export const updateStoryByIdSchema = z.object({
  id: z.string().min(1, "id is required"),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullish(),
  acceptanceCriteria: z.string().max(10000).nullish(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  position: z.number().int().min(0).optional(),
});

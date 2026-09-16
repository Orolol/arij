import { z } from "zod";
const gitTarget = z.string().trim().min(1).refine((value) => !value.startsWith("-"), "Invalid git target");
export const pushProjectSchema = z.object({ remote: gitTarget.default("origin"), branch: z.string().trim().default(""), setUpstream: z.boolean().optional() });
export const pullProjectSchema = pushProjectSchema.extend({ autoResolveConflicts: z.boolean().default(true), namedAgentId: z.string().nullable().optional(), resumeSessionId: z.string().optional() });

import { z } from "zod";
export const batchBuildOptionsSchema = z.object({
  mode: z.enum(["sequential", "parallel", "dag"]).default("parallel"),
  team: z.boolean().default(false),
  namedAgentId: z.string().nullable().default(null),
  failurePolicy: z.enum(["halt", "stop"]).default("halt"),
  pipeline: z.boolean().default(false),
  circuitBreaker: z.number().int().min(0).max(10).optional(),
  costCapUsd: z.number().positive().optional(),
});
export const batchBuildSchema = batchBuildOptionsSchema.extend({ epicIds: z.array(z.string().min(1)).min(1) });
export type NightRunRequest = z.infer<typeof batchBuildSchema>;
export const nightRoutineConfigSchema = batchBuildOptionsSchema.pick({ failurePolicy: true, namedAgentId: true, circuitBreaker: true, costCapUsd: true, team: true }).partial().extend({ includeBacklog: z.boolean().optional() });

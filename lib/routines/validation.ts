import { z } from "zod";
import { AVAILABLE_ROUTINE_KINDS } from "@/lib/routines/constants";

const routineFields = z.object({
  kind: z.enum(AVAILABLE_ROUTINE_KINDS),
  enabled: z.boolean(),
  timeOfDay: z.string().optional(),
  config: z.record(z.string(), z.unknown()),
});

export const createRoutineSchema = routineFields
  .extend({
    enabled: z.boolean().default(true),
    timeOfDay: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.kind !== "ci_watch" && (!data.timeOfDay || !data.timeOfDay.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeOfDay is required for this routine kind.",
        path: ["timeOfDay"],
      });
    }
  })
  .transform((data) => ({
    ...data,
    timeOfDay: data.timeOfDay && data.timeOfDay.trim() ? data.timeOfDay : "00:00",
  }));

export const updateRoutineSchema = routineFields
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one routine field is required.",
  });

export const updateCiAutofixSchema = z
  .object({ enabled: z.boolean() })
  .strict();

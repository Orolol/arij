import { z } from "zod";
import { isHttpUrl } from "@/lib/webhooks/send";

/**
 * PUT /api/settings/webhooks body.
 *
 * An empty string is the documented "clear the webhook" value; anything else
 * must be an absolute http(s) URL.
 */
export const updateProjectWebhookSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  url: z
    .string()
    .max(2000, "Webhook URL is too long")
    .refine(
      (value) => value.trim().length === 0 || isHttpUrl(value.trim()),
      "Webhook URL must be an absolute http:// or https:// URL"
    ),
});

export type UpdateProjectWebhookInput = z.infer<
  typeof updateProjectWebhookSchema
>;

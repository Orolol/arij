import { z } from "zod";

// --- Chat message schemas (chat POST + chat/stream POST) ---

export const chatMessageSchema = z.object({
  content: z.string().nullish(),
  conversationId: z.string().nullish(),
  attachmentIds: z.array(z.string()).nullish(),
  finalize: z.boolean().nullish(),
  namedAgentId: z.string().nullish(),
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

// --- Conversation schemas ---

export const createConversationSchema = z.object({
  type: z.string().nullish(),
  label: z.string().nullish(),
  epicId: z.string().nullish(),
  provider: z.string().nullish(),
  namedAgentId: z.string().nullish(),
});

export const updateConversationSchema = z.object({
  // `namedAgentId: null` (or "") clears the conversation-specific agent, so
  // presence of the key matters — handlers check hasOwnProperty on the
  // parsed data, which zod preserves for keys present in the input.
  namedAgentId: z.string().nullish(),
  provider: z.string().nullish(),
  label: z.string().nullish(),
});

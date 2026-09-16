import { requestJson } from "@/lib/api/client";

type Ticket = { projectId: string; epicId: string };
const post = <T>(url: string, body: unknown, errorMessage: string) => requestJson<T>(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), errorMessage,
});
export const markRead = (epicId: string, errorMessage: string) => post("/api/inbox/read", { epicId }, errorMessage);
export const replyToEpic = (ticket: Ticket, content: string, errorMessage: string) =>
  post(`/api/projects/${ticket.projectId}/epics/${ticket.epicId}/comments`, { author: "user", content }, errorMessage);
export const sendToDev = (ticket: Ticket, namedAgentId: string | null, errorMessage: string, comment?: string) =>
  post(`/api/projects/${ticket.projectId}/epics/${ticket.epicId}/build`, { namedAgentId, ...(comment ? { comment } : {}) }, errorMessage);

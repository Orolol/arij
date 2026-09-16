import type { ControlDeskPayload } from "@/lib/control-desk/types";

export interface DeskTicket {
  epicId: string;
  readableId: string | null;
  title: string;
  status: string | null;
  rank: number | null;
}

export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

/** Only the conversation's project can supply ticket identities. */
export function flattenDeskTickets(data: ControlDeskPayload | null, projectId: string): DeskTicket[] {
  if (!data) return [];
  const queued = data.upNext
    .filter((project) => project.projectId === projectId)
    .flatMap((project) => project.tickets);
  const other = [
    ...data.readyToLand, ...data.working, ...data.queued,
    ...data.yourTurn.awaitingReply, ...data.yourTurn.failed, ...data.yourTurn.conflicts,
  ];
  return [
    ...queued.map((ticket) => ({ epicId: ticket.epicId, readableId: ticket.readableId,
      title: ticket.title, status: ticket.status, rank: ticket.rank })),
    ...other.flatMap((ticket) => ticket.projectId === projectId && ticket.epicId
      ? [{ epicId: ticket.epicId, readableId: ticket.readableId,
          title: ticket.title, status: null, rank: null }]
      : []),
  ];
}

/** Matching by title is a fallback; ambiguous names must remain unbound. */
export function uniqueTicketsByTitle(tickets: readonly DeskTicket[]): Map<string, DeskTicket> {
  const matches = new Map<string, DeskTicket>();
  const ambiguous = new Set<string>();
  for (const ticket of tickets) {
    const title = normalizeTitle(ticket.title);
    if (!title || ambiguous.has(title)) continue;
    const previous = matches.get(title);
    if (previous && previous.epicId !== ticket.epicId) {
      matches.delete(title);
      ambiguous.add(title);
    } else if (!previous) {
      matches.set(title, ticket);
    }
  }
  return matches;
}

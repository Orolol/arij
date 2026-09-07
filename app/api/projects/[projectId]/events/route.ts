import { NextRequest } from "next/server";
import { eventBus, type TicketEvent } from "@/lib/events/bus";

/**
 * SSE endpoint for real-time project events.
 *
 * Clients connect to GET /api/projects/:projectId/events
 * and receive a stream of TicketEvent objects as SSE messages.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  // One teardown for every way the stream can end — the client aborting the
  // request, the consumer cancelling the stream, a heartbeat that can no
  // longer be written. Each path used to release its own subset: `cancel()`
  // dropped the bus subscription but left the interval ticking until its next
  // enqueue threw, up to 30 s later. Idempotent, because abort and cancel can
  // both fire for one connection.
  const teardown = () => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    unsubscribe?.();
    unsubscribe = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", projectId })}\n\n`
        )
      );

      // Subscribe to project events
      unsubscribe = eventBus.subscribe(projectId, (event: TicketEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Stream closed
        }
      });

      // Heartbeat every 30s to keep the connection alive
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          teardown();
        }
      }, 30_000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        teardown();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

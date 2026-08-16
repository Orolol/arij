"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { useInbox } from "@/hooks/useInbox";

/**
 * Sidebar link to the cross-project inbox, with an unread-count badge
 * (same badge treatment as NotificationBell). Polls /api/inbox via useInbox.
 */
export function InboxNavLink() {
  const { unreadCount } = useInbox();

  return (
    <Link
      href="/inbox"
      className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
      title="Inbox"
      data-testid="sidebar-inbox-link"
    >
      <Inbox className="h-5 w-5" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-primary-foreground bg-primary rounded-full"
          data-testid="sidebar-inbox-badge"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, XCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, type NotificationItem } from "@/hooks/useNotifications";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NotificationRow({
  notification,
  onNavigate,
}: {
  notification: NotificationItem;
  onNavigate: (url: string) => void;
}) {
  const isSuccess = notification.status === "completed";

  return (
    <button
      type="button"
      onClick={() => onNavigate(notification.targetUrl)}
      className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors rounded-md"
    >
      <div className="mt-0.5 shrink-0">
        {isSuccess ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground truncate">
          {notification.projectName}
        </p>
        <p className="text-sm leading-tight truncate">{notification.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {timeAgo(notification.createdAt)}
        </p>
      </div>
    </button>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { notifications, unreadCount, markAsRead } = useNotifications();

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen && unreadCount > 0) {
      markAsRead();
    }
  }

  function handleNavigate(url: string) {
    setOpen(false);
    router.push(url);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-primary-foreground bg-primary rounded-full">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-80 p-0"
        sideOffset={8}
      >
        <div className="px-3 py-2 border-b">
          <h3 className="text-sm font-semibold">Notifications</h3>
        </div>
        {notifications.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="p-1">
              {notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

"use client";

import Link from "next/link";
import { LayoutDashboard, Settings, FolderKanban } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AgentConfigButton } from "@/components/agent-config/AgentConfigButton";
import { NotificationBell } from "./NotificationBell";

export function Sidebar() {
  return (
    <aside className="w-16 border-r border-border bg-sidebar flex flex-col items-center py-4 gap-4">
      <Link
        href="/"
        className="flex items-center justify-center w-10 h-10 rounded-lg font-bold text-lg text-primary"
      >
        <FolderKanban className="h-6 w-6" />
      </Link>
      <div className="flex-1 flex flex-col items-center gap-2 mt-4">
        <Link
          href="/"
          className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
          title="Dashboard"
        >
          <LayoutDashboard className="h-5 w-5" />
        </Link>
      </div>
      <AgentConfigButton />
      <NotificationBell />
      <ThemeToggle />
      <Link
        href="/settings"
        className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
        title="Settings"
      >
        <Settings className="h-5 w-5" />
      </Link>
    </aside>
  );
}

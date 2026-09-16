import { WorkshopHeader } from "@/components/agents-workshop/WorkshopHeader";

/**
 * Usage observatory shell.
 * Mounts WorkshopHeader so the second-row tab navigation (Named agents ·
 * Assignments · Prompts · Limits · Usage) remains mounted and continuous
 * when switching between the workshop tabs and usage.
 */
export default function UsageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground">
      <WorkshopHeader />
      {children}
    </div>
  );
}

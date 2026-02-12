"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentConfig } from "@/hooks/useAgentConfig";
import { AgentPromptsTab } from "./AgentPromptsTab";
import { ReviewAgentsTab } from "./ReviewAgentsTab";
import { ProviderDefaultsTab } from "./ProviderDefaultsTab";

interface AgentConfigPanelProps {
  open: boolean;
  onClose: (open: boolean) => void;
  projectId?: string;
}

export function AgentConfigPanel({
  open,
  onClose,
  projectId,
}: AgentConfigPanelProps) {
  const config = useAgentConfig(projectId);

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="left" className="w-[480px] sm:max-w-[480px] p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-base">Agent Configuration</SheetTitle>
          <SheetDescription className="text-xs">
            {projectId
              ? "Configure agent prompts and providers for this project."
              : "Configure global agent prompts and providers."}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="prompts" className="flex-1">
          <TabsList className="mx-4 w-[calc(100%-2rem)]">
            <TabsTrigger value="prompts" className="text-xs">
              Agent Prompts
            </TabsTrigger>
            <TabsTrigger value="review-agents" className="text-xs">
              Review Agents
            </TabsTrigger>
            <TabsTrigger value="providers" className="text-xs">
              Providers
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[calc(100vh-140px)]">
            <TabsContent value="prompts" className="px-4 pb-4 mt-0">
              <AgentPromptsTab
                prompts={config.prompts}
                loading={config.loading}
                projectId={projectId}
                onSave={config.savePrompt}
                onDeleteProjectOverride={config.deleteProjectPrompt}
              />
            </TabsContent>

            <TabsContent value="review-agents" className="px-4 pb-4 mt-0">
              <ReviewAgentsTab
                agents={config.reviewAgents}
                loading={config.loading}
                projectId={projectId}
                onCreate={config.createReviewAgent}
                onUpdate={config.updateReviewAgent}
                onDelete={config.deleteReviewAgent}
              />
            </TabsContent>

            <TabsContent value="providers" className="px-4 pb-4 mt-0">
              <ProviderDefaultsTab
                providers={config.providers}
                loading={config.loading}
                onSave={config.saveProvider}
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

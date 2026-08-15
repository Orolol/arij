"use client";

import { Button } from "@/components/ui/button";

interface EpicDangerZoneProps {
  deleteError: string | null;
  deleting: boolean;
  onRequestDelete: () => void;
}

/**
 * Danger-zone section for an epic: permanent-delete warning, error display,
 * and the button that opens the confirmation dialog (owned by the parent).
 */
export function EpicDangerZone({
  deleteError,
  deleting,
  onRequestDelete,
}: EpicDangerZoneProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-destructive">Danger Zone</h4>
      <p className="text-xs text-muted-foreground">
        Permanently delete this epic, all child stories, and dependent
        planning records.
      </p>
      {deleteError && (
        <p className="text-xs text-destructive">{deleteError}</p>
      )}
      <Button
        size="sm"
        variant="destructive"
        className="h-8 text-xs"
        onClick={onRequestDelete}
        disabled={deleting}
      >
        Delete Epic
      </Button>
    </div>
  );
}

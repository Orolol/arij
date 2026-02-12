"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function SettingsPage() {
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.global_prompt) {
          setGlobalPrompt(d.data.global_prompt);
        }
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        global_prompt: globalPrompt,
      }),
    });
    setSaving(false);
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Global Prompt
          </label>
          <p className="text-sm text-muted-foreground mb-2">
            This prompt is injected into all Claude Code sessions across all
            projects.
          </p>
          <Textarea
            value={globalPrompt}
            onChange={(e) => setGlobalPrompt(e.target.value)}
            rows={10}
            placeholder="Enter global instructions for Claude Code..."
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

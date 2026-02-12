"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Eye, EyeOff } from "lucide-react";

export default function SettingsPage() {
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [codexApiKey, setCodexApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.data?.global_prompt) {
          setGlobalPrompt(d.data.global_prompt);
        }
        if (d.data?.codex_api_key) {
          setCodexApiKey(d.data.codex_api_key);
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
        codex_api_key: codexApiKey,
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

        <div>
          <label className="block text-sm font-medium mb-2">
            Codex API Key
          </label>
          <p className="text-sm text-muted-foreground mb-2">
            Your OpenAI API key for the Codex provider. Required to use Codex
            as an alternative agent backend.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                value={codexApiKey}
                onChange={(e) => setCodexApiKey(e.target.value)}
                placeholder="sk-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

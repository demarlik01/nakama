import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAgent } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const MODELS = [
  "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-opus-4-20250514",
  "openai/gpt-4.1",
  "openai/o3",
  "google/gemini-2.5-pro",
];

export function NewAgent() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    id: "",
    displayName: "",
    slackDisplayName: "",
    slackIcon: "",
    description: "",
    model: MODELS[0],
    slackChannels: "",
    slackUsers: "",
    agentsMd: "# AGENTS.md\n\nDescribe your agent's behavior here.\n",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!form.id || !form.displayName) {
      toast.error("ID and Display Name are required");
      return;
    }
    setSubmitting(true);
    try {
      await createAgent({
        id: form.id,
        displayName: form.displayName,
        slackDisplayName: form.slackDisplayName.trim() || undefined,
        slackIcon: form.slackIcon.trim() || undefined,
        description: form.description,
        model: form.model,
        slackChannels: form.slackChannels.split(",").map((s) => s.trim()).filter(Boolean),
        slackUsers: form.slackUsers.split(",").map((s) => s.trim()).filter(Boolean),
        agentsMd: form.agentsMd,
      });
      toast.success("Agent created");
      navigate(`/agents/${form.id}`);
    } catch {
      toast.error("Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-6">New Agent</h1>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label>ID (unique, lowercase)</Label>
          <Input
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="my-agent"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Display Name</Label>
          <Input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Slack Display Name (optional)</Label>
          <Input
            value={form.slackDisplayName}
            onChange={(e) => setForm({ ...form, slackDisplayName: e.target.value })}
            placeholder="Agent Bot Name"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Slack Icon Emoji (optional)</Label>
          <Input
            value={form.slackIcon}
            onChange={(e) => setForm({ ...form, slackIcon: e.target.value })}
            placeholder=":robot_face:"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Model</Label>
          <Select value={form.model} onValueChange={(v) => setForm({ ...form, model: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Slack Channels (comma-separated)</Label>
          <Input
            value={form.slackChannels}
            onChange={(e) => setForm({ ...form, slackChannels: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Slack Users (comma-separated)</Label>
          <Input
            value={form.slackUsers}
            onChange={(e) => setForm({ ...form, slackUsers: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>AGENTS.md</Label>
          <Textarea
            className="min-h-[200px] font-mono text-sm"
            value={form.agentsMd}
            onChange={(e) => setForm({ ...form, agentsMd: e.target.value })}
          />
        </div>
      </div>
      <Button className="mt-4" onClick={handleCreate} disabled={submitting}>
        {submitting ? "Creating..." : "Create Agent"}
      </Button>
    </div>
  );
}

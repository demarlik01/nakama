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

export function AgentCreate() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    id: "",
    displayName: "",
    slackChannels: "",
    model: MODELS[0],
    description: "",
    slackDisplayName: "",
    slackIcon: "",
    slackUsers: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    const slackChannels = splitCommaSeparated(form.slackChannels);
    const slackUsers = splitCommaSeparated(form.slackUsers);

    if (!form.id.trim() || !form.displayName.trim() || !form.model.trim() || slackChannels.length === 0) {
      toast.error("id, displayName, slackChannels, model은 필수입니다.");
      return;
    }

    setSubmitting(true);
    try {
      await createAgent({
        id: form.id.trim(),
        displayName: form.displayName.trim(),
        model: form.model.trim(),
        slackChannels,
        description: form.description.trim() || undefined,
        slackDisplayName: form.slackDisplayName.trim() || undefined,
        slackIcon: form.slackIcon.trim() || undefined,
        slackUsers: slackUsers.length > 0 ? slackUsers : undefined,
      });
      toast.success("Agent created");
      navigate(`/agents/${form.id.trim()}`);
    } catch {
      toast.error("Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-6">Create Agent</h1>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label>ID *</Label>
          <Input
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="my-agent"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Display Name *</Label>
          <Input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Slack Channels (comma-separated) *</Label>
          <Input
            value={form.slackChannels}
            onChange={(e) => setForm({ ...form, slackChannels: e.target.value })}
            placeholder="C01ABCDEF, C02HIJKLM"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Model *</Label>
          <Select value={form.model} onValueChange={(value) => setForm({ ...form, model: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label>Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Slack Display Name</Label>
          <Input
            value={form.slackDisplayName}
            onChange={(e) => setForm({ ...form, slackDisplayName: e.target.value })}
            placeholder="Agent Bot Name"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Slack Icon Emoji</Label>
          <Input
            value={form.slackIcon}
            onChange={(e) => setForm({ ...form, slackIcon: e.target.value })}
            placeholder=":robot_face:"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Slack Users (comma-separated)</Label>
          <Input
            value={form.slackUsers}
            onChange={(e) => setForm({ ...form, slackUsers: e.target.value })}
            placeholder="U12345678, U87654321"
          />
        </div>
      </div>

      <Button className="mt-4" onClick={handleCreate} disabled={submitting}>
        {submitting ? "Creating..." : "Create Agent"}
      </Button>
    </div>
  );
}

function splitCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

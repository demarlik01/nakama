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
  // Anthropic
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-sonnet-4-20250514",
  // OpenAI
  "openai/gpt-5.4",
  "openai/gpt-5.4-pro",
  "openai/gpt-5.3-codex",
  "openai/gpt-5.2-codex",
  "openai/gpt-5.2",
  // Google
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  // xAI
  "xai/grok-4",
  "xai/grok-4-fast",
];

export function AgentCreate() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    id: "",
    displayName: "",
    channels: "",
    model: MODELS[0],
    description: "",
    slackDisplayName: "",
    slackIcon: "",
    slackUsers: "",
    notifyChannel: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    const trimmedId = form.id.trim();
    const channelIds = splitCommaSeparated(form.channels);
    const slackUsers = splitCommaSeparated(form.slackUsers);
    if (!trimmedId || !form.displayName.trim() || !form.model.trim() || channelIds.length === 0) {
      toast.error("id, displayName, channels, model은 필수입니다.");
      return;
    }
    if (!isValidAgentId(trimmedId)) {
      toast.error("id는 소문자 영문/숫자로 시작하고, 소문자 영문/숫자/-/_만 사용할 수 있습니다.");
      return;
    }

    setSubmitting(true);
    try {
      await createAgent({
        id: trimmedId,
        displayName: form.displayName.trim(),
        model: form.model.trim(),
        channels: channelMapFromIds(channelIds),
        description: form.description.trim() || undefined,
        slackDisplayName: form.slackDisplayName.trim() || undefined,
        slackIcon: form.slackIcon.trim() || undefined,
        notifyChannel: form.notifyChannel.trim() || undefined,
        slackUsers: slackUsers.length > 0 ? slackUsers : undefined,
      });
      toast.success("Agent created");
      navigate(`/agents/${trimmedId}`);
    } catch (error) {
      toast.error(extractErrorMessage(error, "Failed to create agent"));
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
            value={form.channels}
            onChange={(e) => setForm({ ...form, channels: e.target.value })}
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

        <div className="grid gap-1.5">
          <Label>Notify Channel</Label>
          <Input
            value={form.notifyChannel}
            onChange={(e) => setForm({ ...form, notifyChannel: e.target.value })}
            placeholder="C01234567 (optional)"
          />
        </div>

      </div>

      <p className="text-sm text-muted-foreground mt-2">
        AGENTS.md는 displayName/description 기반으로 자동 생성됩니다. 생성 후 에이전트 상세 페이지에서 편집할 수 있습니다.
      </p>

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

function channelMapFromIds(channelIds: string[]): Record<string, { mode: "mention" }> {
  const channels: Record<string, { mode: "mention" }> = {};
  for (const channelId of channelIds) {
    channels[channelId] = { mode: "mention" };
  }
  return channels;
}

function isValidAgentId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-_]*$/.test(value);
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (message === "") {
    return fallback;
  }

  return message;
}

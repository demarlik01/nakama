import { useEffect, useState, useCallback } from "react";
import {
  type CronJob,
  type CronSchedule,
  type CreateCronJobInput,
  type UpdateCronJobInput,
  fetchCronJobs,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  runCronJob,
  fetchAgents,
  type Agent,
} from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Play, Plus, Pencil, Trash2, Clock } from "lucide-react";

// --- Helpers ---

function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case "cron":
      return `cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
    case "every": {
      const sec = Math.round(schedule.everyMs / 1000);
      if (sec >= 3600) return `every ${Math.round(sec / 3600)}h`;
      if (sec >= 60) return `every ${Math.round(sec / 60)}m`;
      return `every ${sec}s`;
    }
    case "at":
      return `at: ${schedule.at}`;
    default:
      return "unknown";
  }
}

function formatTimestamp(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function scheduleToFormValue(schedule: CronSchedule): {
  kind: CronSchedule["kind"];
  expr: string;
  tz: string;
  everyMs: string;
  at: string;
} {
  switch (schedule.kind) {
    case "cron":
      return { kind: "cron", expr: schedule.expr, tz: schedule.tz ?? "", everyMs: "", at: "" };
    case "every":
      return { kind: "every", expr: "", tz: "", everyMs: String(schedule.everyMs), at: "" };
    case "at":
      return { kind: "at", expr: "", tz: "", everyMs: "", at: schedule.at };
    default:
      return { kind: "cron", expr: "", tz: "", everyMs: "", at: "" };
  }
}

function formToSchedule(form: {
  kind: CronSchedule["kind"];
  expr: string;
  tz: string;
  everyMs: string;
  at: string;
}): CronSchedule | string {
  switch (form.kind) {
    case "cron":
      if (form.tz.trim()) return { kind: "cron", expr: form.expr.trim(), tz: form.tz.trim() };
      return form.expr.trim(); // simple string → backend treats as cron
    case "every":
      return { kind: "every", everyMs: Number(form.everyMs) || 60000 };
    case "at":
      return { kind: "at", at: form.at.trim() };
  }
}

// --- Default form state ---

interface CronFormData {
  agentId: string;
  scheduleKind: CronSchedule["kind"];
  cronExpr: string;
  cronTz: string;
  everyMs: string;
  atTime: string;
  message: string;
  model: string;
  thinking: string;
  sessionTarget: "main" | "isolated";
  enabled: boolean;
  deleteAfterRun: boolean;
}

const defaultForm: CronFormData = {
  agentId: "",
  scheduleKind: "cron",
  cronExpr: "0 9 * * *",
  cronTz: "",
  everyMs: "3600000",
  atTime: "",
  message: "",
  model: "",
  thinking: "",
  sessionTarget: "main",
  enabled: true,
  deleteAfterRun: false,
};

// --- Component ---

export function CronJobs() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAgent, setFilterAgent] = useState<string>("all");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [form, setForm] = useState<CronFormData>({ ...defaultForm });
  const [submitting, setSubmitting] = useState(false);

  // Running job IDs (for loading spinner)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      const [jobList, agentList] = await Promise.all([fetchCronJobs(), fetchAgents()]);
      setJobs(jobList);
      setAgents(agentList);
    } catch (err) {
      toast.error("Failed to load cron jobs");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredJobs = filterAgent === "all"
    ? jobs
    : jobs.filter((j) => j.agentId === filterAgent);

  // Unique agent IDs from jobs
  const jobAgentIds = [...new Set(jobs.map((j) => j.agentId))];

  // --- Actions ---

  const handleToggleEnabled = async (job: CronJob) => {
    try {
      const updated = await updateCronJob(job.id, { enabled: !job.enabled });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
      toast.success(`${updated.enabled ? "Enabled" : "Disabled"}: ${job.id.slice(0, 8)}`);
    } catch (err) {
      toast.error(`Failed to toggle: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (job: CronJob) => {
    if (!confirm(`Delete cron job ${job.id.slice(0, 8)}...?`)) return;
    try {
      await deleteCronJob(job.id);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      toast.success("Cron job deleted");
    } catch (err) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRun = async (job: CronJob) => {
    setRunningIds((prev) => new Set(prev).add(job.id));
    try {
      const result = await runCronJob(job.id);
      toast.success(result.response ? `Run complete: ${result.response.slice(0, 100)}` : "Run triggered");
      // Reload to get updated state
      const updated = await fetchCronJobs();
      setJobs(updated);
    } catch (err) {
      toast.error(`Run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  // --- Dialog ---

  const openCreate = () => {
    setEditingJob(null);
    setForm({ ...defaultForm, agentId: agents[0]?.id ?? "" });
    setDialogOpen(true);
  };

  const openEdit = (job: CronJob) => {
    setEditingJob(job);
    const sched = scheduleToFormValue(job.schedule);
    setForm({
      agentId: job.agentId,
      scheduleKind: sched.kind,
      cronExpr: sched.expr,
      cronTz: sched.tz,
      everyMs: sched.everyMs || "3600000",
      atTime: sched.at,
      message: job.payload.message,
      model: job.payload.model ?? "",
      thinking: job.payload.thinking ?? "",
      sessionTarget: job.sessionTarget,
      enabled: job.enabled,
      deleteAfterRun: job.deleteAfterRun,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.agentId) {
      toast.error("Agent is required");
      return;
    }
    if (!form.message.trim()) {
      toast.error("Prompt message is required");
      return;
    }

    setSubmitting(true);
    try {
      const schedule = formToSchedule({
        kind: form.scheduleKind,
        expr: form.cronExpr,
        tz: form.cronTz,
        everyMs: form.everyMs,
        at: form.atTime,
      });

      if (editingJob) {
        // Update
        const patch: UpdateCronJobInput = {
          schedule,
          payload: {
            message: form.message,
            model: form.model || undefined,
            thinking: form.thinking || undefined,
          },
          sessionTarget: form.sessionTarget,
          enabled: form.enabled,
          deleteAfterRun: form.deleteAfterRun,
        };
        const updated = await updateCronJob(editingJob.id, patch);
        setJobs((prev) => prev.map((j) => (j.id === editingJob.id ? updated : j)));
        toast.success("Cron job updated");
      } else {
        // Create
        const input: CreateCronJobInput = {
          agentId: form.agentId,
          schedule,
          message: form.message,
          model: form.model || undefined,
          thinking: form.thinking || undefined,
          sessionTarget: form.sessionTarget,
          enabled: form.enabled,
          deleteAfterRun: form.deleteAfterRun,
        };
        const created = await createCronJob(input);
        setJobs((prev) => [...prev, created]);
        toast.success("Cron job created");
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const updateForm = (patch: Partial<CronFormData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  // --- Render ---

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Cron Jobs</h1>
          <Badge variant="secondary">{filteredJobs.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {/* Agent filter */}
          <Select value={filterAgent} onValueChange={setFilterAgent}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {jobAgentIds.map((id) => (
                <SelectItem key={id} value={id}>{id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Jobs list */}
      {filteredJobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No cron jobs found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredJobs.map((job) => (
            <Card key={job.id} className={!job.enabled ? "opacity-60" : ""}>
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm font-medium">
                      {job.id.slice(0, 8)}
                    </CardTitle>
                    <Badge variant="outline">{job.agentId}</Badge>
                    <Badge variant="secondary">{job.sessionTarget}</Badge>
                    {job.source === "config" && (
                      <Badge variant="outline" className="text-xs">config</Badge>
                    )}
                    {job.deleteAfterRun && (
                      <Badge variant="destructive" className="text-xs">one-shot</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={job.enabled}
                      onCheckedChange={() => handleToggleEnabled(job)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRun(job)}
                      disabled={runningIds.has(job.id)}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(job)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(job)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Schedule: </span>
                    {formatSchedule(job.schedule)}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Next: </span>
                    {formatTimestamp(job.state.nextRunAtMs)}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Last: </span>
                    {formatTimestamp(job.state.lastRunAtMs)}
                    {job.state.lastRunStatus && (
                      <Badge
                        variant={job.state.lastRunStatus === "ok" ? "default" : "destructive"}
                        className="ml-1 text-xs"
                      >
                        {job.state.lastRunStatus}
                      </Badge>
                    )}
                  </div>
                  <div className="truncate" title={job.payload.message}>
                    <span className="font-medium text-foreground">Prompt: </span>
                    {job.payload.message.slice(0, 80)}
                    {job.payload.message.length > 80 ? "…" : ""}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingJob ? "Edit Cron Job" : "Create Cron Job"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Agent */}
            {!editingJob && (
              <div className="space-y-1.5">
                <Label>Agent</Label>
                <Select value={form.agentId} onValueChange={(v) => updateForm({ agentId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.displayName} ({a.id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Schedule kind */}
            <div className="space-y-1.5">
              <Label>Schedule Type</Label>
              <Select
                value={form.scheduleKind}
                onValueChange={(v) => updateForm({ scheduleKind: v as CronSchedule["kind"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron Expression</SelectItem>
                  <SelectItem value="every">Interval (every)</SelectItem>
                  <SelectItem value="at">One-time (at)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Schedule fields */}
            {form.scheduleKind === "cron" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Cron Expression</Label>
                  <Input
                    placeholder="0 9 * * *"
                    value={form.cronExpr}
                    onChange={(e) => updateForm({ cronExpr: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Timezone (optional)</Label>
                  <Input
                    placeholder="Asia/Seoul"
                    value={form.cronTz}
                    onChange={(e) => updateForm({ cronTz: e.target.value })}
                  />
                </div>
              </div>
            )}

            {form.scheduleKind === "every" && (
              <div className="space-y-1.5">
                <Label>Interval (ms)</Label>
                <Input
                  type="number"
                  placeholder="3600000"
                  value={form.everyMs}
                  onChange={(e) => updateForm({ everyMs: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {Number(form.everyMs) >= 60000
                    ? `= ${Math.round(Number(form.everyMs) / 60000)} min`
                    : `= ${Math.round(Number(form.everyMs) / 1000)} sec`}
                </p>
              </div>
            )}

            {form.scheduleKind === "at" && (
              <div className="space-y-1.5">
                <Label>Run at (ISO datetime)</Label>
                <Input
                  placeholder="2025-01-01T09:00:00+09:00"
                  value={form.atTime}
                  onChange={(e) => updateForm({ atTime: e.target.value })}
                />
              </div>
            )}

            {/* Prompt */}
            <div className="space-y-1.5">
              <Label>Prompt</Label>
              <Textarea
                rows={4}
                placeholder="What should the agent do?"
                value={form.message}
                onChange={(e) => updateForm({ message: e.target.value })}
              />
            </div>

            {/* Session target */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Session Target</Label>
                <Select
                  value={form.sessionTarget}
                  onValueChange={(v) => updateForm({ sessionTarget: v as "main" | "isolated" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">Main</SelectItem>
                    <SelectItem value="isolated">Isolated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Model (optional)</Label>
                <Input
                  placeholder="default"
                  value={form.model}
                  onChange={(e) => updateForm({ model: e.target.value })}
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => updateForm({ enabled: v })}
                />
                <Label>Enabled</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.deleteAfterRun}
                  onCheckedChange={(v) => updateForm({ deleteAfterRun: v })}
                />
                <Label>Delete after run</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Saving..." : editingJob ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock3,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Target,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";
import { cx, formatDuration, relativeTime, TASK_STATUS_META } from "../lib/format";
import type { TaskRecord } from "../lib/types";
import { Button, Progress, TaskStatusBadge } from "./ui";

const KIND_ICON: Record<string, typeof Zap> = {
  prewarm: Zap,
  allocate: Boxes,
  release: RotateCcw,
  start: Play,
  stop: Square,
  restart: RefreshCw,
  sync: Target,
  selfheal: Wrench,
  destroy: Trash2,
};

export function TaskRow({
  task,
  onRetry,
  defaultOpen = false,
}: {
  task: TaskRecord;
  onRetry?: (task: TaskRecord) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = KIND_ICON[task.kind] || Zap;
  const meta = TASK_STATUS_META[task.status];
  const running = task.status === "running" || task.status === "pending";
  const tone = task.status === "failed" ? "rose" : task.status === "succeeded" ? "acid" : "cyan";

  return (
    <div className="rounded-lg border border-edge bg-white/[0.015] transition-colors hover:border-slate-500/30">
      <button
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={cx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            task.status === "failed"
              ? "border-rose/25 bg-rose/[0.07] text-rose"
              : task.status === "succeeded"
                ? "border-acid/25 bg-acid/[0.07] text-acid"
                : "border-cyan/25 bg-cyan/[0.07] text-cyan-300",
          )}
        >
          <Icon size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-xs text-slate-200">{task.title}</span>
            <TaskStatusBadge status={task.status} />
            {task.status === "running" ? (
              <span className="mono text-[10px] text-cyan-400">{task.progress}%</span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span className="mono">{task.kind}</span>
            <span className="flex items-center gap-1">
              <Clock3 size={10} />
              {relativeTime(task.created_at)}
            </span>
            {task.duration_seconds != null ? <span>耗时 {formatDuration(task.duration_seconds)}</span> : null}
            {task.message ? <span className="truncate">{task.message}</span> : null}
          </div>
        </div>
        <span className="text-slate-600">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {running ? (
        <div className="px-3 pb-2">
          <Progress value={task.progress} tone={tone} />
        </div>
      ) : null}
      {open ? (
        <div className="space-y-2 border-t border-edge/70 px-3 py-2.5">
          <div className="grid gap-1 text-[11px] text-slate-500 sm:grid-cols-2">
            <span>
              任务 ID：<span className="mono text-slate-400">{task.id}</span>
            </span>
            <span>
              目标实例：<span className="mono text-slate-400">{task.target_id || "—"}</span>
            </span>
            <span>开始：{task.started_at ? relativeTime(task.started_at) : "—"}</span>
            <span>结束：{task.finished_at ? relativeTime(task.finished_at) : "—"}</span>
          </div>
          {task.error ? (
            <div className="rounded-md border border-rose/25 bg-rose/[0.06] px-2.5 py-2 text-[11px] leading-5 text-rose">
              {task.error}
            </div>
          ) : null}
          {task.result && Object.keys(task.result).length ? (
            <pre className="mono max-h-40 overflow-auto rounded-md border border-edge bg-ink-950/60 p-2 text-[10px] leading-5 text-slate-400">
              {JSON.stringify(task.result, null, 2)}
            </pre>
          ) : null}
          {task.status === "failed" && onRetry ? (
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={() => onRetry(task)}>
                重试任务
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

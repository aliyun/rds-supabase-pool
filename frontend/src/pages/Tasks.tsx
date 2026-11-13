import { useMemo, useState } from "react";
import { RefreshCw, ScrollText, Terminal, Wrench } from "lucide-react";
import { api } from "../lib/api";
import { cx, formatDateTime, formatDuration, relativeTime, TASK_STATUS_META } from "../lib/format";
import { useAppData } from "../lib/store";
import { TaskRow } from "../components/TaskRow";
import { Badge, Button, Card, EmptyState, Select, Tabs, useToast } from "../components/ui";
import type { ApiLog, TaskRecord } from "../lib/types";

type View = "tasks" | "logs";

export function TasksPage() {
  const { tasks, logs, meta, refreshAll, connected } = useAppData();
  const { push } = useToast();
  const [view, setView] = useState<View>("tasks");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [selfhealLoading, setSelfhealLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (status !== "all" && task.status !== status) return false;
      if (kind !== "all" && task.kind !== kind) return false;
      return true;
    });
  }, [tasks, status, kind]);

  const counts = useMemo(() => {
    return {
      all: tasks.length,
      running: tasks.filter((task) => task.status === "running" || task.status === "pending").length,
      succeeded: tasks.filter((task) => task.status === "succeeded").length,
      failed: tasks.filter((task) => task.status === "failed").length,
    };
  }, [tasks]);

  const retry = async (task: TaskRecord) => {
    try {
      await api.retryTask(task.id);
      push("success", "重试任务已提交");
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  const selfheal = async () => {
    setSelfhealLoading(true);
    try {
      await api.selfheal();
      push("success", "自愈巡检任务已提交");
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSelfhealLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-eyebrow">OPERATIONS / AUDIT</div>
          <h1 className="display-title mt-1 text-2xl font-semibold text-white">任务与日志</h1>
          <p className="mt-1 text-xs text-slate-500">异步任务进度、云端 API 调用记录与失败重试。</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cx(
              "hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] sm:inline-flex",
              connected ? "border-acid/25 bg-acid/[0.06] text-acid" : "border-amber/25 bg-amber/[0.06] text-amber",
            )}
          >
            <span className={cx("h-1.5 w-1.5 rounded-full", connected ? "bg-acid" : "bg-amber")} />
            {connected ? "SSE LIVE" : "POLLING"}
          </span>
          <Button
            variant="secondary"
            icon={<Wrench size={14} />}
            loading={selfhealLoading}
            onClick={() => void selfheal()}
          >
            自愈巡检
          </Button>
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void refreshAll()}>
            刷新
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
          <Tabs
            value={view}
            onChange={setView}
            tabs={[
              { value: "tasks", label: "异步任务", count: counts.all },
              { value: "logs", label: "API 调用日志", count: logs.length },
            ]}
          />
          {view === "tasks" ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-edge bg-white/[0.02] p-1">
                {[
                  { value: "all", label: "全部" },
                  { value: "running", label: "进行中" },
                  { value: "succeeded", label: "成功" },
                  { value: "failed", label: "失败" },
                ].map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setStatus(item.value)}
                    className={cx(
                      "rounded-md px-2.5 py-1 text-[11px] transition-colors",
                      status === item.value ? "bg-cyan/15 text-cyan-300" : "text-slate-500 hover:text-slate-300",
                    )}
                  >
                    {item.label}
                    {item.value === "failed" && counts.failed ? (
                      <span className="ml-1 rounded bg-rose/20 px-1 text-[10px] text-rose">{counts.failed}</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <Select value={kind} onChange={(event) => setKind(event.target.value)} className="h-8 w-32 text-[11px]">
                <option value="all">全部类型</option>
                {(meta?.task_kinds ?? []).map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <span className="text-[10px] text-slate-600">记录每次阿里云 OpenAPI 调用，敏感参数已脱敏</span>
          )}
        </div>

        {view === "tasks" ? (
          <div className="space-y-2 p-4">
            {filteredTasks.length ? (
              filteredTasks.map((task) => <TaskRow key={task.id} task={task} onRetry={(item) => void retry(item)} />)
            ) : (
              <EmptyState
                icon={<ScrollText size={24} />}
                title={tasks.length ? "没有符合条件的任务" : "暂无任务记录"}
                description={tasks.length ? "调整筛选条件后再试。" : "预热、分配、释放等操作都会生成任务记录。"}
              />
            )}
          </div>
        ) : (
          <div className="p-4">
            {logs.length ? (
              <div className="overflow-x-auto rounded-lg border border-edge">
                <table className="w-full min-w-[760px] text-left text-[11px]">
                  <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 font-normal">动作</th>
                      <th className="px-3 py-2.5 font-normal">产品</th>
                      <th className="px-3 py-2.5 font-normal">结果</th>
                      <th className="px-3 py-2.5 font-normal">耗时</th>
                      <th className="px-3 py-2.5 font-normal">RequestId</th>
                      <th className="px-3 py-2.5 font-normal">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <LogRow
                        key={log.id}
                        log={log}
                        expanded={expandedLog === log.id}
                        onToggle={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Terminal size={24} />}
                title="暂无 API 调用记录"
                description="真实或 Mock 模式下的云端调用都会记录在这里。"
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function LogRow({ log, expanded, onToggle }: { log: ApiLog; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="table-row-hover cursor-pointer border-t border-edge/60" onClick={onToggle}>
        <td className="mono px-3 py-2.5 text-slate-300">{log.action}</td>
        <td className="px-3 py-2.5 text-slate-500">{log.product}</td>
        <td className="px-3 py-2.5">
          <Badge
            className={
              log.success ? "border-acid/25 bg-acid/[0.07] text-acid" : "border-rose/25 bg-rose/[0.07] text-rose"
            }
          >
            {log.success ? "成功" : log.error_code || "失败"}
          </Badge>
        </td>
        <td className="mono px-3 py-2.5 text-slate-500">{log.duration_ms} ms</td>
        <td className="mono px-3 py-2.5 text-[10px] text-slate-600">{log.request_id || "—"}</td>
        <td className="px-3 py-2.5 text-[10px] text-slate-500">{relativeTime(log.created_at)}</td>
      </tr>
      {expanded ? (
        <tr className="border-t border-edge/40 bg-ink-950/40">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid gap-2 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] text-slate-600">参数（脱敏）</div>
                <pre className="mono max-h-40 overflow-auto rounded-md border border-edge bg-ink-950/60 p-2 text-[10px] leading-5 text-slate-400">
                  {JSON.stringify(log.params, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-[10px] text-slate-600">错误信息</div>
                <div className="rounded-md border border-edge bg-ink-950/60 p-2 text-[10px] leading-5 text-slate-400">
                  {log.error_message || "无"}
                  <div className="mt-2 text-slate-600">时间：{formatDateTime(log.created_at)}</div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

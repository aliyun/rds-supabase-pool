import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Boxes, Filter, Play, Plus, RefreshCw, RotateCcw, Search, Square, Trash2, Wrench, Zap } from "lucide-react";
import { api } from "../lib/api";
import { cx, MODE_META, relativeTime, STATUS_META } from "../lib/format";
import { useAppData } from "../lib/store";
import type { Instance, PoolMode } from "../lib/types";
import { InstanceDrawer } from "../components/InstanceDrawer";
import { AllocateModal, ConfirmDialog, PrewarmModal, ReleaseDialog } from "../components/PoolActions";
import { Button, Badge, Card, EmptyState, Input, Select, Spinner, StatusBadge, Tabs, useToast } from "../components/ui";

type ModeFilter = "all" | PoolMode;

export function InstancesPage() {
  const { instances, meta, refreshAll, overview, loading } = useAppData();
  const { push } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = (searchParams.get("mode") as ModeFilter) || "all";
  const [mode, setMode] = useState<ModeFilter>(
    initialMode === "shared" || initialMode === "single" ? initialMode : "all",
  );
  const [status, setStatus] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [prewarmOpen, setPrewarmOpen] = useState(false);
  const [prewarmMode, setPrewarmMode] = useState<PoolMode>("single");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [allocateTarget, setAllocateTarget] = useState<Instance | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<Instance | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ instance: Instance; action: "stop" | "start" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selfhealLoading, setSelfhealLoading] = useState(false);

  const filtered = useMemo(() => {
    return instances.filter((instance) => {
      if (mode !== "all" && instance.mode !== mode) return false;
      if (status !== "all" && instance.status !== status) return false;
      if (keyword) {
        const haystack =
          `${instance.app_name} ${instance.id} ${instance.supabase_instance_id ?? ""} ${instance.pg_instance_id ?? ""} ${instance.bound_app_id ?? ""}`.toLowerCase();
        if (!haystack.includes(keyword.toLowerCase())) return false;
      }
      return true;
    });
  }, [instances, mode, status, keyword]);

  const statusOptions = meta?.statuses ?? [];
  const counts = useMemo(() => {
    const byMode = { all: instances.length, single: 0, shared: 0 };
    instances.forEach((instance) => {
      byMode[instance.mode] += 1;
    });
    return byMode;
  }, [instances]);

  const changeMode = (next: ModeFilter) => {
    setMode(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("mode");
    else params.set("mode", next);
    setSearchParams(params, { replace: true });
  };

  const runAction = async (instance: Instance, action: "start" | "stop" | "sync") => {
    setBusyId(instance.id);
    try {
      await api.action(instance.id, action);
      push("success", `${action} 任务已提交`);
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
      setConfirmTarget(null);
    }
  };

  const runSelfheal = async () => {
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
      {loading && !overview ? (
        <div className="flex items-center justify-center py-32">
          <Spinner size={24} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label-eyebrow">INSTANCE LIFECYCLE</div>
              <h1 className="display-title mt-1 text-2xl font-semibold text-white">实例管理</h1>
              <p className="mt-1 text-xs text-slate-500">查看两个资源池的实例状态，执行分配、唤醒、冻结与释放。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden items-center gap-2 rounded-lg border border-edge bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-slate-500 sm:flex">
                <span>
                  冷池 <span className="mono text-sky-300">{overview?.pools.single.cold ?? 0}</span>
                </span>
                <span className="h-3 w-px bg-edge" />
                <span>
                  使用中 <span className="mono text-acid">{overview?.pools.single.in_use ?? 0}</span>
                </span>
              </div>
              <Button
                variant="secondary"
                icon={<Wrench size={14} />}
                loading={selfhealLoading}
                onClick={() => void runSelfheal()}
              >
                自愈巡检
              </Button>
              <Button
                variant="primary"
                icon={<Zap size={14} />}
                onClick={() => {
                  setPrewarmMode(mode === "shared" ? "shared" : "single");
                  setPrewarmOpen(true);
                }}
              >
                预热实例
              </Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
              <Tabs
                value={mode}
                onChange={changeMode}
                tabs={[
                  { value: "all", label: "全部", count: counts.all },
                  { value: "single", label: "单租户池", count: counts.single },
                  { value: "shared", label: "多租共享池", count: counts.shared },
                ]}
              />
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                  <Input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索实例 / 应用 / PG"
                    className="h-9 w-56 pl-8 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Filter size={13} className="text-slate-600" />
                  <Select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className="h-9 w-32 text-xs"
                  >
                    <option value="all">全部状态</option>
                    {statusOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void refreshAll()}>
                  刷新
                </Button>
              </div>
            </div>

            {filtered.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-xs">
                  <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-normal">实例</th>
                      <th className="px-3 py-2.5 font-normal">模式</th>
                      <th className="px-3 py-2.5 font-normal">状态</th>
                      <th className="px-3 py-2.5 font-normal">绑定应用</th>
                      <th className="px-3 py-2.5 font-normal">底层 PG</th>
                      <th className="hidden px-3 py-2.5 font-normal xl:table-cell">公网连接</th>
                      <th className="px-3 py-2.5 font-normal">创建时间</th>
                      <th className="px-3 py-2.5 text-right font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((instance) => {
                      const modeMeta = MODE_META[instance.mode];
                      return (
                        <tr
                          key={instance.id}
                          className="table-row-hover cursor-pointer border-t border-edge/60 transition-colors"
                          onClick={() => setDrawerId(instance.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-cyan/20 bg-cyan/[0.05] text-cyan-400">
                                <Boxes size={13} />
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-[12px] text-slate-200">{instance.app_name}</div>
                                <div className="mono truncate text-[10px] text-slate-600">
                                  {instance.supabase_instance_id || instance.id}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={cx("rounded border px-1.5 py-0.5 text-[10px]", modeMeta.badge)}>
                              {modeMeta.label}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <StatusBadge status={instance.status} />
                              {instance.status === "InCold" && instance.detail?.reserved ? (
                                <Badge className="border-amber/25 bg-amber/[0.07] text-amber">保留</Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-[11px] text-slate-400">
                            {instance.status === "InCold" && instance.detail?.reserved ? (
                              <div>
                                <div className="text-slate-300">
                                  {String(instance.detail.reserved_app_name || instance.bound_app_id || "—")}
                                </div>
                                <div className="text-[10px] text-amber">仅原应用复用</div>
                              </div>
                            ) : instance.bound_app_id ? (
                              <div>
                                <div className="mono text-slate-300">{instance.bound_app_id}</div>
                                <div className="text-[10px] text-slate-600">
                                  {String(instance.detail?.bound_app_name || instance.bound_user || "—")}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-600">未绑定</span>
                            )}
                          </td>
                          <td className="mono px-3 py-3 text-[10px] text-slate-500">
                            {instance.pg_instance_id || "—"}
                          </td>
                          <td className="mono hidden px-3 py-3 text-[10px] text-slate-500 xl:table-cell">
                            {instance.public_connection
                              ? instance.public_connection.replace(/^https?:\/\//, "").slice(0, 30)
                              : "未开启"}
                          </td>
                          <td className="px-3 py-3 text-[10px] text-slate-500">{relativeTime(instance.created_at)}</td>
                          <td className="px-3 py-3">
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {["InCold", "Available"].includes(instance.status) ? (
                                <IconAction
                                  title="分配"
                                  onClick={() => setAllocateTarget(instance)}
                                  icon={<Plus size={13} />}
                                  tone="cyan"
                                />
                              ) : null}
                              {["InCold", "Available", "Failed"].includes(instance.status) ? (
                                <IconAction
                                  title="启动"
                                  disabled={busyId === instance.id}
                                  onClick={() => setConfirmTarget({ instance, action: "start" })}
                                  icon={<Play size={13} />}
                                />
                              ) : null}
                              {["InUse", "Available"].includes(instance.status) ? (
                                <IconAction
                                  title="停止"
                                  disabled={busyId === instance.id}
                                  onClick={() => setConfirmTarget({ instance, action: "stop" })}
                                  icon={<Square size={13} />}
                                />
                              ) : null}
                              <IconAction
                                title="保留 / 删除"
                                onClick={() => setReleaseTarget(instance)}
                                icon={<Trash2 size={13} />}
                                tone="rose"
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Boxes size={26} />}
                title={instances.length ? "没有符合条件的实例" : "资源池还是空的"}
                description={
                  instances.length ? "调整筛选条件或搜索关键词后再试。" : "点击「预热实例」创建第一批冷池资源。"
                }
                action={
                  <Button size="sm" variant="primary" icon={<Zap size={12} />} onClick={() => setPrewarmOpen(true)}>
                    预热实例
                  </Button>
                }
              />
            )}
            <div className="flex items-center justify-between border-t border-edge px-4 py-2.5 text-[10px] text-slate-600">
              <span>
                共 <span className="mono text-slate-400">{filtered.length}</span> 个实例
              </span>
              <span>点击行查看详情与时间线</span>
            </div>
          </Card>

          <InstanceDrawer instanceId={drawerId} open={drawerId !== null} onClose={() => setDrawerId(null)} />
          <PrewarmModal open={prewarmOpen} onClose={() => setPrewarmOpen(false)} defaultMode={prewarmMode} />
          <AllocateModal
            instance={allocateTarget}
            open={allocateTarget !== null}
            onClose={() => setAllocateTarget(null)}
          />
          <ReleaseDialog
            instance={releaseTarget}
            open={releaseTarget !== null}
            onClose={() => setReleaseTarget(null)}
          />
          <ConfirmDialog
            open={confirmTarget !== null}
            onClose={() => setConfirmTarget(null)}
            title={confirmTarget?.action === "stop" ? "停止实例" : "启动实例"}
            description={
              confirmTarget?.action === "stop"
                ? "停止后实例会进入冷池并保留给当前应用复用，其他应用不能分配。多租共享模式下不会影响共享 PG 和其他租户。"
                : "启动会将实例从冷池唤醒，唤醒后仍保持未绑定状态，可继续分配。"
            }
            confirmLabel={confirmTarget?.action === "stop" ? "确认停止" : "确认启动"}
            variant={confirmTarget?.action === "stop" ? "danger" : "primary"}
            loading={busyId !== null}
            onConfirm={() => {
              if (confirmTarget) void runAction(confirmTarget.instance, confirmTarget.action);
            }}
          />
        </>
      )}
    </div>
  );
}

function IconAction({
  title,
  icon,
  onClick,
  disabled,
  tone = "slate",
}: {
  title: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "slate" | "cyan" | "rose";
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "rounded-md border border-transparent p-1.5 transition-colors disabled:opacity-40",
        tone === "cyan"
          ? "text-cyan-400 hover:border-cyan/25 hover:bg-cyan/[0.08]"
          : tone === "rose"
            ? "text-slate-500 hover:border-rose/25 hover:bg-rose/[0.08] hover:text-rose"
            : "text-slate-500 hover:border-edge hover:bg-white/[0.05] hover:text-slate-200",
      )}
    >
      {icon}
    </button>
  );
}

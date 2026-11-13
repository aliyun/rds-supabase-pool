import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Flame,
  Gauge,
  Info,
  Layers,
  Snowflake,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { cx, formatNumber, MODE_META, relativeTime } from "../lib/format";
import { useAppData } from "../lib/store";
import { PoolGauge, StatusDistribution } from "../components/PoolGauge";
import { RatioDial } from "../components/RatioDial";
import { PrewarmModal } from "../components/PoolActions";
import { TaskRow } from "../components/TaskRow";
import { Badge, Button, Card, EmptyState, Progress, Spinner, StatusBadge, useToast } from "../components/ui";
import type { Overview, PoolMode } from "../lib/types";

export function DashboardPage() {
  const { overview, meta, tasks, loading, refreshAll, region, regionId } = useAppData();
  const { push } = useToast();
  const [prewarmOpen, setPrewarmOpen] = useState(false);
  const [prewarmMode, setPrewarmMode] = useState<PoolMode>("single");
  const [selfhealLoading, setSelfhealLoading] = useState(false);

  const total = overview?.instance_total ?? 0;
  const cold = (overview?.pools.single.cold ?? 0) + (overview?.pools.shared.cold ?? 0);
  const inUse = (overview?.pools.single.in_use ?? 0) + (overview?.pools.shared.in_use ?? 0);
  const failed = (overview?.pools.single.failed ?? 0) + (overview?.pools.shared.failed ?? 0);
  const target = (overview?.pools.single.target ?? 0) + (overview?.pools.shared.target ?? 0);
  const capacity = overview?.capacity_cached;
  const sharedPgs = overview?.shared_pgs ?? [];
  const sharedPoolReady = Boolean(overview?.pools.shared.id);

  const chartData = useMemo(() => {
    const kinds = meta?.task_kinds ?? [];
    return kinds
      .map((kind) => ({
        name: kind.label,
        value: tasks.filter((task) => task.kind === kind.value).length,
      }))
      .filter((item) => item.value > 0);
  }, [meta, tasks]);

  const openPrewarm = (mode: PoolMode) => {
    setPrewarmMode(mode);
    setPrewarmOpen(true);
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

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center py-32">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-rise">
        <div>
          <div className="label-eyebrow">RESOURCE POOL / LIVE TELEMETRY</div>
          <h1 className="display-title mt-1 text-3xl font-semibold text-white">
            资源冷热池
            <span className="ml-3 align-middle text-sm font-normal text-cyan-300">
              {region?.name || regionId || "未选择地域"}
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-slate-400">
            当前地域一份 PG 资源，多个隔离的 Supabase 实例。后台异步预热，应用请求时从冷池快速分配并唤醒。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={<Wrench size={14} />}
            loading={selfhealLoading}
            onClick={() => void runSelfheal()}
          >
            自愈巡检
          </Button>
          <Button variant="primary" icon={<Zap size={14} />} onClick={() => openPrewarm("single")}>
            预热实例
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="实例总量"
          value={formatNumber(total)}
          sub={`单租 ${overview?.pools.single.total ?? 0} · 多租 ${overview?.pools.shared.total ?? 0}`}
          icon={<Layers size={16} />}
          tone="cyan"
          delay="0ms"
        />
        <StatCard
          label="冷池水位"
          value={`${cold} / ${target}`}
          sub="可被立即分配的实例"
          icon={<Snowflake size={16} />}
          tone="sky"
          delay="60ms"
        />
        <StatCard
          label="使用中"
          value={formatNumber(inUse)}
          sub="已绑定应用并唤醒"
          icon={<Flame size={16} />}
          tone="acid"
          delay="120ms"
        />
        <StatCard
          label="异常"
          value={formatNumber(failed)}
          sub={failed ? "需要处理失败实例" : "暂无失败实例"}
          icon={<AlertTriangle size={16} />}
          tone={failed ? "rose" : "slate"}
          delay="180ms"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {(["single", "shared"] as PoolMode[]).map((mode, index) => {
          const pool = overview?.pools[mode];
          const modeMeta = MODE_META[mode];
          const percentage = pool && pool.target > 0 ? Math.round((pool.cold / pool.target) * 100) : 0;
          return (
            <Card
              key={mode}
              className={cx("overflow-hidden p-5 animate-rise", index === 1 && "xl:animate-[rise_.55s_.08s_both]")}
              glow={mode === "single" ? "cyan" : "violet"}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="display-title text-base text-white">{modeMeta.label}</span>
                    <Badge className={modeMeta.badge}>{mode === "single" ? "PG / INSTANCE" : "SHARED PG"}</Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {mode === "single"
                      ? "每个实例独享底层 PostgreSQL"
                      : sharedPgs.length
                        ? `${sharedPgs.length} 台共享 PG · ${sharedPgs.filter((item) => item.enabled).length} 台启用`
                        : "尚未添加共享 PG"}
                  </div>
                </div>
                <Button size="sm" variant="secondary" icon={<Zap size={12} />} onClick={() => openPrewarm(mode)}>
                  预热
                </Button>
              </div>
              <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
                <PoolGauge
                  cold={pool?.cold ?? 0}
                  target={pool?.target ?? 0}
                  total={pool?.total ?? 0}
                  max={pool?.max ?? 0}
                  inUse={pool?.in_use ?? 0}
                  accent={mode === "single" ? "cyan" : "violet"}
                />
                <div className="w-full flex-1 space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">冷池水位达成</span>
                      <span className={cx("mono", percentage >= 100 ? "text-acid" : "text-cyan-300")}>
                        {percentage}%
                      </span>
                    </div>
                    <Progress value={percentage} tone={mode === "single" ? "cyan" : "violet"} />
                  </div>
                  <StatusDistribution byStatus={pool?.by_status ?? {}} />
                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat label="创建中" value={pool?.creating ?? 0} tone="amber" />
                    <MiniStat label="使用中" value={pool?.in_use ?? 0} tone="acid" />
                    <MiniStat label="失败" value={pool?.failed ?? 0} tone="rose" />
                  </div>
                  {(pool?.reserved ?? 0) > 0 ? (
                    <div className="text-[10px] text-amber">其中 {pool?.reserved} 个保留给原应用，其他应用不可分配</div>
                  ) : null}
                  <Link
                    to={`/instances?mode=${mode}`}
                    className="inline-flex items-center gap-1 text-[11px] text-cyan-400 transition-colors hover:text-cyan-300"
                  >
                    查看实例 <ArrowRight size={12} />
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-1">
          <SectionHeader icon={<Gauge size={15} />} title="共享容量" subtitle="activeRatio" />
          {sharedPoolReady && sharedPgs.length && capacity?.estimated_max_total_tenants ? (
            <div className="mt-3 flex items-center gap-4">
              <RatioDial ratio={capacity.active_ratio ?? 0.5} size={124} />
              <div className="flex-1 space-y-2 text-[11px]">
                <Row label="活跃租户" value={capacity.current_active_tenants ?? 0} />
                <Row label="注册租户" value={capacity.current_total_tenants ?? 0} />
                <Row label="活跃上限" value={capacity.estimated_max_active_tenants ?? 0} />
                <Row label="注册上限" value={capacity.estimated_max_total_tenants ?? 0} />
                <Link to="/capacity" className="inline-flex items-center gap-1 pt-1 text-cyan-400 hover:text-cyan-300">
                  调整容量 <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          ) : sharedPoolReady && sharedPgs.length ? (
            <div className="mt-3 flex h-[124px] flex-col items-center justify-center gap-2 text-center">
              <Gauge size={22} className="text-slate-600" />
              <div className="text-[11px] text-slate-500">尚未拉取容量快照</div>
              <Link to="/capacity">
                <Button size="sm" variant="secondary">
                  前往容量管理
                </Button>
              </Link>
            </div>
          ) : (
            <EmptyState
              icon={<Gauge size={22} />}
              title="共享池还没有共享 PG"
              description="添加共享 PG 后可查看 activeRatio 与租户容量。"
              action={
                <Link to="/pools">
                  <Button size="sm" variant="secondary">
                    去配置
                  </Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card className="p-5 xl:col-span-1">
          <SectionHeader
            icon={<AlertTriangle size={15} />}
            title="运行提示"
            subtitle={`${overview?.alerts?.length ?? 0} 条`}
          />
          <div className="mt-3 space-y-2">
            {(overview?.alerts ?? []).length ? (
              overview?.alerts.map((alert, index) => (
                <div
                  key={index}
                  className={cx(
                    "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[11px] leading-5",
                    alert.level === "critical"
                      ? "border-rose/30 bg-rose/[0.06] text-rose"
                      : alert.level === "warning"
                        ? "border-amber/30 bg-amber/[0.06] text-amber"
                        : "border-edge bg-white/[0.02] text-slate-400",
                  )}
                >
                  {alert.level === "info" ? (
                    <Info size={13} className="mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div>{alert.title}</div>
                    <div className="opacity-70">{alert.detail}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex h-[100px] items-center justify-center text-[11px] text-slate-600">系统运行正常</div>
            )}
          </div>
        </Card>

        <Card className="p-5 xl:col-span-1">
          <SectionHeader icon={<Activity size={15} />} title="任务分布" subtitle="最近 120 条" />
          {chartData.length ? (
            <div className="mt-2 h-[150px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="rgba(148,163,184,.12)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#9aa9bd", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "#8493a9", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(34,211,238,.06)" }}
                    contentStyle={{
                      background: "#0a111e",
                      border: "1px solid rgba(148,163,184,.2)",
                      borderRadius: 8,
                      fontSize: 11,
                      color: "#e2e8f0",
                    }}
                  />
                  <Bar dataKey="value" fill="#22d3ee" radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[150px] items-center justify-center text-[11px] text-slate-600">暂无任务数据</div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <SectionHeader icon={<Sparkles size={15} />} title="最近任务" subtitle="实时执行状态" />
          <Link to="/tasks" className="text-[11px] text-cyan-400 hover:text-cyan-300">
            全部任务
          </Link>
        </div>
        <div className="mt-3 space-y-2">
          {(overview?.recent_tasks ?? []).length ? (
            overview?.recent_tasks.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} />)
          ) : (
            <EmptyState
              icon={<Boxes size={22} />}
              title="还没有任务"
              description="点击右上角「预热实例」开始创建第一个冷池资源。"
              action={
                <Button size="sm" variant="primary" icon={<Zap size={12} />} onClick={() => openPrewarm("single")}>
                  预热实例
                </Button>
              }
            />
          )}
        </div>
      </Card>

      <PrewarmModal open={prewarmOpen} onClose={() => setPrewarmOpen(false)} defaultMode={prewarmMode} />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
  delay,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone: "cyan" | "sky" | "acid" | "rose" | "slate";
  delay: string;
}) {
  const tones = {
    cyan: "border-cyan/20 bg-cyan/[0.05] text-cyan-300",
    sky: "border-sky-400/20 bg-sky-400/[0.05] text-sky-300",
    acid: "border-acid/20 bg-acid/[0.05] text-acid",
    rose: "border-rose/20 bg-rose/[0.05] text-rose",
    slate: "border-edge bg-white/[0.02] text-slate-400",
  }[tone];
  return (
    <Card className="p-4 animate-rise" noCorners>
      <div className="flex items-start justify-between">
        <div>
          <div className="label-eyebrow">{label}</div>
          <div className="display-title mt-1 text-2xl font-semibold text-white">{value}</div>
          <div className="mt-1 text-[10px] text-slate-400">{sub}</div>
        </div>
        <span className={cx("flex h-8 w-8 items-center justify-center rounded-lg border", tones)}>{icon}</span>
      </div>
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "amber" | "acid" | "rose" }) {
  const toneClass = {
    amber: "text-amber",
    acid: "text-acid",
    rose: value ? "text-rose" : "text-slate-500",
  }[tone];
  return (
    <div className="rounded-lg border border-edge bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={cx("mono mt-0.5 text-sm", toneClass)}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="mono text-slate-200">{formatNumber(value)}</span>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-cyan-400">{icon}</span>
      <span className="display-title text-sm text-slate-200">{title}</span>
      {subtitle ? <span className="text-[10px] text-slate-600">{subtitle}</span> : null}
    </div>
  );
}

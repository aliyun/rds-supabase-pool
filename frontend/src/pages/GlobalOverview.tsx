import { useEffect, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Flame,
  Globe2,
  Layers,
  RefreshCw,
  Server,
  Snowflake,
  Sparkles,
} from "lucide-react";
import { useAppData } from "../lib/store";
import { cx, formatNumber, MODE_META, relativeTime } from "../lib/format";
import { Badge, Button, Card, EmptyState, Progress, Spinner } from "../components/ui";
import type { PoolMode, PoolSummary } from "../lib/types";

export function GlobalOverviewPage() {
  const { globalOverview, regions, refreshGlobal, refreshRegions, setRegion } = useAppData();
  const navigate = useNavigate();

  useEffect(() => {
    void refreshGlobal();
    const timer = window.setInterval(() => void refreshGlobal(), 20000);
    return () => window.clearInterval(timer);
  }, [refreshGlobal]);

  const totals = globalOverview?.totals;
  const summaries = globalOverview?.regions ?? [];

  const enterRegion = (regionId: string) => {
    setRegion(regionId);
    navigate("/");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 animate-rise">
        <div>
          <div className="label-eyebrow">MULTI-REGION / GLOBAL VIEW</div>
          <h1 className="display-title mt-1 text-3xl font-semibold text-white">全局总览</h1>
          <p className="mt-2 max-w-2xl text-xs leading-6 text-slate-400">
            跨地域汇总单租户池与多租共享池的资源水位。切换地域后，其余页面只展示该地域的数据。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} className={!globalOverview ? "animate-spin" : ""} />}
            onClick={() => {
              void refreshGlobal();
              void refreshRegions();
            }}
          >
            刷新全局
          </Button>
          <Link to="/pools">
            <Button variant="primary" icon={<Layers size={14} />}>
              地域与资源池
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <GlobalStat
          label="地域数量"
          value={`${totals?.region_count ?? regions.length}`}
          sub="已纳管地域"
          icon={<Globe2 size={16} />}
          tone="cyan"
        />
        <GlobalStat
          label="实例总量"
          value={formatNumber(totals?.instance_total ?? 0)}
          sub={`冷池 ${totals?.cold ?? 0} · 使用中 ${totals?.in_use ?? 0}`}
          icon={<Boxes size={16} />}
          tone="sky"
        />
        <GlobalStat
          label="共享 PG"
          value={`${totals?.shared_pg_count ?? 0}`}
          sub={`可注册上限 ${formatNumber(totals?.estimated_max_total_tenants ?? 0)}`}
          icon={<Server size={16} />}
          tone="violet"
        />
        <GlobalStat
          label="异常实例"
          value={formatNumber(totals?.failed ?? 0)}
          sub={totals?.failed ? "需要进地域处理" : "全部地域运行正常"}
          icon={<AlertTriangle size={16} />}
          tone={totals?.failed ? "rose" : "slate"}
        />
      </div>

      {!globalOverview ? (
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      ) : summaries.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {summaries.map((item, index) => {
            const single = item.pools.single;
            const shared = item.pools.shared;
            const cold = (single?.cold ?? 0) + (shared?.cold ?? 0);
            const inUse = (single?.in_use ?? 0) + (shared?.in_use ?? 0);
            const target = (single?.target ?? 0) + (shared?.target ?? 0);
            const progress = target > 0 ? Math.min(100, Math.round((cold / target) * 100)) : 0;
            return (
              <Card
                key={item.region_id}
                className={cx(
                  "overflow-hidden p-5 animate-rise",
                  index % 2 === 1 && "xl:animate-[rise_.55s_.08s_both]",
                )}
                glow={index % 2 === 0 ? "cyan" : "violet"}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Globe2 size={16} className="text-cyan-400" />
                      <span className="display-title text-base text-white">{item.name || item.region_id}</span>
                      <Badge
                        className={
                          item.enabled
                            ? "border-acid/25 bg-acid/[0.07] text-acid"
                            : "border-edge bg-white/[0.03] text-slate-500"
                        }
                      >
                        {item.enabled ? "启用" : "停用"}
                      </Badge>
                    </div>
                    <div className="mono mt-1 text-[10px] text-slate-500">{item.region_id}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<ArrowRight size={12} />}
                    onClick={() => enterRegion(item.region_id)}
                  >
                    进入地域
                  </Button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span>
                    实例 <span className="mono text-slate-200">{item.instance_total}</span>
                  </span>
                  <span>
                    冷池 <span className="mono text-sky-300">{cold}</span>
                    <span className="text-slate-600"> / {target}</span>
                  </span>
                  <span>
                    使用中 <span className="mono text-acid">{inUse}</span>
                  </span>
                  <span>
                    共享 PG <span className="mono text-violet">{item.shared_pgs.length}</span>
                  </span>
                </div>
                <div className="mt-2">
                  <Progress value={progress} tone={index % 2 === 0 ? "cyan" : "violet"} />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(["single", "shared"] as PoolMode[]).map((mode) => (
                    <PoolMini key={mode} mode={mode} pool={item.pools[mode]} />
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                  <Mini label="活跃租户" value={item.capacity?.current_active_tenants ?? 0} tone="acid" />
                  <Mini label="注册租户" value={item.capacity?.current_total_tenants ?? 0} tone="cyan" />
                  <Mini label="活跃上限" value={item.capacity?.estimated_max_active_tenants ?? 0} tone="slate" />
                  <Mini label="注册上限" value={item.capacity?.estimated_max_total_tenants ?? 0} tone="violet" />
                </div>

                {item.alerts.length ? (
                  <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2 text-[10px] text-amber">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>
                      {item.alerts.length} 条提示：{item.alerts[0]?.title}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-600">
                    <Sparkles size={11} /> 暂无告警
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Globe2 size={28} />}
            title="还没有纳管地域"
            description="先添加一个地域与单租/共享资源池，再回到全局总览查看跨地域水位。"
            action={
              <Link to="/pools">
                <Button size="sm" variant="primary" icon={<Layers size={13} />}>
                  新增地域
                </Button>
              </Link>
            }
          />
        </Card>
      )}

      {globalOverview?.fetched_at ? (
        <div className="text-right text-[10px] text-slate-600">
          全局数据更新于 {relativeTime(globalOverview.fetched_at)}
        </div>
      ) : null}
    </div>
  );
}

function GlobalStat({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone: "cyan" | "sky" | "violet" | "rose" | "slate";
}) {
  const tones = {
    cyan: "border-cyan/20 bg-cyan/[0.05] text-cyan-300",
    sky: "border-sky-400/20 bg-sky-400/[0.05] text-sky-300",
    violet: "border-violet/20 bg-violet/[0.05] text-violet",
    rose: "border-rose/20 bg-rose/[0.05] text-rose",
    slate: "border-edge bg-white/[0.02] text-slate-400",
  }[tone];
  return (
    <Card className="p-4" noCorners>
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

function PoolMini({ mode, pool }: { mode: PoolMode; pool?: PoolSummary }) {
  const meta = MODE_META[mode];
  return (
    <div className="rounded-lg border border-edge bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-300">{meta.label}</span>
        <span className="mono text-[10px] text-slate-500">
          {pool?.total ?? 0}/{pool?.max ?? 0}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {mode === "single" ? (
          <Snowflake size={11} className="text-sky-300" />
        ) : (
          <Flame size={11} className="text-violet" />
        )}
        <span className="text-[10px] text-slate-500">
          冷池 <span className="mono text-slate-300">{pool?.cold ?? 0}</span> / 目标{" "}
          <span className="mono text-slate-300">{pool?.target ?? 0}</span>
        </span>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: "acid" | "cyan" | "slate" | "violet" }) {
  const toneClass = {
    acid: "text-acid",
    cyan: "text-cyan-300",
    slate: "text-slate-200",
    violet: "text-violet",
  }[tone];
  return (
    <div className="rounded-md border border-edge bg-white/[0.02] px-2 py-1.5">
      <div className="text-slate-500">{label}</div>
      <div className={cx("mono mt-0.5", toneClass)}>{formatNumber(value)}</div>
    </div>
  );
}

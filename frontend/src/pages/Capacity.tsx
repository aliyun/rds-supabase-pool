import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Gauge, Info, RefreshCw, Save, Server, Users } from "lucide-react";
import { api } from "../lib/api";
import { cx, formatNumber, relativeTime } from "../lib/format";
import { useAppData } from "../lib/store";
import { RatioDial } from "../components/RatioDial";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Progress,
  Spinner,
  StatusBadge,
  useToast,
} from "../components/ui";
import type { Capacity, SharedPg } from "../lib/types";

const PRESETS = [0.1, 0.25, 0.5, 0.75, 1];

export function CapacityPage() {
  const { region, regionId, refreshOverview } = useAppData();
  const { push } = useToast();
  const [sharedPgs, setSharedPgs] = useState<SharedPg[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0.5);
  const [dirty, setDirty] = useState(false);

  const selected = useMemo(
    () => sharedPgs.find((item) => item.pg_instance_id === selectedId) || null,
    [sharedPgs, selectedId],
  );
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const stopMode = region?.pools.find((item) => item.mode === "shared")?.config.stop_mode;

  const applyDetail = (data: { capacity: Capacity | null; capacity_error?: string | null; stale?: boolean }) => {
    setCapacity(data.capacity);
    if (data.capacity) setRatio(data.capacity.active_ratio);
    setNotice(
      data.capacity_error ? `${data.capacity_error}${data.stale ? " 当前展示上次缓存的容量快照。" : ""}` : null,
    );
    setDirty(false);
  };

  const loadCapacity = useCallback(async (pgId: string) => {
    if (!pgId) return;
    setLoading(true);
    setError(null);
    try {
      applyDetail(await api.capacity(pgId));
    } catch (err) {
      setCapacity(null);
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.capacityOverview(regionId || undefined);
      setSharedPgs(data.shared_pgs);
      const nextId =
        data.shared_pgs.find((item) => item.pg_instance_id === selectedIdRef.current)?.pg_instance_id ||
        data.shared_pgs[0]?.pg_instance_id ||
        "";
      setSelectedId(nextId);
      if (nextId) {
        applyDetail(await api.capacity(nextId));
      } else {
        setCapacity(null);
        setNotice(null);
      }
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // 选择行的实时刷新由 loadCapacity 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId, refreshOverview]);

  useEffect(() => {
    void load();
  }, [load]);

  const projected = useMemo(() => {
    if (!capacity) return null;
    const maxActive = capacity.estimated_max_active_tenants || 0;
    return {
      maxTotal: ratio > 0 ? Math.floor(maxActive / ratio) : 0,
      shrinkWarning: capacity.current_total_tenants > (ratio > 0 ? Math.floor(maxActive / ratio) : 0),
    };
  }, [capacity, ratio]);

  const submit = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const result = await api.modifyCapacity(Number(ratio.toFixed(2)), selectedId);
      setCapacity(result.capacity);
      setRatio(result.capacity.active_ratio);
      setNotice(null);
      setDirty(false);
      push("success", result.message || "activeRatio 已更新");
      await refreshOverview();
      await load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!sharedPgs.length && !loading) {
    return (
      <div className="space-y-4">
        <Header regionName={region?.name || regionId} onRefresh={() => void load()} loading={loading} />
        <Card>
          <EmptyState
            icon={<Gauge size={28} />}
            title="当前地域共享池还没有共享 PG"
            description="容量管理只对多租共享池生效。请先在地域与资源池页面为共享池添加已有 PG。"
            action={
              <Link to="/pools">
                <Button size="sm" variant="primary" icon={<ArrowRight size={13} />}>
                  去配置共享 PG
                </Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const aggregate = sharedPgs.reduce(
    (acc, item) => {
      acc.active += item.capacity?.current_active_tenants ?? item.tenant_count ?? 0;
      acc.total += item.capacity?.current_total_tenants ?? item.tenant_count ?? 0;
      acc.maxActive += item.capacity?.estimated_max_active_tenants ?? 0;
      acc.maxTotal += item.capacity?.estimated_max_total_tenants ?? 0;
      return acc;
    },
    { active: 0, total: 0, maxActive: 0, maxTotal: 0 },
  );

  return (
    <div className="space-y-4">
      <Header regionName={region?.name || regionId} onRefresh={() => void load()} loading={loading} />

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-2.5 text-[11px] text-amber">
          <AlertTriangle size={14} className="mt-0.5" />
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-2.5 text-[11px] leading-5 text-amber">
          <Info size={14} className="mt-0.5 shrink-0" />
          {notice}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary
          label="共享 PG"
          value={`${sharedPgs.length}`}
          sub={`${sharedPgs.filter((item) => item.enabled).length} 台启用`}
        />
        <Summary
          label="当前活跃租户"
          value={formatNumber(aggregate.active)}
          sub={`上限 ${formatNumber(aggregate.maxActive)}`}
          tone="acid"
        />
        <Summary
          label="当前注册租户"
          value={formatNumber(aggregate.total)}
          sub={`软上限 ${formatNumber(aggregate.maxTotal)}`}
          tone="cyan"
        />
        <Summary
          label="调度余量"
          value={formatNumber(Math.max(0, aggregate.maxTotal - aggregate.total))}
          sub="按当前缓存容量估算"
          tone="violet"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-edge px-4 py-3">
          <div className="display-title text-sm text-slate-200">共享 PG 容量总览</div>
          <div className="mt-0.5 text-[10px] text-slate-500">点击行切换，切换时从云端刷新该 PG 的实时容量。</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-normal">共享 PG</th>
                <th className="px-3 py-2.5 font-normal">状态</th>
                <th className="px-3 py-2.5 font-normal">租户 / 保留</th>
                <th className="px-3 py-2.5 font-normal">activeRatio</th>
                <th className="px-3 py-2.5 font-normal">活跃 / 注册</th>
                <th className="px-3 py-2.5 font-normal">容量上限</th>
                <th className="px-3 py-2.5 font-normal">最近检查</th>
              </tr>
            </thead>
            <tbody>
              {sharedPgs.map((pg) => {
                const itemCap = pg.capacity || ({} as Capacity);
                return (
                  <tr
                    key={pg.pg_instance_id}
                    onClick={() => {
                      setSelectedId(pg.pg_instance_id);
                      void loadCapacity(pg.pg_instance_id);
                    }}
                    className={cx(
                      "cursor-pointer border-t border-edge/60 transition-colors hover:bg-white/[0.03]",
                      selectedId === pg.pg_instance_id && "bg-cyan/[0.05]",
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Server
                          size={13}
                          className={selectedId === pg.pg_instance_id ? "text-cyan-400" : "text-slate-600"}
                        />
                        <div>
                          <div className="text-[12px] text-slate-200">{pg.name || pg.pg_instance_id}</div>
                          <div className="mono text-[10px] text-slate-600">{pg.pg_instance_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={pg.status === "Running" ? "Available" : "Creating"} />
                        {!pg.enabled ? (
                          <Badge className="border-amber/25 bg-amber/[0.07] text-amber">停用</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-slate-400">
                      <span className="mono">{pg.tenant_count}</span>
                      {pg.reserved_slots ? <span className="text-amber"> +{pg.reserved_slots} 保留</span> : null}
                    </td>
                    <td className="mono px-3 py-3 text-[11px] text-cyan-300">
                      {itemCap.active_ratio != null ? Number(itemCap.active_ratio).toFixed(2) : "—"}
                    </td>
                    <td className="mono px-3 py-3 text-[11px] text-slate-300">
                      {itemCap.current_active_tenants != null ? itemCap.current_active_tenants : "—"} /{" "}
                      {itemCap.current_total_tenants != null ? itemCap.current_total_tenants : "—"}
                    </td>
                    <td className="mono px-3 py-3 text-[11px] text-slate-500">
                      {itemCap.estimated_max_active_tenants ?? "—"} / {itemCap.estimated_max_total_tenants ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-[10px] text-slate-500">
                      {pg.last_checked_at ? relativeTime(pg.last_checked_at) : "未拉取"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {loading && !capacity ? (
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      ) : capacity && selected ? (
        <>
          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="p-5 xl:col-span-3" glow="cyan">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="label-eyebrow">SHARED PG CAPACITY</div>
                  <div className="display-title mt-1 text-lg text-white">租户容量水位</div>
                  <div className="mono mt-1 text-[10px] text-slate-500">
                    {selected.name || selected.pg_instance_id} · {capacity.db_instance_name}
                  </div>
                </div>
                <span className="rounded-md border border-cyan/25 bg-cyan/[0.06] px-2 py-1 text-[10px] text-cyan-300">
                  activeRatio 策略
                </span>
              </div>
              <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
                <RatioDial ratio={capacity.active_ratio} size={172} />
                <div className="grid w-full flex-1 grid-cols-2 gap-3">
                  <Metric label="当前活跃租户" value={formatNumber(capacity.current_active_tenants)} tone="acid" />
                  <Metric label="当前注册租户" value={formatNumber(capacity.current_total_tenants)} tone="cyan" />
                  <Metric
                    label="活跃租户硬上限"
                    value={formatNumber(capacity.estimated_max_active_tenants)}
                    tone="slate"
                  />
                  <Metric
                    label="注册租户软上限"
                    value={formatNumber(capacity.estimated_max_total_tenants)}
                    tone="violet"
                  />
                </div>
              </div>
              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">注册租户 / 软上限</span>
                  <span className="mono text-slate-300">
                    {capacity.current_total_tenants} / {capacity.estimated_max_total_tenants}
                  </span>
                </div>
                <Progress
                  value={
                    capacity.estimated_max_total_tenants
                      ? (capacity.current_total_tenants / capacity.estimated_max_total_tenants) * 100
                      : 0
                  }
                  tone="cyan"
                />
              </div>
            </Card>

            <Card className="p-5 xl:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gauge size={15} className="text-cyan-400" />
                  <span className="display-title text-sm text-slate-200">调整 activeRatio</span>
                </div>
                <span className="text-[10px] text-slate-600">范围 0.1 ~ 1.0</span>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="flex items-end justify-between">
                    <span className="label-eyebrow">ACTIVE RATIO</span>
                    <span className="display-title text-2xl text-white">{ratio.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={ratio}
                    onChange={(event) => {
                      setRatio(Number(event.target.value));
                      setDirty(true);
                    }}
                    className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-cyan-400"
                  />
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset}
                        onClick={() => {
                          setRatio(preset);
                          setDirty(true);
                        }}
                        className={cx(
                          "rounded-md border px-2.5 py-1 text-[11px] transition-colors",
                          Math.abs(ratio - preset) < 0.001
                            ? "border-cyan/40 bg-cyan/10 text-cyan-300"
                            : "border-edge bg-white/[0.02] text-slate-500 hover:text-slate-300",
                        )}
                      >
                        {preset.toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="精确输入" hint="保留两位小数">
                  <Input
                    type="number"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={ratio}
                    onChange={(event) => {
                      setRatio(Math.max(0.1, Math.min(1, Number(event.target.value) || 0.1)));
                      setDirty(true);
                    }}
                  />
                </Field>
                <div className="rounded-lg border border-edge bg-white/[0.02] p-3 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">调整后注册软上限</span>
                    <span className="mono text-slate-200">{formatNumber(projected?.maxTotal ?? 0)}</span>
                  </div>
                  {projected?.shrinkWarning ? (
                    <div className="mt-2 flex items-start gap-1.5 text-amber">
                      <AlertTriangle size={12} className="mt-0.5" />
                      新上限低于当前注册租户数，只会收紧新增准入，不会删除或冻结存量租户。
                    </div>
                  ) : null}
                </div>
                <Button
                  variant="primary"
                  className="w-full"
                  icon={<Save size={14} />}
                  loading={saving}
                  disabled={!dirty || Math.abs(ratio - capacity.active_ratio) < 0.001}
                  onClick={() => void submit()}
                >
                  应用调整
                </Button>
                <div className="text-[10px] leading-5 text-slate-600">
                  Modify 后会自动再 Describe 一次，确认最终生效值。仅影响当前选中的共享 PG。
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Info size={15} className="text-cyan-400" />
                <span className="display-title text-sm text-slate-200">activeRatio 怎么理解</span>
              </div>
              <div className="mt-3 space-y-3 text-[11px] leading-6 text-slate-400">
                <p>
                  总注册租户软上限 = 活跃租户硬上限 ÷
                  activeRatio。调低比例可以注册更多租户，但活跃峰值同时打满时更容易触及 PG
                  连接上限；调高比例则收紧准入。
                </p>
                <div className="rounded-lg border border-cyan/20 bg-cyan/[0.04] px-3 py-2.5">
                  <span className="mono text-cyan-300">
                    {formatNumber(capacity.estimated_max_active_tenants)} ÷ {capacity.active_ratio.toFixed(2)} ={" "}
                    {formatNumber(capacity.estimated_max_total_tenants)}
                  </span>
                </div>
                <p className="text-slate-500">
                  activeRatio 是 PG 级单值，并发修改为 last-write-wins；同一 PG 同时只允许一个修改在途。
                </p>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Users size={15} className="text-acid" />
                <span className="display-title text-sm text-slate-200">活跃租户口径</span>
              </div>
              <div className="mt-3 space-y-2 text-[11px] leading-6 text-slate-400">
                <p>
                  <span className="text-slate-200">当前活跃租户</span> 指持有连接配额、未被冻结的租户数，不是 Running
                  实例数，也不是实时连接数。
                </p>
                <p>
                  普通保温停不会释放连接名额；只有 Force
                  停或迁移冻结才会让租户从活跃中剔除。想让活跃租户数下降，需要对租户执行 Force 停。
                </p>
                <div className="flex items-center justify-between rounded-lg border border-edge bg-white/[0.02] px-3 py-2">
                  <span className="text-slate-500">当前共享池停实例模式</span>
                  <span className="rounded border border-edge bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-300">
                    {stopMode === "force" ? "Force 停" : "普通停"}
                  </span>
                </div>
                <Link to="/pools" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                  修改池策略 <ArrowRight size={12} />
                </Link>
              </div>
            </Card>
          </div>
        </>
      ) : null}

      {!capacity && !loading && sharedPgs.length ? (
        <Card>
          <EmptyState
            icon={<Gauge size={26} />}
            title={notice ? "容量数据暂不可用" : "暂无容量数据"}
            description={notice || "选择上方共享 PG 或点击刷新重新拉取容量快照。"}
            action={
              <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={() => void load()}>
                重新拉取
              </Button>
            }
          />
        </Card>
      ) : null}
    </div>
  );
}

function Header({ regionName, onRefresh, loading }: { regionName: string; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="label-eyebrow">CAPACITY CONTROL</div>
        <h1 className="display-title mt-1 text-2xl font-semibold text-white">
          容量管理
          <span className="ml-2 align-middle text-sm font-normal text-cyan-300">{regionName || "未选择地域"}</span>
        </h1>
        <p className="mt-1 text-xs text-slate-500">逐台管理共享 PG 的 activeRatio 与可注册租户总量。</p>
      </div>
      <Button
        variant="secondary"
        icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
        onClick={onRefresh}
      >
        刷新容量
      </Button>
    </div>
  );
}

function Summary({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "slate" | "acid" | "cyan" | "violet";
}) {
  const toneClass = {
    slate: "text-slate-200",
    acid: "text-acid",
    cyan: "text-cyan-300",
    violet: "text-violet",
  }[tone];
  return (
    <Card className="p-4">
      <div className="label-eyebrow">{label}</div>
      <div className={cx("display-title mt-1 text-2xl font-semibold", toneClass)}>{value}</div>
      <div className="mt-1 text-[10px] text-slate-500">{sub}</div>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "acid" | "cyan" | "slate" | "violet" }) {
  const toneClass = {
    acid: "text-acid",
    cyan: "text-cyan-300",
    slate: "text-slate-200",
    violet: "text-violet",
  }[tone];
  return (
    <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={cx("display-title mt-1 text-xl", toneClass)}>{value}</div>
    </div>
  );
}

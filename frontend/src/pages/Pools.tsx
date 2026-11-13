import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Database,
  Globe2,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Snowflake,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { cx, MODE_META, relativeTime } from "../lib/format";
import { useAppData } from "../lib/store";
import { ConfirmDialog } from "../components/PoolActions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
  Toggle,
  useToast,
} from "../components/ui";
import type { PgInstance, PoolSettings, Region, RegionPool, SharedPg, VSwitch, Vpc } from "../lib/types";

export function PoolsPage() {
  const { regions, regionId, setRegion, refreshRegions, refreshAll } = useAppData();
  const { push } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const reload = async () => {
    setRefreshing(true);
    try {
      await refreshRegions();
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-eyebrow">REGION / POOL TOPOLOGY</div>
          <h1 className="display-title mt-1 text-2xl font-semibold text-white">地域与资源池</h1>
          <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500">
            每个地域固定维护一个单租户池和一个多租共享池。池参数、网络与共享 PG 独立配置，自动补货按池执行。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
            onClick={() => void reload()}
          >
            刷新
          </Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
            新增地域
          </Button>
        </div>
      </div>

      {regions.length ? (
        <div className="space-y-4">
          {regions.map((region) => (
            <RegionCard
              key={region.region_id}
              region={region}
              active={region.region_id === regionId}
              onActivate={() => setRegion(region.region_id)}
              onChanged={() => void reload()}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Globe2 size={28} />}
            title="还没有纳管地域"
            description="新增地域时会同时创建单租户池与多租共享池，并校验 VPC / VSwitch 归属。"
            action={
              <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>
                新增地域
              </Button>
            }
          />
        </Card>
      )}

      <div className="rounded-xl border border-edge bg-white/[0.02] px-4 py-3 text-[11px] leading-6 text-slate-500">
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} className="mt-1 shrink-0 text-amber" />
          <div>
            共享池可以挂多台共享 PG，预热时按“已用租户 + 预留名额”的负载比例选择最空闲的一台；租户不会在 PG
            之间自动迁移。 单租池每个实例创建独立 PG，释放策略为直接删除时会一并删除底层 PG。
          </div>
        </div>
      </div>

      <AddRegionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(region) => {
          void refreshRegions();
          setRegion(region.region_id);
          push("success", `地域 ${region.name || region.region_id} 已创建`);
        }}
      />
    </div>
  );
}

function RegionCard({
  region,
  active,
  onActivate,
  onChanged,
}: {
  region: Region;
  active: boolean;
  onActivate: () => void;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [editPool, setEditPool] = useState<RegionPool | null>(null);
  const [sharedPgs, setSharedPgs] = useState<SharedPg[]>([]);
  const [pgsLoading, setPgsLoading] = useState(false);
  const [addPgOpen, setAddPgOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SharedPg | null>(null);
  const [removeDeleteCloud, setRemoveDeleteCloud] = useState(false);
  const [busyPg, setBusyPg] = useState<string | null>(null);

  const single = region.pools.find((item) => item.mode === "single");
  const shared = region.pools.find((item) => item.mode === "shared");

  const loadSharedPgs = async () => {
    if (!shared) return;
    setPgsLoading(true);
    try {
      const data = await api.sharedPgs(shared.id);
      setSharedPgs(data.shared_pgs);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setPgsLoading(false);
    }
  };

  useEffect(() => {
    void loadSharedPgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared?.id]);

  const toggleRegion = async (value: boolean) => {
    try {
      await api.updateRegion(region.region_id, { enabled: value });
      push("success", value ? "地域已启用" : "地域已停用");
      onChanged();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  const togglePortal = async (value: boolean) => {
    try {
      await api.updateRegion(region.region_id, { portal_enabled: value });
      push("success", value ? "用户门户已开放" : "用户门户已关闭");
      onChanged();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  const setPortalMode = async (mode: "single" | "shared" | "both") => {
    try {
      await api.updateRegion(region.region_id, { portal_pool_mode: mode });
      push(
        "success",
        mode === "both"
          ? "用户门户将同时开放单租户池和多租共享池"
          : `用户门户将只开放${mode === "single" ? "单租户池" : "多租共享池"}`,
      );
      onChanged();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  const toggleSharedPg = async (pg: SharedPg, enabled: boolean) => {
    setBusyPg(pg.pg_instance_id);
    try {
      await api.updateSharedPg(pg.pg_instance_id, { enabled });
      await loadSharedPgs();
      onChanged();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPg(null);
    }
  };

  const syncPg = async (pg: SharedPg) => {
    setBusyPg(pg.pg_instance_id);
    try {
      await api.syncSharedPg(pg.pg_instance_id);
      await loadSharedPgs();
      onChanged();
      push("success", `已同步 ${pg.pg_instance_id}`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPg(null);
    }
  };

  const removePg = async () => {
    if (!removeTarget) return;
    setBusyPg(removeTarget.pg_instance_id);
    try {
      await api.removeSharedPg(removeTarget.pg_instance_id, removeDeleteCloud);
      push("success", removeDeleteCloud ? "共享 PG 已移除，云上实例删除已提交" : "共享 PG 已移除（未删除云上 PG）");
      setRemoveTarget(null);
      await loadSharedPgs();
      onChanged();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPg(null);
    }
  };

  return (
    <Card className={cx("overflow-hidden", active && "border-cyan/30")} glow={active ? "cyan" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span
            className={cx(
              "mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border",
              active ? "border-cyan/30 bg-cyan/[0.08] text-cyan-300" : "border-edge bg-white/[0.03] text-slate-500",
            )}
          >
            <Globe2 size={17} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="display-title text-base text-white">{region.name || region.region_id}</span>
              <span className="mono text-[10px] text-slate-500">{region.region_id}</span>
              {active ? <Badge className="border-cyan/30 bg-cyan/[0.07] text-cyan-300">当前地域</Badge> : null}
              {!region.enabled ? <Badge className="border-edge bg-white/[0.03] text-slate-500">已停用</Badge> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
              <span>控制台 {region.enabled ? "ENABLED" : "DISABLED"}</span>
              <span>门户 {region.portal_enabled ? "OPEN" : "CLOSED"}</span>
              <span>
                默认模式{" "}
                {region.portal_pool_mode === "both"
                  ? "单租 / 共享均可"
                  : (MODE_META[region.portal_pool_mode]?.label ?? region.portal_pool_mode)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle checked={region.enabled} onChange={(value) => void toggleRegion(value)} label="地域启用" />
          <Toggle checked={region.portal_enabled} onChange={(value) => void togglePortal(value)} label="用户门户" />
          <Select
            value={region.portal_pool_mode}
            onChange={(event) => void setPortalMode(event.target.value as "single" | "shared" | "both")}
            className="h-7 w-[150px] py-0 text-[10px]"
            title="用户申请时可选择的池模式"
          >
            <option value="both">门户：两种都可选</option>
            <option value="shared">门户：仅共享池</option>
            <option value="single">门户：仅单租池</option>
          </Select>
          {!active ? (
            <Button size="sm" variant="secondary" icon={<ChevronRight size={13} />} onClick={onActivate}>
              设为当前
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-2">
        {single ? <PoolTile pool={single} onEdit={() => setEditPool(single)} /> : null}
        {shared ? <PoolTile pool={shared} onEdit={() => setEditPool(shared)} /> : null}
      </div>

      {shared ? (
        <div className="border-t border-edge px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database size={14} className="text-violet" />
              <span className="display-title text-sm text-slate-200">共享 PG 分组</span>
              <span className="text-[10px] text-slate-500">共 {sharedPgs.length} 台，用于承载多租共享实例</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={12} className={pgsLoading ? "animate-spin" : ""} />}
                onClick={() => void loadSharedPgs()}
              >
                刷新列表
              </Button>
              <Button size="sm" variant="secondary" icon={<Plus size={12} />} onClick={() => setAddPgOpen(true)}>
                添加共享 PG
              </Button>
            </div>
          </div>

          {sharedPgs.length ? (
            <div className="mt-3 overflow-x-auto rounded-lg border border-edge">
              <table className="w-full min-w-[800px] text-left text-[11px]">
                <thead className="bg-white/[0.03] text-[10px] text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 font-normal">共享 PG</th>
                    <th className="px-3 py-2.5 font-normal">状态</th>
                    <th className="px-3 py-2.5 font-normal">规格 / 网络</th>
                    <th className="px-3 py-2.5 font-normal">租户 / 预留</th>
                    <th className="px-3 py-2.5 font-normal">容量（活跃/注册）</th>
                    <th className="px-3 py-2.5 text-right font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sharedPgs.map((pg) => (
                    <tr key={pg.pg_instance_id} className="border-t border-edge/60">
                      <td className="px-3 py-2.5">
                        <div className="text-slate-300">{pg.name || pg.pg_instance_id}</div>
                        <div className="mono text-[10px] text-slate-600">{pg.pg_instance_id}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={pg.status === "Running" ? "Available" : "Creating"} />
                          {!pg.enabled ? (
                            <Badge className="border-amber/25 bg-amber/[0.07] text-amber">停用</Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-600">
                          {pg.last_checked_at ? relativeTime(pg.last_checked_at) : "未同步"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">
                        <div>{pg.instance_class || "—"}</div>
                        <div className="mono text-[10px] text-slate-600">{pg.vswitch_id || "—"}</div>
                      </td>
                      <td className="mono px-3 py-2.5 text-slate-300">
                        {pg.tenant_count}
                        {pg.reserved_slots ? <span className="text-amber"> +{pg.reserved_slots}</span> : null}
                      </td>
                      <td className="mono px-3 py-2.5 text-slate-400">
                        {pg.capacity?.current_active_tenants ?? 0} / {pg.capacity?.current_total_tenants ?? 0}
                        <span className="text-slate-600">
                          {" "}
                          · 上限 {pg.capacity?.estimated_max_active_tenants ?? "—"}/
                          {pg.capacity?.estimated_max_total_tenants ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<RefreshCw size={12} />}
                            loading={busyPg === pg.pg_instance_id}
                            onClick={() => void syncPg(pg)}
                          >
                            同步
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyPg === pg.pg_instance_id}
                            onClick={() => void toggleSharedPg(pg, !pg.enabled)}
                          >
                            {pg.enabled ? "停用" : "启用"}
                          </Button>
                          <button
                            title="移除共享 PG"
                            disabled={busyPg === pg.pg_instance_id}
                            onClick={() => {
                              setRemoveDeleteCloud(false);
                              setRemoveTarget(pg);
                            }}
                            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-rose/[0.08] hover:text-rose disabled:opacity-40"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-edge bg-white/[0.01] px-4 py-6 text-center text-[11px] text-slate-500">
              共享池还没有共享 PG。添加后，预热的多租实例会被调度到负载最低的一台。
            </div>
          )}
        </div>
      ) : null}

      {editPool ? (
        <PoolConfigModal
          pool={editPool}
          onClose={() => setEditPool(null)}
          onSaved={() => {
            setEditPool(null);
            onChanged();
          }}
        />
      ) : null}

      {addPgOpen && shared ? (
        <AddSharedPgModal
          regionId={region.region_id}
          poolId={shared.id}
          pool={shared}
          existing={sharedPgs.map((item) => item.pg_instance_id)}
          onClose={() => setAddPgOpen(false)}
          onAdded={() => {
            setAddPgOpen(false);
            void loadSharedPgs();
            onChanged();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="移除共享 PG"
        description={`确认从共享池移除 ${removeTarget?.pg_instance_id ?? ""}？只有该 PG 上没有租户时才能移除；默认不会删除云上 PG 资源。`}
        confirmLabel={removeDeleteCloud ? "移除并删除 PG" : "确认移除"}
        variant="danger"
        loading={busyPg !== null}
        onConfirm={() => void removePg()}
      >
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-rose/25 bg-rose/[0.05] px-3 py-2.5">
          <div className="text-[11px] leading-5 text-rose">
            同时删除云上 PG
            <div className="text-[10px] text-slate-500">不可恢复；仅在该 PG 没有租户时可用。</div>
          </div>
          <Toggle checked={removeDeleteCloud} onChange={setRemoveDeleteCloud} label="同时删除云上 PG" />
        </div>
      </ConfirmDialog>
    </Card>
  );
}

function PoolTile({ pool, onEdit }: { pool: RegionPool; onEdit: () => void }) {
  const meta = MODE_META[pool.mode];
  const percentage = pool.target > 0 ? Math.min(100, Math.round((pool.cold / pool.target) * 100)) : 0;
  return (
    <div
      className={cx(
        "rounded-xl border p-4",
        pool.mode === "single" ? "border-cyan/20 bg-cyan/[0.03]" : "border-violet/20 bg-violet/[0.03]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="display-title text-sm text-white">{pool.name}</span>
            <Badge className={meta.badge}>{meta.label}</Badge>
            {!pool.enabled ? <Badge className="border-edge bg-white/[0.03] text-slate-500">停用</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span>
              目标 <span className="mono text-slate-300">{pool.target}</span>
            </span>
            <span>
              上限 <span className="mono text-slate-300">{pool.max}</span>
            </span>
            <span>
              自动补货{" "}
              <span className={pool.config.auto_refill ? "text-acid" : "text-slate-500"}>
                {pool.config.auto_refill ? "ON" : "OFF"}
              </span>
            </span>
            <span>
              释放{" "}
              <span className="text-slate-300">
                {pool.config.release_policy === "destroy" ? "直接删除" : "同应用复用"}
              </span>
            </span>
          </div>
        </div>
        <Button size="sm" variant="secondary" icon={<Settings2 size={12} />} onClick={onEdit}>
          池参数
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <TileStat icon={<Snowflake size={11} />} label="冷池" value={pool.cold} tone="sky" />
        <TileStat icon={<Users size={11} />} label="使用中" value={pool.in_use} tone="acid" />
        <TileStat icon={<Zap size={11} />} label="创建中" value={pool.creating} tone="amber" />
        <TileStat
          icon={<AlertTriangle size={11} />}
          label="失败"
          value={pool.failed}
          tone={pool.failed ? "rose" : "slate"}
        />
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
          <span>冷池水位</span>
          <span className="mono">{percentage}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={cx("h-full rounded-full transition-all", pool.mode === "single" ? "bg-cyan-400" : "bg-violet")}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-[10px] text-slate-500">
        <span>
          网络{" "}
          <span className="mono text-slate-400">
            {pool.vpc_id || "未配置"} / {pool.vswitch_id || "未配置"}
          </span>
        </span>
        <span>
          可用区 <span className="mono text-slate-400">{pool.zone_id || "—"}</span>
        </span>
        {pool.mode === "shared" ? (
          <span>
            共享 PG <span className="mono text-violet">{pool.shared_pg_count}</span>
          </span>
        ) : (
          <span>
            单租 PG 规格 <span className="text-slate-400">{pool.config.single_pg_class}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function TileStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "sky" | "acid" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    sky: "text-sky-300",
    acid: "text-acid",
    amber: "text-amber",
    rose: value ? "text-rose" : "text-slate-500",
    slate: "text-slate-400",
  }[tone];
  return (
    <div className="rounded-lg border border-edge bg-white/[0.02] px-2 py-1.5">
      <div className="flex items-center justify-center gap-1 text-[9px] text-slate-500">
        {icon}
        {label}
      </div>
      <div className={cx("mono mt-0.5 text-sm", toneClass)}>{value}</div>
    </div>
  );
}

function PoolConfigModal({ pool, onClose, onSaved }: { pool: RegionPool; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const [name, setName] = useState(pool.name);
  const [enabled, setEnabled] = useState(pool.enabled);
  const [config, setConfig] = useState<PoolSettings>({ ...pool.config });
  const [vpcId, setVpcId] = useState(pool.vpc_id || "");
  const [vswitchId, setVswitchId] = useState(pool.vswitch_id || "");
  const [zoneId, setZoneId] = useState(pool.zone_id || "");
  const [vpcs, setVpcs] = useState<Vpc[]>([]);
  const [vswitches, setVswitches] = useState<VSwitch[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadNetwork = async (preferredVpc?: string, preferredSwitch?: string) => {
    setNetworkLoading(true);
    try {
      const data = await api.vpcs(pool.region_id);
      setVpcs(data.vpcs);
      const targetVpc = preferredVpc || vpcId || data.vpcs[0]?.vpc_id || "";
      if (targetVpc) {
        setVpcId(targetVpc);
        const switches = await api.vswitches(targetVpc, pool.region_id);
        setVswitches(switches.vswitches);
        const current = switches.vswitches.find((item) => item.vswitch_id === (preferredSwitch || vswitchId));
        if (current) {
          setVswitchId(current.vswitch_id);
          setZoneId(current.zone_id);
        }
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setNetworkLoading(false);
    }
  };

  useEffect(() => {
    void loadNetwork(pool.vpc_id, pool.vswitch_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.id]);

  const save = async () => {
    if (config.target > config.max) {
      push("error", "目标水位不能大于最大实例数");
      return;
    }
    setSaving(true);
    try {
      const patch: Parameters<typeof api.updatePool>[1] = { name, enabled, config };
      if (vpcId !== (pool.vpc_id || "") || vswitchId !== (pool.vswitch_id || "")) {
        patch.vpc_id = vpcId;
        patch.vswitch_id = vswitchId;
        patch.zone_id = zoneId;
      }
      await api.updatePool(pool.id, patch);
      push("success", "资源池配置已保存");
      onSaved();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${MODE_META[pool.mode].label} · 池参数`}
      subtitle={`${pool.region_id} · ${pool.id}`}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" icon={<Save size={14} />} loading={saving} onClick={() => void save()}>
            保存配置
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="资源池名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="flex items-end pb-1">
            <Toggle checked={enabled} onChange={setEnabled} label="启用该资源池" />
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-white/[0.02] p-4">
          <div className="display-title text-xs text-slate-200">网络</div>
          <div className="mt-1 text-[10px] text-slate-500">
            单租实例使用这里的 VPC/VSwitch；共享实例优先使用所选共享 PG 的 VSwitch。
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="VPC">
              <div className="flex gap-2">
                <Select
                  value={vpcId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setVpcId(next);
                    void api.vswitches(next, pool.region_id).then((data) => {
                      setVswitches(data.vswitches);
                      if (data.vswitches[0]) {
                        setVswitchId(data.vswitches[0].vswitch_id);
                        setZoneId(data.vswitches[0].zone_id);
                      }
                    });
                  }}
                >
                  <option value="">请选择 VPC</option>
                  {!vpcs.some((item) => item.vpc_id === vpcId) && vpcId ? <option value={vpcId}>{vpcId}</option> : null}
                  {vpcs.map((item) => (
                    <option key={item.vpc_id} value={item.vpc_id}>
                      {item.name || item.vpc_id} · {item.cidr}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="secondary" loading={networkLoading} onClick={() => void loadNetwork()}>
                  发现
                </Button>
              </div>
            </Field>
            <Field label="VSwitch" hint={zoneId ? `可用区 ${zoneId}` : undefined}>
              <Select
                value={vswitchId}
                onChange={(event) => {
                  const next = vswitches.find((item) => item.vswitch_id === event.target.value);
                  setVswitchId(event.target.value);
                  setZoneId(next?.zone_id || "");
                }}
              >
                <option value="">请选择 VSwitch</option>
                {!vswitches.some((item) => item.vswitch_id === vswitchId) && vswitchId ? (
                  <option value={vswitchId}>{vswitchId}</option>
                ) : null}
                {vswitches.map((item) => (
                  <option key={item.vswitch_id} value={item.vswitch_id}>
                    {item.name || item.vswitch_id} · {item.zone_id}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-white/[0.02] p-4">
          <div className="display-title text-xs text-slate-200">水位与调度</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="目标水位">
              <Input
                type="number"
                min={0}
                max={50}
                value={config.target}
                onChange={(event) => setConfig({ ...config, target: Number(event.target.value) })}
              />
            </Field>
            <Field label="最大实例数">
              <Input
                type="number"
                min={1}
                max={50}
                value={config.max}
                onChange={(event) => setConfig({ ...config, max: Number(event.target.value) })}
              />
            </Field>
            <Field label="补货检查间隔（秒）">
              <Input
                type="number"
                min={10}
                max={1800}
                value={config.refill_interval_sec}
                onChange={(event) => setConfig({ ...config, refill_interval_sec: Number(event.target.value) })}
              />
            </Field>
            <Field label="释放策略">
              <Select
                value={config.release_policy}
                onChange={(event) =>
                  setConfig({ ...config, release_policy: event.target.value as PoolSettings["release_policy"] })
                }
              >
                <option value="return">同应用复用</option>
                <option value="destroy">直接删除</option>
              </Select>
            </Field>
            <Field label="冻结方式">
              <Select
                value={config.stop_mode}
                onChange={(event) =>
                  setConfig({ ...config, stop_mode: event.target.value as PoolSettings["stop_mode"] })
                }
              >
                <option value="normal">普通停（保温）</option>
                <option value="force">Force 停（释放连接名额）</option>
              </Select>
            </Field>
            <Field label="轮询间隔（秒）">
              <Input
                type="number"
                min={2}
                max={120}
                value={config.poll_interval_sec}
                onChange={(event) => setConfig({ ...config, poll_interval_sec: Number(event.target.value) })}
              />
            </Field>
            <Field label="创建超时（秒）">
              <Input
                type="number"
                min={120}
                max={3600}
                value={config.create_timeout_sec}
                onChange={(event) => setConfig({ ...config, create_timeout_sec: Number(event.target.value) })}
              />
            </Field>
            <Field label="批大小">
              <Input
                type="number"
                min={1}
                max={5}
                value={config.batch_size}
                onChange={(event) => setConfig({ ...config, batch_size: Number(event.target.value) })}
              />
            </Field>
            <Field label="批间隔（秒）">
              <Input
                type="number"
                min={0}
                max={300}
                value={config.batch_interval_sec}
                onChange={(event) => setConfig({ ...config, batch_interval_sec: Number(event.target.value) })}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Toggle
              checked={config.auto_refill}
              onChange={(value) => setConfig({ ...config, auto_refill: value })}
              label="自动补货"
            />
            <Toggle
              checked={config.public_endpoint_enabled}
              onChange={(value) => setConfig({ ...config, public_endpoint_enabled: value })}
              label="开启公网连接"
            />
          </div>
        </div>

        {pool.mode === "single" ? (
          <div className="rounded-xl border border-edge bg-white/[0.02] p-4">
            <div className="display-title text-xs text-slate-200">单租 PG 规格</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="实例规格">
                <Input
                  value={config.single_pg_class}
                  onChange={(event) => setConfig({ ...config, single_pg_class: event.target.value })}
                />
              </Field>
              <Field label="存储（GB）">
                <Input
                  type="number"
                  min={20}
                  max={1000}
                  value={config.single_pg_storage}
                  onChange={(event) => setConfig({ ...config, single_pg_storage: Number(event.target.value) })}
                />
              </Field>
              <Field label="系列">
                <Select
                  value={config.single_pg_category}
                  onChange={(event) => setConfig({ ...config, single_pg_category: event.target.value })}
                >
                  <option value="Basic">Basic 基础版</option>
                  <option value="HighAvailability">HighAvailability 高可用版</option>
                </Select>
              </Field>
              <Field label="引擎版本">
                <Select
                  value={config.single_engine_version}
                  onChange={(event) => setConfig({ ...config, single_engine_version: event.target.value })}
                >
                  <option value="17.0">PostgreSQL 17</option>
                  <option value="18.0">PostgreSQL 18</option>
                </Select>
              </Field>
              <Field label="白名单" hint="逗号分隔" className="sm:col-span-2">
                <Input
                  value={config.single_pg_security_ips}
                  onChange={(event) => setConfig({ ...config, single_pg_security_ips: event.target.value })}
                />
              </Field>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function AddRegionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (region: Region) => void;
}) {
  const { push } = useToast();
  const [regionId, setRegionId] = useState("");
  const [name, setName] = useState("");
  const [vpcId, setVpcId] = useState("");
  const [vswitchId, setVswitchId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [vpcs, setVpcs] = useState<Vpc[]>([]);
  const [vswitches, setVswitches] = useState<VSwitch[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setRegionId("");
      setName("");
      setVpcId("");
      setVswitchId("");
      setZoneId("");
      setVpcs([]);
      setVswitches([]);
    }
  }, [open]);

  const discover = async () => {
    if (!regionId.trim()) {
      push("error", "请先填写地域 ID，例如 cn-chengdu");
      return;
    }
    setLoading(true);
    try {
      const data = await api.vpcs(regionId.trim());
      setVpcs(data.vpcs);
      const first = data.vpcs[0]?.vpc_id;
      if (first) {
        setVpcId(first);
        const switches = await api.vswitches(first, regionId.trim());
        setVswitches(switches.vswitches);
        if (switches.vswitches[0]) {
          setVswitchId(switches.vswitches[0].vswitch_id);
          setZoneId(switches.vswitches[0].zone_id);
        }
      }
      push("success", `发现 ${data.vpcs.length} 个 VPC`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const changeVpc = async (next: string) => {
    setVpcId(next);
    try {
      const data = await api.vswitches(next, regionId.trim());
      setVswitches(data.vswitches);
      if (data.vswitches[0]) {
        setVswitchId(data.vswitches[0].vswitch_id);
        setZoneId(data.vswitches[0].zone_id);
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  const create = async () => {
    if (!regionId.trim() || !vpcId || !vswitchId) {
      push("error", "请填写地域 ID 并选择 VPC / VSwitch");
      return;
    }
    setCreating(true);
    try {
      const region = await api.createRegion({
        region_id: regionId.trim(),
        name: name.trim() || regionId.trim(),
        vpc_id: vpcId,
        vswitch_id: vswitchId,
        zone_id: zoneId,
      });
      onCreated(region);
      onClose();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新增地域"
      subtitle="创建后会同时生成单租户池与多租共享池，网络会做云端校验"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" icon={<Layers size={14} />} loading={creating} onClick={() => void create()}>
            创建地域与资源池
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="地域 ID" hint="例如 cn-chengdu">
            <Input value={regionId} onChange={(event) => setRegionId(event.target.value)} placeholder="cn-chengdu" />
          </Field>
          <Field label="显示名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="cn-hangzhou" />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-edge bg-white/[0.02] px-3 py-2">
          <span className="text-[11px] text-slate-400">从该地域发现 VPC 与 VSwitch</span>
          <Button size="sm" variant="secondary" loading={loading} onClick={() => void discover()}>
            发现网络
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="VPC">
            <Select value={vpcId} onChange={(event) => void changeVpc(event.target.value)}>
              <option value="">请选择 VPC</option>
              {vpcs.map((item) => (
                <option key={item.vpc_id} value={item.vpc_id}>
                  {item.name || item.vpc_id} · {item.cidr}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="VSwitch" hint={zoneId ? `可用区 ${zoneId}` : undefined}>
            <Select
              value={vswitchId}
              onChange={(event) => {
                const next = vswitches.find((item) => item.vswitch_id === event.target.value);
                setVswitchId(event.target.value);
                setZoneId(next?.zone_id || "");
              }}
            >
              <option value="">请选择 VSwitch</option>
              {vswitches.map((item) => (
                <option key={item.vswitch_id} value={item.vswitch_id}>
                  {item.name || item.vswitch_id} · {item.zone_id} · 可用 IP {item.available_ips}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5 text-[11px] leading-5 text-slate-500">
          新增地域后，可继续在两张池卡片中调整目标水位、自动补货与单租 PG 规格，并为共享池添加已有 PG。
        </div>
      </div>
    </Modal>
  );
}

function AddSharedPgModal({
  regionId,
  poolId,
  pool,
  existing,
  onClose,
  onAdded,
}: {
  regionId: string;
  poolId: string;
  pool: RegionPool;
  existing: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { push } = useToast();
  const [pgs, setPgs] = useState<PgInstance[]>([]);
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [pgId, setPgId] = useState("");
  const [customId, setCustomId] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [pgClass, setPgClass] = useState(pool.config.shared_pg_class || "pg.n2.2c.2m");
  const [pgStorage, setPgStorage] = useState(String(pool.config.shared_pg_storage || 20));
  const [pgEngine, setPgEngine] = useState(pool.config.shared_pg_engine_version || "18.0");
  const [pgZone, setPgZone] = useState(pool.zone_id || "");

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.pgs(regionId);
      setPgs(data.pgs);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId]);

  const candidates = useMemo(
    () => pgs.filter((item) => item.status === "Running" && !existing.includes(item.pg_instance_id)),
    [pgs, existing],
  );

  const add = async () => {
    const target = customId.trim() || pgId.trim();
    if (!target) {
      push("error", "请选择或填写 PG 实例 ID");
      return;
    }
    setAdding(true);
    try {
      await api.addSharedPg(poolId, { pg_instance_id: target, name: name.trim() });
      push("success", "共享 PG 已加入共享池");
      onAdded();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      const result = await api.createSharedPg(poolId, {
        name: createName.trim(),
        instance_class: pgClass.trim(),
        storage_gb: Number(pgStorage) || 20,
        engine_version: pgEngine.trim(),
        zone_id: pgZone.trim(),
      });
      push("success", `共享 PG 创建任务已提交：${result.task_id}`);
      onAdded();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="添加共享 PG"
      subtitle={`${regionId} · 可加入已有 Running PG，或新建 PG`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          {mode === "existing" ? (
            <Button variant="primary" icon={<Plus size={14} />} loading={adding} onClick={() => void add()}>
              加入共享池
            </Button>
          ) : (
            <Button variant="primary" icon={<Plus size={14} />} loading={creating} onClick={() => void create()}>
              创建共享 PG
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Tabs
          value={mode}
          onChange={(value) => setMode(value as "existing" | "create")}
          tabs={[
            { value: "existing", label: "选择已有" },
            { value: "create", label: "新建 PG" },
          ]}
        />
        {mode === "existing" ? (
          <>
            <div className="flex items-center justify-between rounded-lg border border-edge bg-white/[0.02] px-3 py-2">
              <span className="text-[11px] text-slate-400">从当前地域发现 PostgreSQL</span>
              <Button size="sm" variant="secondary" loading={loading} onClick={() => void load()}>
                发现 PG
              </Button>
            </div>
            <Field label="选择 PG" hint={`${candidates.length} 台可用`}>
              <Select value={pgId} onChange={(event) => setPgId(event.target.value)}>
                <option value="">请选择</option>
                {candidates.map((item) => (
                  <option key={item.pg_instance_id} value={item.pg_instance_id}>
                    {item.pg_instance_id} · {item.instance_class} · {item.storage_gb}GB
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="或直接填写 PG 实例 ID" hint="适用于列表未返回但已知实例 ID">
              <Input value={customId} onChange={(event) => setCustomId(event.target.value)} placeholder="pgm-..." />
            </Field>
            <Field label="显示名称" hint="可选">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 共享 PG 01" />
            </Field>
            <div className="rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2.5 text-[11px] leading-5 text-amber">
              加入前会校验 PG 与地域一致、状态 Running 且具备 VSwitch。不会修改 PG 本身配置。
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5 text-[11px] leading-5 text-slate-500">
              将使用当前共享池的 VPC / VSwitch 创建 PG：<span className="mono text-slate-300">{pool.vpc_id}</span> /{" "}
              <span className="mono text-slate-300">{pool.vswitch_id}</span>
            </div>
            <Field label="显示名称" hint="可选">
              <Input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="例如 共享 PG 01"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="实例规格" hint="共享 PG 需 HA 多租规格">
                <Input value={pgClass} onChange={(event) => setPgClass(event.target.value)} placeholder="pg.n2.2c.2m" />
              </Field>
              <Field label="存储 GB">
                <Input
                  type="number"
                  value={pgStorage}
                  onChange={(event) => setPgStorage(event.target.value)}
                  placeholder="20"
                />
              </Field>
              <Field label="引擎版本">
                <Input value={pgEngine} onChange={(event) => setPgEngine(event.target.value)} placeholder="18.0" />
              </Field>
              <Field label="可用区" hint="默认使用共享池可用区">
                <Input value={pgZone} onChange={(event) => setPgZone(event.target.value)} placeholder="cn-shanghai-l" />
              </Field>
            </div>
            <div className="rounded-lg border border-cyan/25 bg-cyan/[0.05] px-3 py-2.5 text-[11px] leading-5 text-cyan-200">
              创建会进入后台任务队列，完成后刷新共享 PG 列表；真实模式会产生 PG 费用。容量管理需要 HighAvailability
              多租规格。
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

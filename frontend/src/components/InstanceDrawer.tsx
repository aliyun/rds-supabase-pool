import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Clock3,
  Copy,
  Cpu,
  Database,
  KeyRound,
  Link2,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import {
  compactId,
  cx,
  formatBytes,
  formatDateTime,
  formatDuration,
  MODE_META,
  relativeTime,
  shortId,
  STATUS_META,
} from "../lib/format";
import { useAppData } from "../lib/store";
import type { AuditEvent, AuthInfo, DatabaseSizeInfo, EndpointsInfo, Instance, ResourceInfo } from "../lib/types";
import { AllocateModal, ConfirmDialog, ReleaseDialog } from "./PoolActions";
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Input,
  Progress,
  Select,
  StatusBadge,
  Spinner,
  Tabs,
  useToast,
} from "./ui";

type TabKey = "overview" | "connection" | "resource" | "timeline";

const EVENT_TONES: Record<string, string> = {
  prewarm_failed: "bg-rose",
  allocate_failed: "bg-rose",
  release_failed: "bg-rose",
  start_failed: "bg-rose",
  stop_failed: "bg-rose",
  restart_failed: "bg-rose",
  allocate: "bg-cyan-400",
  allocated: "bg-acid",
  returned: "bg-sky-400",
  incold: "bg-sky-400",
  destroyed: "bg-slate-500",
  capacity_modify: "bg-violet",
};

export function InstanceDrawer({
  instanceId,
  open,
  onClose,
}: {
  instanceId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { refreshAll } = useAppData();
  const { push } = useToast();
  const [tab, setTab] = useState<TabKey>("overview");
  const [instance, setInstance] = useState<Instance | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointsInfo | null>(null);
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [resource, setResource] = useState<ResourceInfo | null>(null);
  const [size, setSize] = useState<DatabaseSizeInfo | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"stop" | "restart" | null>(null);
  const [cpu, setCpu] = useState<number | "">("");
  const [memory, setMemory] = useState<number | "">("");
  const [limits, setLimits] = useState({
    authenticator_conn_limit: "",
    auth_admin_conn_limit: "",
    realtime_conn_limit: "",
    admin_conn_limit: "",
  });
  const [savingResource, setSavingResource] = useState(false);

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    setLiveError(null);
    try {
      const [detail, eventData] = await Promise.all([api.getInstance(instanceId), api.getEvents(instanceId)]);
      setInstance(detail);
      setEvents(eventData.events);
      const results = await Promise.allSettled([
        api.endpoints(instanceId),
        api.authInfo(instanceId),
        api.resource(instanceId),
        api.databaseSize(instanceId),
      ]);
      const [ep, au, re, sz] = results;
      setEndpoints(ep.status === "fulfilled" ? ep.value : null);
      setAuth(au.status === "fulfilled" ? au.value : null);
      if (re.status === "fulfilled") {
        setResource(re.value);
        setCpu(re.value.cpu_cores || "");
        setMemory(re.value.memory_size_gb || "");
        setLimits({
          authenticator_conn_limit: re.value.authenticator_conn_limit ? String(re.value.authenticator_conn_limit) : "",
          auth_admin_conn_limit: re.value.auth_admin_conn_limit ? String(re.value.auth_admin_conn_limit) : "",
          realtime_conn_limit: re.value.realtime_conn_limit ? String(re.value.realtime_conn_limit) : "",
          admin_conn_limit: re.value.admin_conn_limit ? String(re.value.admin_conn_limit) : "",
        });
      } else {
        setResource(null);
      }
      setSize(sz.status === "fulfilled" ? sz.value : null);
      const failures = results.filter((item) => item.status === "rejected") as PromiseRejectedResult[];
      if (failures.length) {
        setLiveError(
          failures.map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason))).join("；"),
        );
      }
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    if (open && instanceId) {
      setTab("overview");
      setInstance(null);
      setEvents([]);
      setEndpoints(null);
      setAuth(null);
      setResource(null);
      setSize(null);
      void load();
    }
  }, [open, instanceId, load]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      push("success", `${label}已复制`);
    } catch {
      push("error", "复制失败，请手动选择文本");
    }
  };

  const runAction = async (action: string, force?: boolean) => {
    if (!instance) return;
    setBusyAction(action);
    try {
      await api.action(instance.id, action, force);
      push("success", `${action} 任务已提交`);
      await refreshAll();
      await load();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
      setConfirmAction(null);
    }
  };

  const saveResource = async () => {
    if (!instance) return;
    const body: Record<string, number | null> = {};
    if (cpu !== "") body.cpu_cores = Number(cpu);
    if (memory !== "") body.memory_size_gb = Number(memory);
    const limitMap: Record<string, number> = {
      authenticator_conn_limit: Number(limits.authenticator_conn_limit || 0),
      auth_admin_conn_limit: Number(limits.auth_admin_conn_limit || 0),
      realtime_conn_limit: Number(limits.realtime_conn_limit || 0),
      admin_conn_limit: Number(limits.admin_conn_limit || 0),
    };
    Object.entries(limitMap).forEach(([key, value]) => {
      if (value > 0) body[key] = value;
    });
    if (!Object.keys(body).length) {
      push("error", "没有需要修改的配置");
      return;
    }
    setSavingResource(true);
    try {
      await api.modifyResource(instance.id, body);
      push("success", "资源配置修改已提交");
      await load();
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingResource(false);
    }
  };

  const statusMeta = instance ? STATUS_META[instance.status] : null;
  const modeMeta = instance ? MODE_META[instance.mode] : null;
  const canAllocate = instance && ["InCold", "Available"].includes(instance.status);
  const canStart = instance && ["InCold", "Available", "Failed"].includes(instance.status);
  const canStop = instance && ["InUse", "Available"].includes(instance.status);
  const canRestart = instance && ["InUse", "Available"].includes(instance.status);

  const detailRows = useMemo(() => {
    if (!instance) return [];
    return [
      ["实例 ID", instance.id],
      ["Supabase", instance.supabase_instance_id || "—"],
      ["底层 PG", instance.pg_instance_id || "—"],
      ["规格", instance.instance_class || "—"],
      ["地域 / 可用区", `${instance.region_id} / ${instance.detail?.cloud?.zone_id || "—"}`],
      ["VPC / VSwitch", `${instance.vpc_id || "—"} / ${instance.vswitch_id || "—"}`],
      ["绑定应用", instance.bound_app_id || "—"],
      ["应用名称", String(instance.detail?.bound_app_name || "—")],
      ["复用策略", instance.status === "InCold" && instance.detail?.reserved ? "仅原应用复用" : "可重新分配"],
      ["绑定使用者", instance.bound_user || "—"],
      ["创建时间", formatDateTime(instance.created_at)],
      ["最近检查", instance.last_checked_at ? relativeTime(instance.last_checked_at) : "—"],
    ];
  }, [instance]);

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            {instance ? instance.app_name : "实例详情"}
            {instance ? <StatusBadge status={instance.status} /> : null}
          </span>
        }
        subtitle={
          instance ? (
            <span className="flex items-center gap-2">
              <Badge className={modeMeta?.badge}>{modeMeta?.label}</Badge>
              <span className="mono">{compactId(instance.supabase_instance_id, 22)}</span>
            </span>
          ) : (
            "加载中"
          )
        }
      >
        {loading && !instance ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size={22} />
          </div>
        ) : !instance ? (
          <EmptyState title="实例不存在" description={liveError || "请刷新后重试"} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {canAllocate ? (
                <Button size="sm" variant="primary" icon={<Boxes size={13} />} onClick={() => setAllocateOpen(true)}>
                  分配
                </Button>
              ) : null}
              {canStart ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Play size={13} />}
                  loading={busyAction === "start"}
                  onClick={() => void runAction("start")}
                >
                  启动
                </Button>
              ) : null}
              {canStop ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Square size={13} />}
                  onClick={() => setConfirmAction("stop")}
                >
                  停止
                </Button>
              ) : null}
              {canRestart ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw size={13} />}
                  onClick={() => setConfirmAction("restart")}
                >
                  重启
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={13} />}
                loading={busyAction === "sync"}
                onClick={() => void runAction("sync")}
              >
                同步状态
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => setReleaseOpen(true)}>
                保留 / 删除
              </Button>
            </div>

            {liveError ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-2.5 text-[11px] text-amber">
                <AlertTriangle size={14} className="mt-0.5" />
                部分实时信息获取失败：{liveError}
              </div>
            ) : null}

            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "overview", label: "概览" },
                { value: "connection", label: "连接与密钥" },
                { value: "resource", label: "资源配置" },
                { value: "timeline", label: "时间线", count: events.length },
              ]}
            />

            {tab === "overview" ? (
              <div className="space-y-4">
                {instance.error ? (
                  <div className="rounded-lg border border-rose/30 bg-rose/[0.06] px-3 py-2.5 text-[11px] text-rose">
                    {instance.error}
                  </div>
                ) : null}
                <Card className="p-4" noCorners>
                  <div className="mb-3 flex items-center gap-2">
                    <Server size={14} className="text-cyan-400" />
                    <span className="display-title text-xs text-slate-200">实例属性</span>
                  </div>
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {detailRows.map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-start justify-between gap-3 border-b border-edge/60 py-1.5 text-[11px] last:border-0"
                      >
                        <span className="shrink-0 text-slate-500">{label}</span>
                        <span className="mono break-all text-right text-slate-300">{value}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Card className="p-4" noCorners>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="display-title text-xs text-slate-200">云端状态</span>
                      <Badge className={statusMeta?.badge}>{instance.cloud_status || "—"}</Badge>
                    </div>
                    <div className="space-y-2 text-[11px] text-slate-500">
                      <div className="flex justify-between">
                        <span>EIP</span>
                        <span className="text-slate-300">{instance.detail?.cloud?.eip_status || "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>NAT</span>
                        <span className="text-slate-300">{instance.detail?.cloud?.nat_status || "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>小版本</span>
                        <span className="mono text-slate-300">
                          {instance.detail?.cloud?.instance_minor_version || "—"}
                        </span>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-4" noCorners>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="display-title text-xs text-slate-200">组件</span>
                      <span className="text-[10px] text-slate-600">
                        {instance.detail?.components?.length ?? 0} 个模块
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(instance.detail?.components || []).length ? (
                        instance.detail?.components?.map((component, index) => (
                          <Badge
                            key={`${component.type}-${index}`}
                            className={
                              String(component.status).toLowerCase() === "enable"
                                ? "border-acid/25 bg-acid/[0.07] text-acid"
                                : "border-slate-500/25 bg-slate-500/[0.07] text-slate-400"
                            }
                          >
                            {component.type} · {component.status}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-600">暂无组件信息</span>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            ) : null}

            {tab === "connection" ? (
              <div className="space-y-4">
                <Card className="p-4" noCorners>
                  <div className="mb-3 flex items-center gap-2">
                    <Link2 size={14} className="text-cyan-400" />
                    <span className="display-title text-xs text-slate-200">连接地址</span>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: "VPC 连接串", value: instance.vpc_connection },
                      { label: "公网连接串", value: instance.public_connection },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2">
                        <div className="text-[10px] text-slate-500">{item.label}</div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="mono break-all text-[11px] text-slate-300">{item.value || "未开启"}</span>
                          {item.value ? (
                            <button
                              className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/[0.06] hover:text-cyan-300"
                              onClick={() => void copy(item.value!, item.label)}
                            >
                              <Copy size={12} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  {endpoints?.instance_endpoints?.length ? (
                    <div className="mt-4 overflow-hidden rounded-lg border border-edge">
                      <table className="w-full text-[11px]">
                        <thead className="bg-white/[0.03] text-slate-500">
                          <tr>
                            <th className="px-3 py-2 text-left font-normal">类型</th>
                            <th className="px-3 py-2 text-left font-normal">连接地址</th>
                            <th className="px-3 py-2 text-left font-normal">端口</th>
                          </tr>
                        </thead>
                        <tbody>
                          {endpoints.instance_endpoints.map((endpoint, index) => (
                            <tr key={index} className="border-t border-edge/60">
                              <td className="px-3 py-2 text-slate-400">{endpoint.ip_type || "—"}</td>
                              <td className="mono px-3 py-2 text-slate-300">{endpoint.connection_string || "—"}</td>
                              <td className="mono px-3 py-2 text-slate-400">{endpoint.port || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </Card>

                <Card className="p-4" noCorners>
                  <div className="mb-3 flex items-center gap-2">
                    <KeyRound size={14} className="text-amber" />
                    <span className="display-title text-xs text-slate-200">密钥（脱敏）</span>
                  </div>
                  {auth ? (
                    <div className="space-y-2 text-[11px]">
                      {[
                        ["JWT Secret", auth.jwt_secret],
                        ["Anon Key", auth.api_keys?.anon_key],
                        ["Service Key", auth.api_keys?.service_key],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-white/[0.02] px-3 py-2"
                        >
                          <span className="text-slate-500">{label}</span>
                          <span className="mono break-all text-right text-slate-400">{value || "—"}</span>
                        </div>
                      ))}
                      <div className="pt-2 text-[10px] leading-5 text-slate-600">
                        密钥仅展示脱敏值，完整值请通过 RDS 控制台或 OpenAPI 获取。
                      </div>
                      {auth.config_list?.length ? (
                        <div className="mt-3 space-y-1 border-t border-edge pt-3">
                          {auth.config_list.slice(0, 8).map((item) => (
                            <div key={item.name} className="flex justify-between gap-3">
                              <span className="mono text-slate-500">{item.name}</span>
                              <span className="mono truncate text-slate-400">{item.value}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-600">暂无认证信息</div>
                  )}
                </Card>

                <Card className="p-4" noCorners>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database size={14} className="text-violet" />
                      <span className="display-title text-xs text-slate-200">数据库占用</span>
                    </div>
                    <span className="mono text-sm text-slate-200">
                      {size ? formatBytes(size.database_size_bytes) : "—"}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    {size ? `数据库 ${size.database_name} · ${size.database_size_human}` : "仅统计当前租户数据空间"}
                  </div>
                </Card>
              </div>
            ) : null}

            {tab === "resource" ? (
              <div className="space-y-4">
                <Card className="p-4" noCorners>
                  <div className="mb-3 flex items-center gap-2">
                    <Cpu size={14} className="text-cyan-400" />
                    <span className="display-title text-xs text-slate-200">当前配置</span>
                  </div>
                  {resource ? (
                    <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                      <Metric label="CPU" value={`${resource.cpu_cores} 核`} />
                      <Metric label="内存" value={`${resource.memory_size_gb} GB`} />
                      <Metric label="共享模式" value={resource.share_mode ? "是" : "否"} />
                      <Metric label="状态" value={resource.status || "—"} />
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-600">暂无资源配置信息</div>
                  )}
                  {resource?.share_mode ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                      <Metric label="PostgREST 连接" value={String(resource.authenticator_conn_limit ?? "—")} />
                      <Metric label="Auth 连接" value={String(resource.auth_admin_conn_limit ?? "—")} />
                      <Metric label="Realtime 连接" value={String(resource.realtime_conn_limit ?? "—")} />
                      <Metric label="管理面连接" value={String(resource.admin_conn_limit ?? "—")} />
                    </div>
                  ) : null}
                </Card>

                <Card className="p-4" noCorners>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="display-title text-xs text-slate-200">修改配置</span>
                    <span className="text-[10px] text-slate-600">CPU 变配会触发实例重建</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="CPU 核数" hint="2 / 4 / 8">
                      <Select
                        value={String(cpu)}
                        onChange={(event) => setCpu(event.target.value ? Number(event.target.value) : "")}
                      >
                        <option value="">不修改</option>
                        {[2, 4, 8].map((value) => (
                          <option key={value} value={value}>
                            {value} 核
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="内存 (GB)" hint="CPU ~ CPU×4；留空按标准配比">
                      <Input
                        type="number"
                        value={memory}
                        onChange={(event) => setMemory(event.target.value === "" ? "" : Number(event.target.value))}
                        placeholder="例如 16"
                      />
                    </Field>
                    {resource?.share_mode ? (
                      <>
                        <Field label="PostgREST 连接数">
                          <Input
                            type="number"
                            min={2}
                            max={16}
                            value={limits.authenticator_conn_limit}
                            onChange={(event) =>
                              setLimits((prev) => ({ ...prev, authenticator_conn_limit: event.target.value }))
                            }
                          />
                        </Field>
                        <Field label="Auth 连接数">
                          <Input
                            type="number"
                            min={2}
                            max={16}
                            value={limits.auth_admin_conn_limit}
                            onChange={(event) =>
                              setLimits((prev) => ({ ...prev, auth_admin_conn_limit: event.target.value }))
                            }
                          />
                        </Field>
                        <Field label="Realtime 连接数">
                          <Input
                            type="number"
                            min={2}
                            max={16}
                            value={limits.realtime_conn_limit}
                            onChange={(event) =>
                              setLimits((prev) => ({ ...prev, realtime_conn_limit: event.target.value }))
                            }
                          />
                        </Field>
                        <Field label="管理面连接数" hint="5~16">
                          <Input
                            type="number"
                            min={5}
                            max={16}
                            value={limits.admin_conn_limit}
                            onChange={(event) =>
                              setLimits((prev) => ({ ...prev, admin_conn_limit: event.target.value }))
                            }
                          />
                        </Field>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button size="sm" variant="primary" loading={savingResource} onClick={() => void saveResource()}>
                      提交修改
                    </Button>
                  </div>
                </Card>
              </div>
            ) : null}

            {tab === "timeline" ? (
              <div className="space-y-1">
                {events.length ? (
                  events.map((event, index) => (
                    <div key={event.id} className="relative flex gap-3 pb-4 pl-1">
                      <div className="relative flex w-4 shrink-0 justify-center">
                        <span
                          className={cx("mt-1 h-2 w-2 rounded-full", EVENT_TONES[event.action] || "bg-slate-500")}
                        />
                        {index < events.length - 1 ? <span className="absolute top-4 h-full w-px bg-edge" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-slate-300">{event.message}</span>
                          <span className="flex items-center gap-1 text-[10px] text-slate-600">
                            <Clock3 size={10} />
                            {formatDateTime(event.created_at)}
                          </span>
                        </div>
                        <div className="mono mt-0.5 text-[10px] text-slate-600">{event.action}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="暂无操作记录" description="实例的操作会记录在这里" />
                )}
              </div>
            ) : null}
          </div>
        )}
      </Drawer>

      <AllocateModal instance={instance} open={allocateOpen} onClose={() => setAllocateOpen(false)} />
      <ReleaseDialog instance={instance} open={releaseOpen} onClose={() => setReleaseOpen(false)} />
      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={confirmAction === "stop" ? "停止实例" : "重启实例"}
        description={
          confirmAction === "stop"
            ? "停止后实例会进入冷池并保留给当前应用复用，其他应用不能分配。若为多租共享模式，不会影响共享 PG 和其他租户。"
            : "重启会短暂中断服务，请在业务低峰期执行。"
        }
        confirmLabel={confirmAction === "stop" ? "确认停止" : "确认重启"}
        variant={confirmAction === "stop" ? "danger" : "primary"}
        loading={busyAction === confirmAction}
        onConfirm={() => {
          if (confirmAction) void runAction(confirmAction);
        }}
      />
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mono mt-1 text-sm text-slate-200">{value}</div>
    </div>
  );
}

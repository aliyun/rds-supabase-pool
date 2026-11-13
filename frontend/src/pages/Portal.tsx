import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Boxes,
  Copy,
  Database,
  Globe2,
  KeyRound,
  Plus,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { api, API_BASE } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cx, formatDateTime, MODE_META, relativeTime } from "../lib/format";
import type {
  AuthInfo,
  EndpointsInfo,
  PlatformToken,
  PortalInstance,
  PortalOverview,
  PortalRegion,
} from "../lib/types";
import { PoolMark } from "../components/Layout";
import { UserMenu } from "../components/UserMenu";
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
  useToast,
} from "../components/ui";

export function PortalApp() {
  const { user } = useAuth();
  const [data, setData] = useState<PortalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyRegion, setApplyRegion] = useState<string>("");
  const [applyMode, setApplyMode] = useState<"single" | "shared">("shared");
  const [applyAppName, setApplyAppName] = useState("");
  const [connectionTarget, setConnectionTarget] = useState<PortalInstance | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<PortalInstance | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const { push } = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api.portalOverview());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const regions = data?.regions ?? [];
  const instances = data?.instances ?? [];
  const availableTotal = useMemo(() => regions.reduce((sum, item) => sum + item.available, 0), [regions]);

  const openApply = (region?: PortalRegion, mode?: "single" | "shared") => {
    const targetRegion = region || regions.find((item) => item.available > 0) || regions[0] || null;
    const targetPool =
      targetRegion?.pools.find((item) => (mode ? item.mode === mode : item.available > 0)) ||
      targetRegion?.pools[0] ||
      null;
    setApplyRegion(targetRegion?.region_id || "");
    setApplyMode(targetPool?.mode || mode || "shared");
    setApplyAppName("");
    setApplyOpen(true);
  };

  const openReuse = (instance: PortalInstance) => {
    setApplyRegion(instance.region_id);
    setApplyMode(instance.mode);
    setApplyAppName(instance.reserved_app_name || instance.app_name);
    setApplyOpen(true);
  };

  if (loading && !data) {
    return (
      <PortalShell>
        <div className="flex items-center justify-center py-32">
          <Spinner size={24} />
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label-eyebrow">SUPABASE RESOURCE PORTAL</div>
            <h1 className="display-title mt-1 text-3xl font-semibold text-white">我的资源门户</h1>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-slate-400">
              {user?.display_name || user?.username}，从这里选择地域申请 Supabase
              实例，用于你自己的应用项目。资源规格由管理员统一配置。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
              onClick={() => void load()}
            >
              刷新
            </Button>
            <Button variant="secondary" icon={<KeyRound size={14} />} onClick={() => setTokensOpen(true)}>
              API Token
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => openApply()}>
              申请实例
            </Button>
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PortalStat
            label="我的应用"
            value={`${instances.length}`}
            sub="当前账号绑定"
            icon={<Boxes size={16} />}
            tone="cyan"
          />
          <PortalStat
            label="使用中"
            value={`${data?.active_count ?? 0}`}
            sub="正在运行"
            icon={<Rocket size={16} />}
            tone="acid"
          />
          <PortalStat
            label="可用地域"
            value={`${regions.length}`}
            sub="管理员已开放"
            icon={<Globe2 size={16} />}
            tone="violet"
          />
          <PortalStat
            label="冷池可申请"
            value={`${availableTotal}`}
            sub="未保留实例"
            icon={<Snowflake size={16} />}
            tone="sky"
          />
        </div>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Globe2 size={15} className="text-cyan-400" />
              <span className="display-title text-sm text-slate-200">可申请地域</span>
              <span className="text-[10px] text-slate-500">管理员按地域开放，可在单租户池与共享池之间选择</span>
            </div>
            <span className="text-[10px] text-slate-500">
              最后更新 {data?.fetched_at ? relativeTime(data.fetched_at) : "—"}
            </span>
          </div>
          {regions.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {regions.map((region) => (
                <div key={region.region_id} className="rounded-xl border border-edge bg-white/[0.02] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="display-title text-sm text-white">{region.name}</div>
                      <div className="mono mt-0.5 text-[10px] text-slate-600">{region.region_id}</div>
                    </div>
                    <Badge className="border-edge bg-white/[0.03] text-slate-400">
                      {region.pools.length > 1 ? "可选两种池" : "单一池模式"}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {region.pools.map((pool) => (
                      <div
                        key={pool.mode}
                        className={cx(
                          "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2",
                          pool.mode === "single"
                            ? "border-cyan/20 bg-cyan/[0.03]"
                            : "border-violet/20 bg-violet/[0.03]",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Badge className={MODE_META[pool.mode].badge}>{pool.mode_label}</Badge>
                            <span className="text-[10px] text-slate-500">
                              可申请{" "}
                              <span className={pool.available ? "text-acid" : "text-slate-500"}>{pool.available}</span>
                            </span>
                          </div>
                          <div className="mt-1 truncate text-[10px] text-slate-500">
                            {pool.pool_name} · 使用中 {pool.in_use} · 目标 {pool.target}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={pool.available ? "primary" : "secondary"}
                          icon={<ArrowRight size={12} />}
                          onClick={() => openApply(region, pool.mode)}
                        >
                          申请
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600">
                    <span>目标水位合计 {region.target}</span>
                    <span>
                      可申请合计 <span className="mono text-slate-400">{region.available}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Globe2 size={24} />}
              title="暂无开放地域"
              description="管理员开放地域门户并预热冷池后，你可以在这里申请实例。"
            />
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <div className="flex items-center gap-2">
              <Database size={15} className="text-cyan-400" />
              <span className="display-title text-sm text-slate-200">我的应用</span>
              <span className="text-[10px] text-slate-500">{instances.length} 个实例</span>
            </div>
            <span className="text-[10px] text-slate-500">归还后实例只保留给同名应用复用，删除请联系管理员</span>
          </div>
          {instances.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-normal">应用</th>
                    <th className="px-3 py-2.5 font-normal">地域 / 池</th>
                    <th className="px-3 py-2.5 font-normal">状态</th>
                    <th className="px-3 py-2.5 font-normal">Supabase 实例</th>
                    <th className="px-3 py-2.5 font-normal">创建时间</th>
                    <th className="px-3 py-2.5 text-right font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((instance) => (
                    <tr key={instance.id} className="border-t border-edge/60">
                      <td className="px-4 py-3">
                        <div className="text-[12px] text-slate-200">{instance.app_name}</div>
                        <div className="mono text-[10px] text-slate-600">{instance.bound_app_id || instance.id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-[11px] text-slate-300">{instance.region_name}</div>
                        <div className="text-[10px] text-slate-600">{instance.pool_name}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={instance.status} />
                          {instance.reserved ? (
                            <Badge className="border-amber/25 bg-amber/[0.07] text-amber">
                              保留给 {instance.reserved_app_name || instance.app_name}
                            </Badge>
                          ) : null}
                        </div>
                        {instance.error ? (
                          <div className="mt-1 max-w-[230px] truncate text-[10px] text-rose">{instance.error}</div>
                        ) : null}
                      </td>
                      <td className="mono px-3 py-3 text-[10px] text-slate-500">
                        {instance.supabase_instance_id || "创建中"}
                      </td>
                      <td className="px-3 py-3 text-[10px] text-slate-500">{formatDateTime(instance.created_at)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {instance.status === "InUse" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<KeyRound size={12} />}
                              onClick={() => setConnectionTarget(instance)}
                            >
                              连接信息
                            </Button>
                          ) : null}
                          {instance.status === "InUse" ? (
                            <Button size="sm" variant="ghost" onClick={() => setReleaseTarget(instance)}>
                              归还
                            </Button>
                          ) : null}
                          {instance.status === "InCold" && instance.reserved ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<Sparkles size={12} />}
                              onClick={() => openReuse(instance)}
                            >
                              再次使用
                            </Button>
                          ) : null}
                          {instance.status === "InCold" && !instance.reserved ? (
                            <span className="text-[10px] text-slate-600">等待管理员分配</span>
                          ) : null}
                          {instance.status === "Failed" ? (
                            <span className="text-[10px] text-rose">请联系管理员</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Boxes size={26} />}
              title="还没有应用实例"
              description="从上方地域卡片申请一个实例，或联系管理员为你预热资源。"
              action={
                <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => openApply()}>
                  申请实例
                </Button>
              }
            />
          )}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan/25 bg-cyan/[0.06] text-cyan-300">
                <Terminal size={17} />
              </span>
              <div>
                <div className="display-title text-sm text-slate-200">开发接入：API 与 CLI</div>
                <div className="mt-1 text-[11px] leading-5 text-slate-500">
                  使用 API Token 从 CI/CD、脚本或其他应用管理自己的资源。申请和归还是异步任务，CLI 支持等待完成。
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<KeyRound size={13} />} onClick={() => setTokensOpen(true)}>
                管理 Token
              </Button>
              <Button size="sm" variant="primary" icon={<Terminal size={13} />} onClick={() => setDocsOpen(true)}>
                查看使用说明
              </Button>
            </div>
          </div>
        </Card>

        <div className="rounded-xl border border-edge bg-white/[0.02] px-4 py-3 text-[10px] leading-6 text-slate-500">
          <span className="text-slate-400">权限说明：</span>{" "}
          你只能看到并操作自己申请的实例；实例规格由管理员配置，使用者不可修改。归还实例会停止运行并保留数据给同名应用下次使用；删除实例需要联系管理员，使用者没有删除权限。
        </div>
      </div>

      <ApplyModal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        regions={regions}
        initialRegion={applyRegion}
        initialMode={applyMode}
        initialAppName={applyAppName}
        onApplied={() => {
          setApplyOpen(false);
          void load();
        }}
      />
      {connectionTarget ? (
        <ConnectionModal instance={connectionTarget} onClose={() => setConnectionTarget(null)} />
      ) : null}
      <TokenModal open={tokensOpen} onClose={() => setTokensOpen(false)} />
      <DeveloperDocsModal
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        onOpenTokens={() => {
          setDocsOpen(false);
          setTokensOpen(true);
        }}
      />
      <ReleaseModal
        instance={releaseTarget}
        onClose={() => setReleaseTarget(null)}
        onReleased={() => {
          setReleaseTarget(null);
          push("success", "归还任务已提交，实例将保留给同名应用复用");
          void load();
        }}
      />
    </PortalShell>
  );
}

function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-edge bg-ink-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <PoolMark />
            <div>
              <div className="display-title text-[15px] font-semibold tracking-wide text-white">RESOURCE PORTAL</div>
              <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">RDS Supabase · 使用者门户</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border-violet/25 bg-violet/[0.07] text-violet">使用者</Badge>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 lg:px-8">{children}</main>
      <footer className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-4 text-[10px] text-slate-600 lg:px-8">
        <span>RDS Supabase Resource Portal</span>
        <span className="mono">self-service · no cloud credentials</span>
      </footer>
    </div>
  );
}

function PortalStat({
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
  tone: "cyan" | "acid" | "violet" | "sky";
}) {
  const tones = {
    cyan: "border-cyan/20 bg-cyan/[0.05] text-cyan-300",
    acid: "border-acid/20 bg-acid/[0.05] text-acid",
    violet: "border-violet/20 bg-violet/[0.05] text-violet",
    sky: "border-sky-400/20 bg-sky-400/[0.05] text-sky-300",
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

function MiniMetric({ label, value, tone }: { label: string; value: number; tone: "acid" | "cyan" | "slate" }) {
  const toneClass = { acid: "text-acid", cyan: "text-cyan-300", slate: "text-slate-300" }[tone];
  return (
    <div className="rounded-lg border border-edge bg-white/[0.02] px-2 py-1.5">
      <div className="text-[9px] text-slate-500">{label}</div>
      <div className={cx("mono mt-0.5 text-sm", toneClass)}>{value}</div>
    </div>
  );
}

function ApplyModal({
  open,
  onClose,
  regions,
  initialRegion,
  initialMode,
  initialAppName,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  regions: PortalRegion[];
  initialRegion: string;
  initialMode: "single" | "shared";
  initialAppName: string;
  onApplied: () => void;
}) {
  const { push } = useToast();
  const [regionId, setRegionId] = useState(initialRegion);
  const [mode, setMode] = useState<"single" | "shared">(initialMode);
  const [appName, setAppName] = useState(initialAppName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const region =
      regions.find((item) => item.region_id === initialRegion) ||
      regions.find((item) => item.available > 0) ||
      regions[0] ||
      null;
    const pool =
      region?.pools.find((item) => item.mode === initialMode && item.available > 0) ||
      region?.pools.find((item) => item.available > 0) ||
      region?.pools[0] ||
      null;
    setRegionId(region?.region_id || "");
    setMode(pool?.mode || initialMode);
    setAppName(initialAppName);
    setError(null);
    // 轮询更新 regions 时不要重置用户正在填写的表单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRegion, initialMode, initialAppName]);

  const selectedRegion = regions.find((item) => item.region_id === regionId);
  const selectedPool = selectedRegion?.pools.find((item) => item.mode === mode) || selectedRegion?.pools[0] || null;

  const changeRegion = (next: string) => {
    setRegionId(next);
    const region = regions.find((item) => item.region_id === next);
    const pool = region?.pools.find((item) => item.available > 0) || region?.pools[0];
    setMode(pool?.mode || "shared");
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.portalApply({ region_id: regionId, app_name: appName.trim(), mode });
      push("success", "申请已提交，实例正在唤醒");
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initialAppName ? "再次使用应用" : "申请 Supabase 实例"}
      subtitle="使用者不能选择规格；可在地域内选择单租户池或多租共享池"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            icon={<Rocket size={14} />}
            loading={submitting}
            disabled={!regionId || !mode || !appName.trim()}
            onClick={() => void submit()}
          >
            提交申请
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="目标地域">
          <Select value={regionId} onChange={(event) => changeRegion(event.target.value)}>
            {regions.map((region) => (
              <option key={region.region_id} value={region.region_id}>
                {region.name} · 可申请 {region.available}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="资源池模式" hint={selectedRegion?.pools.length === 1 ? "管理员仅开放了该模式" : "由使用者选择"}>
          <Select value={mode} onChange={(event) => setMode(event.target.value as "single" | "shared")}>
            {(selectedRegion?.pools ?? []).map((pool) => (
              <option key={pool.mode} value={pool.mode}>
                {pool.mode_label} · 可申请 {pool.available}
              </option>
            ))}
          </Select>
        </Field>
        {selectedPool ? (
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-edge bg-white/[0.02] p-3">
            <MiniMetric label="目标水位" value={selectedPool.target} tone="slate" />
            <MiniMetric
              label="可申请冷池"
              value={selectedPool.available}
              tone={selectedPool.available ? "acid" : "slate"}
            />
            <MiniMetric label="当前使用中" value={selectedPool.in_use} tone="cyan" />
          </div>
        ) : null}
        <Field label="应用名称" hint="同名应用会优先唤醒保留实例">
          <Input
            value={appName}
            onChange={(event) => setAppName(event.target.value)}
            placeholder="例如：vibe-app-orders"
            maxLength={60}
            autoFocus
          />
        </Field>
        <div className="rounded-lg border border-cyan/20 bg-cyan/[0.04] px-3 py-2.5 text-[11px] leading-5 text-slate-400">
          申请成功后实例会从冷池唤醒并绑定该应用。归还后实例保留给同名应用再次使用；使用者没有删除权限。
        </div>
        {selectedPool && selectedPool.available === 0 ? (
          <div className="rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2.5 text-[11px] leading-5 text-amber">
            该模式下冷池暂无可申请实例。如果这是你之前归还的应用，提交同名申请仍会尝试唤醒保留实例；否则请联系管理员预热。
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function DeveloperDocsModal({
  open,
  onClose,
  onOpenTokens,
}: {
  open: boolean;
  onClose: () => void;
  onOpenTokens: () => void;
}) {
  const { push } = useToast();
  const [tab, setTab] = useState<"api" | "cli">("api");
  const origin = window.location.origin;
  const apiRoot = `${origin}${API_BASE}`;
  const copy = (label: string, value: string) => {
    navigator.clipboard
      .writeText(value)
      .then(() => push("success", `${label} 已复制`))
      .catch(() => push("error", "复制失败，请手动选择文本"));
  };

  const apiEndpoints = [
    ["GET", "/api/v1/portal/overview", "instances:read", "获取可用地域、池模式和我的实例"],
    ["POST", "/api/v1/portal/instances/apply", "instances:apply", "申请实例，返回 task_id"],
    ["GET", "/api/v1/portal/tasks/{task_id}", "instances:read", "查询申请/归还任务进度"],
    ["GET", "/api/v1/portal/instances/{instance_id}", "instances:read", "查看单个实例"],
    ["GET", "/api/v1/portal/instances/{instance_id}/endpoints", "credentials:read", "获取连接地址"],
    ["GET", "/api/v1/portal/instances/{instance_id}/auth-info", "credentials:read", "获取 API 密钥"],
    ["POST", "/api/v1/portal/instances/{instance_id}/release", "instances:release", "归还实例（不可删除）"],
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="API 与 CLI 使用说明"
      subtitle="使用个人 API Token 接入资源门户；管理端接口与云凭证不会暴露给使用者"
      width="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge bg-white/[0.02] px-4 py-3">
          <div>
            <div className="text-[10px] text-slate-500">API Base URL</div>
            <div className="mono mt-0.5 text-[11px] text-cyan-300">{apiRoot}/v1/portal</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy size={12} />}
              onClick={() => copy("Base URL", `${apiRoot}/v1/portal`)}
            >
              复制
            </Button>
            <Button size="sm" variant="secondary" icon={<KeyRound size={12} />} onClick={onOpenTokens}>
              管理 Token
            </Button>
          </div>
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "api", label: "REST API" },
            { value: "cli", label: "poolctl CLI" },
          ]}
        />

        {tab === "api" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-cyan/20 bg-cyan/[0.04] px-3 py-2.5 text-[11px] leading-5 text-slate-400">
              在门户创建 API Token 后，把它放在请求头：
              <span className="mono text-cyan-300">
                Authorization: Bearer pctl_...
              </span>。申请和归还是异步的，需要轮询 <span className="mono">task_id</span>。
            </div>
            <CodeBlock
              label="curl 示例"
              onCopy={(value) => copy("curl 示例", value)}
              code={`TOKEN=pctl_xxx
BASE=${apiRoot}

# 查看地域、可申请池模式和我的实例
curl -s "$BASE/v1/portal/overview" \\
  -H "Authorization: Bearer $TOKEN"

# 申请一个共享池实例
curl -s -X POST "$BASE/v1/portal/instances/apply" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"region_id":"cn-chengdu","mode":"shared","app_name":"my-app"}'

# 用返回的 task_id 查询进度
curl -s "$BASE/v1/portal/tasks/<task_id>" \\
  -H "Authorization: Bearer $TOKEN"`}
            />
            <div className="overflow-hidden rounded-lg border border-edge">
              <div className="grid grid-cols-[60px_1fr_130px] gap-2 bg-white/[0.03] px-3 py-2 text-[9px] uppercase tracking-wider text-slate-500">
                <span>Method</span>
                <span>Path</span>
                <span>Scope</span>
              </div>
              {apiEndpoints.map(([method, path, scope, description]) => (
                <div
                  key={`${method}-${path}`}
                  className="grid grid-cols-[60px_1fr_130px] gap-2 border-t border-edge/60 px-3 py-2 text-[10px]"
                >
                  <span className={method === "GET" ? "text-cyan-300" : "text-acid"}>{method}</span>
                  <span className="mono break-all text-slate-300">{path}</span>
                  <span className="mono break-all text-slate-500">{scope}</span>
                  <div className="col-span-3 -mt-1 text-[9px] text-slate-600">{description}</div>
                </div>
              ))}
            </div>
            <div className="text-[10px] leading-5 text-slate-500">
              使用者 API 没有删除接口；归还后实例保留给同名应用复用。连接密钥需要 `credentials:read`
              scope，默认不要写入日志。
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <CodeBlock
              label="安装并登录"
              onCopy={(value) => copy("安装命令", value)}
              code={`# 在项目根目录安装 CLI
python3 -m pip install -e cli

# Token 在门户「API Token」中创建
poolctl login --url ${apiRoot} --token pctl_xxx`}
            />
            <CodeBlock
              label="常用命令"
              onCopy={(value) => copy("CLI 命令", value)}
              code={`poolctl regions
poolctl apps
poolctl apply --region cn-chengdu --mode shared --app my-app --wait
poolctl get my-app
poolctl connect my-app --env
poolctl connect my-app --env --show-secrets
poolctl release my-app --yes --wait
poolctl apps --json`}
            />
            <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-3 text-[10px] leading-5 text-slate-500">
              <div>
                Token 默认保存在 <span className="mono">~/.config/poolctl/config.json</span>（0600），也可以用{" "}
                <span className="mono">POOLCTL_URL</span> 和 <span className="mono">POOLCTL_TOKEN</span> 环境变量覆盖。
              </div>
              <div className="mt-1">
                <span className="mono text-slate-400">connect</span> 默认不输出 Service Key；需要时显式加{" "}
                <span className="mono">--show-secrets</span>。
              </div>
              <div className="mt-1">Token 撤销或账号停用后，CLI 会立即收到 401。</div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CodeBlock({ label, code, onCopy }: { label: string; code: string; onCopy: (value: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-ink-950">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-[10px] text-slate-500">{label}</span>
        <button
          onClick={() => onCopy(code)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-300"
        >
          <Copy size={11} /> 复制
        </button>
      </div>
      <pre className="mono overflow-x-auto px-3 py-3 text-[10px] leading-5 text-slate-300">{code}</pre>
    </div>
  );
}

function TokenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToast();
  const [tokens, setTokens] = useState<PlatformToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("CLI Token");
  const [days, setDays] = useState(30);
  const [scopes, setScopes] = useState<string[]>([
    "instances:read",
    "instances:apply",
    "instances:release",
    "credentials:read",
  ]);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.portalTokens();
      setTokens(data.tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setNewToken(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleScope = (scope: string) => {
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));
  };

  const create = async () => {
    if (!scopes.length) {
      setError("至少选择一个权限");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await api.createPortalToken({ name: name.trim() || "CLI Token", scopes, expires_in_days: days });
      setNewToken(result.token);
      push("success", "API Token 已创建，请立即复制保存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (token: PlatformToken) => {
    if (!window.confirm(`确认撤销 Token ${token.name}？撤销后使用该 Token 的 CLI 会立即失效。`)) return;
    try {
      await api.revokePortalToken(token.id);
      push("success", "Token 已撤销");
      await load();
    } catch (err) {
      push("error", err instanceof Error ? err.message : String(err));
    }
  };

  const scopeLabels: Record<string, string> = {
    "instances:read": "查看实例",
    "instances:apply": "申请实例",
    "instances:release": "归还实例",
    "credentials:read": "读取连接密钥",
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="API Token"
      subtitle="供 CLI / CI 使用的平台访问令牌；Token 只在创建时显示一次"
      width="max-w-2xl"
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-edge bg-white/[0.02] p-4">
          <div className="display-title text-sm text-slate-200">创建新 Token</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="名称">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：my-app-ci" />
            </Field>
            <Field label="有效期">
              <Select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                <option value={7}>7 天</option>
                <option value={30}>30 天</option>
                <option value={90}>90 天</option>
                <option value={365}>365 天</option>
                <option value={0}>永久</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3">
            <div className="mb-2 text-[10px] text-slate-500">权限范围</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(scopeLabels).map(([scope, label]) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-edge bg-white/[0.02] px-3 py-2 text-[11px] text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="accent-cyan-400"
                  />
                  <span>{label}</span>
                  <span className="mono ml-auto text-[9px] text-slate-600">{scope}</span>
                </label>
              ))}
            </div>
          </div>
          {days === 0 ? (
            <div className="mt-3 rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2.5 text-[10px] leading-5 text-amber">
              永久 Token 不会自动失效，请仅在受控的 CI 或自动化环境中使用，并定期轮换或撤销。
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">Token 哈希保存，服务端无法再次查看明文。</span>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={12} />}
              loading={creating}
              disabled={!scopes.length}
              onClick={() => void create()}
            >
              创建 Token
            </Button>
          </div>
        </div>

        {newToken ? (
          <div className="rounded-xl border border-acid/30 bg-acid/[0.05] p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] text-acid">Token 已创建，请立即复制</div>
                <div className="mt-0.5 text-[10px] text-slate-500">关闭弹窗后无法再次查看完整 Token。</div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy size={12} />}
                onClick={() => void navigator.clipboard.writeText(newToken).then(() => push("success", "Token 已复制"))}
              >
                复制
              </Button>
            </div>
            <div className="mono mt-3 break-all rounded-lg border border-edge bg-ink-950 px-3 py-2 text-[10px] text-slate-200">
              {newToken}
            </div>
            <div className="mt-3 text-[10px] leading-5 text-slate-500">
              安装 CLI 后执行：
              <div className="mono mt-1 text-slate-300">
                pip install -e ./cli
                <br />
                poolctl login --url {`${window.location.origin}${API_BASE}`} --token &lt;上面的 Token&gt;
              </div>
            </div>
          </div>
        ) : null}

        <div>
          <div className="flex items-center justify-between">
            <div className="display-title text-sm text-slate-200">我的 Token</div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} className={loading ? "animate-spin" : ""} />}
              onClick={() => void load()}
            >
              刷新
            </Button>
          </div>
          {error ? (
            <div className="mt-2 rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
              {error}
            </div>
          ) : null}
          <div className="mt-3 space-y-2">
            {tokens.length ? (
              tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-200">{token.name}</span>
                      {token.revoked ? <Badge className="border-rose/25 bg-rose/[0.07] text-rose">已撤销</Badge> : null}
                    </div>
                    <div className="mono mt-0.5 text-[10px] text-slate-500">pctl_{token.prefix}_••••••</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[9px] text-slate-600">
                      <span>创建 {formatDateTime(token.created_at)}</span>
                      <span>到期 {token.expires_at ? formatDateTime(token.expires_at) : "永久"}</span>
                      <span>最近使用 {token.last_used_at ? relativeTime(token.last_used_at) : "未使用"}</span>
                      <span>{token.scopes.map((scope) => scopeLabels[scope] || scope).join(" / ")}</span>
                    </div>
                  </div>
                  {!token.revoked ? (
                    <Button size="sm" variant="ghost" onClick={() => void revoke(token)}>
                      撤销
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-edge px-3 py-5 text-center text-[11px] text-slate-500">
                还没有 API Token
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5 text-[10px] leading-5 text-slate-500">
          CLI 示例：<span className="mono text-slate-400">poolctl regions</span> ·{" "}
          <span className="mono text-slate-400">
            poolctl apply --region cn-chengdu --mode shared --app my-app --wait
          </span>{" "}
          · <span className="mono text-slate-400">poolctl connect my-app --env</span>
        </div>
      </div>
    </Modal>
  );
}

function ReleaseModal({
  instance,
  onClose,
  onReleased,
}: {
  instance: PortalInstance | null;
  onClose: () => void;
  onReleased: () => void;
}) {
  const { push } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!instance) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.portalRelease(instance.id);
      onReleased();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      push("error", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={instance !== null}
      onClose={onClose}
      title="归还实例"
      subtitle={instance ? `${instance.app_name} · ${instance.supabase_instance_id || instance.id}` : ""}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={submitting} onClick={() => void submit()}>
            确认归还
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-amber/25 bg-amber/[0.06] px-4 py-3 text-[11px] leading-6 text-amber">
          归还后实例会停止运行，但数据和资源保留给同名应用下次使用。其他应用无法分配该实例。
        </div>
        <div className="text-[11px] leading-6 text-slate-500">
          只有管理员可以删除实例。如果你需要彻底释放资源，请联系管理员处理。
        </div>
        {error ? (
          <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ConnectionModal({ instance, onClose }: { instance: PortalInstance; onClose: () => void }) {
  const { push } = useToast();
  const [endpoints, setEndpoints] = useState<EndpointsInfo | null>(null);
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [endpointData, authData] = await Promise.all([
          api.portalEndpoints(instance.id),
          api.portalAuthInfo(instance.id),
        ]);
        if (!cancelled) {
          setEndpoints(endpointData);
          setAuth(authData);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instance.id]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      push("success", `${label} 已复制`);
    } catch {
      push("error", "复制失败，请手动选择文本");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="连接信息"
      subtitle={`${instance.app_name} · ${instance.region_name}`}
      width="max-w-2xl"
    >
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size={22} />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">{error}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck size={14} className="text-acid" />
            这是你的应用专属连接信息，请勿分享给其他使用者。
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-300">
              <Server size={13} className="text-cyan-400" /> 连接地址
            </div>
            <div className="space-y-2">
              {(endpoints?.instance_endpoints ?? []).map((item) => (
                <div
                  key={`${item.ip_type}-${item.connection_string}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-500">
                      {item.ip_type || "连接地址"} · 端口 {item.port || "—"}
                    </div>
                    <div className="mono mt-0.5 truncate text-[11px] text-slate-200">{item.connection_string}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={12} />}
                    onClick={() => void copy("连接地址", item.connection_string)}
                  >
                    复制
                  </Button>
                </div>
              ))}
              {!endpoints?.instance_endpoints?.length ? (
                <div className="text-[11px] text-slate-500">暂无连接地址</div>
              ) : null}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-300">
              <KeyRound size={13} className="text-acid" /> API 密钥
            </div>
            <div className="space-y-2">
              {[
                ["Anon Key", auth?.api_keys?.anon_key || ""],
                ["Service Key", auth?.api_keys?.service_key || ""],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] text-slate-500">{label}</div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy size={12} />}
                      disabled={!value}
                      onClick={() => void copy(label, value)}
                    >
                      复制
                    </Button>
                  </div>
                  <div className="mono mt-1 break-all text-[10px] text-slate-300">{value || "—"}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[10px] leading-5 text-slate-500">Service Key 拥有较高权限，请只在服务端使用。</div>
        </div>
      )}
    </Modal>
  );
}

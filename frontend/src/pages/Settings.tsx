import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Database,
  Globe2,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Terminal,
  Wifi,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { cx, formatDateTime, relativeTime } from "../lib/format";
import { useAppData } from "../lib/store";
import type { CheckResult, MetadataStatus, PgInstance, PreflightResult, SetupJob, VSwitch, Vpc } from "../lib/types";
import { Badge, Button, Card, Field, Input, Progress, Select, StatusBadge, Tabs, useToast } from "../components/ui";

type MetadataTab = "existing" | "manual" | "create";

export function SettingsPage() {
  const { overview, refreshAll, refreshing, lastUpdated } = useAppData();
  const { push } = useToast();
  const initialized = useRef(false);
  const settings = overview?.settings;

  const [region, setRegion] = useState("cn-beijing");
  const [vpcId, setVpcId] = useState("");
  const [vswitchId, setVswitchId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [changingMode, setChangingMode] = useState<string | null>(null);

  const [vpcs, setVpcs] = useState<Vpc[]>([]);
  const [vswitches, setVswitches] = useState<VSwitch[]>([]);
  const [pgs, setPgs] = useState<PgInstance[]>([]);
  const [loadingNetwork, setLoadingNetwork] = useState(false);
  const [loadingPgs, setLoadingPgs] = useState(false);

  const [metadataTab, setMetadataTab] = useState<MetadataTab>("existing");
  const [selectedPg, setSelectedPg] = useState<PgInstance | null>(null);
  const [pgNet, setPgNet] = useState<Record<string, unknown> | null>(null);
  const [metaUser, setMetaUser] = useState("postgres");
  const [metaPassword, setMetaPassword] = useState("");
  const [metaDatabase, setMetaDatabase] = useState("rds_pool_console");
  const [metaSsl, setMetaSsl] = useState("require");
  const [metaHost, setMetaHost] = useState("");
  const [metaPort, setMetaPort] = useState(5432);
  const [clientIp, setClientIp] = useState("");
  const [detectingIp, setDetectingIp] = useState(false);
  const [testingMeta, setTestingMeta] = useState(false);
  const [configuringMeta, setConfiguringMeta] = useState(false);
  const [autoJob, setAutoJob] = useState<SetupJob | null>(null);
  const [creatingMeta, setCreatingMeta] = useState(false);

  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [selfhealLoading, setSelfhealLoading] = useState(false);

  const metadata: MetadataStatus | undefined = overview?.database;

  useEffect(() => {
    if (initialized.current || !settings) return;
    initialized.current = true;
    setRegion(settings.region_id || "cn-beijing");
    setVpcId(settings.vpc_id || "");
    setVswitchId(settings.vswitch_id || "");
    setZoneId(settings.zone_id || "");
    setMetaHost(settings.metadata_pg?.host || "");
    setMetaPort(settings.metadata_pg?.port || 5432);
    setMetaDatabase(settings.metadata_pg?.database || "rds_pool_console");
    setMetaUser(settings.metadata_pg?.username || "postgres");
    setMetaSsl(settings.metadata_pg?.sslmode ?? "require");
  }, [settings]);

  useEffect(() => {
    if (!autoJob || autoJob.status !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const job = await api.metadataJob(autoJob.id);
        setAutoJob(job);
        if (job.status === "succeeded") {
          push("success", "元数据 PG 已创建并初始化");
          await refreshAll();
          setCreatingMeta(false);
        }
        if (job.status === "failed") {
          push("error", job.error || "创建失败");
          setCreatingMeta(false);
        }
      } catch (error) {
        push("error", error instanceof Error ? error.message : String(error));
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [autoJob, push, refreshAll]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.updateSettings({
        region_id: region,
        vpc_id: vpcId,
        vswitch_id: vswitchId,
        zone_id: zoneId,
      });
      push("success", "设置已保存");
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const changeMode = async (mode: "real" | "mock") => {
    setChangingMode(mode);
    try {
      await api.setMode(mode);
      push("success", `已切换到${mode === "real" ? "真实调用" : "模拟模式"}`);
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setChangingMode(null);
    }
  };

  const loadVpcs = async (preferredVpc?: string, preferredSwitch?: string) => {
    setLoadingNetwork(true);
    try {
      const data = await api.vpcs();
      setVpcs(data.vpcs);
      const targetVpc = preferredVpc || vpcId || data.vpcs[0]?.vpc_id;
      if (targetVpc) {
        setVpcId(targetVpc);
        const switches = await api.vswitches(targetVpc);
        setVswitches(switches.vswitches);
        const targetSwitch = preferredSwitch || vswitchId || switches.vswitches[0]?.vswitch_id;
        if (targetSwitch) {
          setVswitchId(targetSwitch);
          const matched = switches.vswitches.find((item) => item.vswitch_id === targetSwitch) || switches.vswitches[0];
          if (matched) setZoneId(matched.zone_id);
        }
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingNetwork(false);
    }
  };

  const loadVswitches = async (id: string) => {
    setVpcId(id);
    setLoadingNetwork(true);
    try {
      const data = await api.vswitches(id);
      setVswitches(data.vswitches);
      if (data.vswitches[0]) {
        setVswitchId(data.vswitches[0].vswitch_id);
        setZoneId(data.vswitches[0].zone_id);
      }
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingNetwork(false);
    }
  };

  const loadPgs = async (silent = false) => {
    setLoadingPgs(true);
    try {
      const data = await api.pgs();
      setPgs(data.pgs);
      if (!silent) push("info", `发现 ${data.pgs.length} 个 PostgreSQL 实例`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingPgs(false);
    }
  };

  const selectPg = async (pg: PgInstance) => {
    setSelectedPg(pg);
    setPgNet(null);
    try {
      const net = await api.pgNet(pg.pg_instance_id);
      setPgNet(net);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!settings) return;
    void loadVpcs(settings.vpc_id, settings.vswitch_id);
    void loadPgs(true);
    // 首次进入页面时自动发现一次，避免下拉框为空
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.region_id]);

  const detectIp = async () => {
    setDetectingIp(true);
    try {
      const data = await api.detectIp();
      setClientIp(data.ip);
      push("success", `检测到公网 IP：${data.ip}`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setDetectingIp(false);
    }
  };

  const testMetadata = async (useSelected = false) => {
    setTestingMeta(true);
    try {
      const data = await api.testMetadata(
        useSelected && selectedPg
          ? {
              host: (pgNet?.public_connection as string) || (pgNet?.vpc_connection as string) || undefined,
              port: (pgNet?.public_port as number) || (pgNet?.vpc_port as number) || 5432,
              username: metaUser,
              password: metaPassword,
              database: metaDatabase,
              sslmode: metaSsl,
            }
          : {
              host: metaHost,
              port: metaPort,
              username: metaUser,
              password: metaPassword,
              database: metaDatabase,
              sslmode: metaSsl,
            },
      );
      push("success", `连接成功：${data.version ?? ""}`);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setTestingMeta(false);
    }
  };

  const configureExisting = async () => {
    if (!selectedPg) {
      push("error", "请先选择一个 PG 实例");
      return;
    }
    setConfiguringMeta(true);
    try {
      await api.configureMetadata({
        pg_instance_id: selectedPg.pg_instance_id,
        database: metaDatabase,
        username: metaUser,
        password: metaPassword,
        sslmode: metaSsl,
        ip: clientIp,
        ensure_public: true,
      });
      push("success", "元数据库已配置并初始化");
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setConfiguringMeta(false);
    }
  };

  const configureManual = async () => {
    if (!metaHost) {
      push("error", "请填写 host");
      return;
    }
    setConfiguringMeta(true);
    try {
      await api.configureMetadata({
        host: metaHost,
        port: metaPort,
        database: metaDatabase,
        username: metaUser,
        password: metaPassword,
        sslmode: metaSsl,
        ensure_public: false,
      });
      push("success", "元数据库已配置并初始化");
      await refreshAll();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setConfiguringMeta(false);
    }
  };

  const createMetadataPg = async () => {
    setCreatingMeta(true);
    try {
      const job = await api.autoCreateMetadata(clientIp);
      setAutoJob(job);
    } catch (error) {
      setCreatingMeta(false);
      push("error", error instanceof Error ? error.message : String(error));
    }
  };

  const runPreflight = async () => {
    setPreflightLoading(true);
    try {
      const result = await api.preflight();
      setPreflight(result);
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setPreflightLoading(false);
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

  const effectiveMode = overview?.cloud_mode ?? "mock";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-eyebrow">SYSTEM / SETUP</div>
          <h1 className="display-title mt-1 text-2xl font-semibold text-white">设置与预检</h1>
          <p className="mt-1 text-xs text-slate-500">
            配置运行模式、控制面元数据库、默认网络与预检；业务池参数请到地域与资源池页面。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={<Wrench size={14} />}
            loading={selfhealLoading}
            onClick={() => void runSelfheal()}
          >
            自愈巡检
          </Button>
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
            onClick={() => void refreshAll()}
          >
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionTitle
            icon={<Cloud size={15} />}
            title="运行模式"
            subtitle={`当前 ${effectiveMode === "real" ? "真实调用" : "模拟模式"}`}
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              {
                value: "real" as const,
                title: "真实调用",
                description: "直接调用阿里云 RDS / RdsAi OpenAPI，创建真实资源并产生费用。",
                icon: Zap,
                tone: "acid" as const,
              },
              {
                value: "mock" as const,
                title: "模拟模式",
                description: "云资源使用本地模拟数据，元数据仍写入已配置的 PG，适合演示与联调。",
                icon: ShieldCheck,
                tone: "cyan" as const,
              },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => void changeMode(option.value)}
                disabled={changingMode !== null}
                className={cx(
                  "rounded-xl border p-4 text-left transition-all disabled:opacity-60",
                  effectiveMode === option.value
                    ? option.tone === "acid"
                      ? "border-acid/45 bg-acid/[0.07]"
                      : "border-cyan/45 bg-cyan/[0.07]"
                    : "border-edge bg-white/[0.02] hover:border-slate-500/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <option.icon size={17} className={option.tone === "acid" ? "text-acid" : "text-cyan-400"} />
                  {changingMode === option.value ? <Loader2 size={13} className="animate-spin text-slate-500" /> : null}
                  {effectiveMode === option.value ? <CheckCircle2 size={14} className="text-acid" /> : null}
                </div>
                <div className="display-title mt-3 text-sm text-white">{option.title}</div>
                <div className="mt-1 text-[11px] leading-5 text-slate-500">{option.description}</div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle
            icon={<Database size={15} />}
            title="控制面元数据库"
            subtitle={metadata?.configured ? `${metadata.host}:${metadata.port}/${metadata.database}` : "未配置"}
          />
          <div className="flex items-center gap-2">
            {metadata?.configured ? (
              <Badge className="border-acid/25 bg-acid/[0.07] text-acid">已连接</Badge>
            ) : (
              <Badge className="border-amber/25 bg-amber/[0.07] text-amber">待配置</Badge>
            )}
            {metadata?.schema_ready ? (
              <Badge className="border-cyan/25 bg-cyan/[0.07] text-cyan-300">表结构就绪</Badge>
            ) : null}
            {metadata?.error ? <span className="text-[10px] text-rose">{metadata.error}</span> : null}
          </div>
        </div>

        <div className="mt-4">
          <Tabs
            value={metadataTab}
            onChange={setMetadataTab}
            tabs={[
              { value: "existing", label: "发现已有 PG" },
              { value: "manual", label: "手动连接" },
              { value: "create", label: "自动创建 PG" },
            ]}
          />
        </div>

        {metadataTab === "existing" ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Server size={13} />}
                loading={loadingPgs}
                onClick={() => void loadPgs()}
              >
                发现 PostgreSQL
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Globe2 size={13} />}
                loading={detectingIp}
                onClick={() => void detectIp()}
              >
                检测公网 IP
              </Button>
              {clientIp ? <span className="mono text-[10px] text-cyan-300">{clientIp}</span> : null}
            </div>
            {pgs.length ? (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {pgs.map((pg) => (
                  <button
                    key={pg.pg_instance_id}
                    onClick={() => void selectPg(pg)}
                    className={cx(
                      "rounded-lg border p-3 text-left transition-all",
                      selectedPg?.pg_instance_id === pg.pg_instance_id
                        ? "border-cyan/45 bg-cyan/[0.06]"
                        : "border-edge bg-white/[0.02] hover:border-slate-500/40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="mono text-[11px] text-slate-200">{pg.pg_instance_id}</span>
                      <StatusBadge status={pg.status === "Running" ? "Available" : "Creating"} />
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      {pg.instance_class} · {pg.engine_version}
                      {pg.storage_gb ? ` · ${pg.storage_gb}GB` : ""}
                    </div>
                    <div className="mono mt-1 truncate text-[10px] text-slate-600">
                      {pg.vpc_id} / {pg.vswitch_id}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-3 text-[11px] text-slate-500">
                点击「发现 PostgreSQL」列出账号下的 RDS PG 实例；也可以切到「手动连接」填写本机或 VPC 内地址。
              </div>
            )}
            {selectedPg ? (
              <div className="rounded-xl border border-edge bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="mono text-xs text-slate-200">{selectedPg.pg_instance_id}</div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      公网：{(pgNet?.public_connection as string) || "未开启（配置时会自动申请）"} · 内网：
                      {(pgNet?.vpc_connection as string) || "—"}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" loading={testingMeta} onClick={() => void testMetadata(true)}>
                    测试连接
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="用户名">
                    <Input
                      value={metaUser}
                      onChange={(event) => setMetaUser(event.target.value)}
                      placeholder="postgres"
                    />
                  </Field>
                  <Field label="密码">
                    <Input
                      type="password"
                      value={metaPassword}
                      onChange={(event) => setMetaPassword(event.target.value)}
                      placeholder="••••••••"
                    />
                  </Field>
                  <Field label="Database">
                    <Input value={metaDatabase} onChange={(event) => setMetaDatabase(event.target.value)} />
                  </Field>
                  <Field label="SSL Mode">
                    <Select value={metaSsl} onChange={(event) => setMetaSsl(event.target.value)}>
                      <option value="require">require</option>
                      <option value="prefer">prefer</option>
                      <option value="disable">disable</option>
                    </Select>
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-600">
                    配置时会自动申请公网地址（如未开启）并将当前公网 IP 追加到白名单。
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Save size={13} />}
                    loading={configuringMeta}
                    onClick={() => void configureExisting()}
                  >
                    使用该 PG
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {metadataTab === "manual" ? (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Host">
                <Input
                  value={metaHost}
                  onChange={(event) => setMetaHost(event.target.value)}
                  placeholder="pgm-xxx.pg.rds.aliyuncs.com 或 127.0.0.1"
                />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  value={metaPort}
                  onChange={(event) => setMetaPort(Number(event.target.value) || 5432)}
                />
              </Field>
              <Field label="Database">
                <Input value={metaDatabase} onChange={(event) => setMetaDatabase(event.target.value)} />
              </Field>
              <Field label="用户名">
                <Input value={metaUser} onChange={(event) => setMetaUser(event.target.value)} />
              </Field>
              <Field label="密码" hint="本机 trust 认证可留空">
                <Input type="password" value={metaPassword} onChange={(event) => setMetaPassword(event.target.value)} />
              </Field>
              <Field label="SSL Mode">
                <Select value={metaSsl} onChange={(event) => setMetaSsl(event.target.value)}>
                  <option value="require">require</option>
                  <option value="prefer">prefer</option>
                  <option value="disable">disable</option>
                  <option value="">不指定</option>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] text-slate-600">
                适用于本机 PostgreSQL、VPC 内地址或已有人工维护的连接信息。配置失败的库不会影响当前连接。
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" loading={testingMeta} onClick={() => void testMetadata(false)}>
                  测试连接
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Save size={13} />}
                  loading={configuringMeta}
                  onClick={() => void configureManual()}
                >
                  配置并使用
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {metadataTab === "create" ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-edge bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="display-title text-sm text-slate-200">自动创建元数据 PG</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    PostgreSQL 17 · 基础版 · 2C4G · 20GB · 按量付费 · 自动申请公网地址并加入白名单
                  </div>
                </div>
                <Badge className="border-amber/25 bg-amber/[0.07] text-amber">产生费用</Badge>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label="VPC">
                  <Input value={vpcId} readOnly placeholder="先在网络配置中选择" />
                </Field>
                <Field label="VSwitch">
                  <Input value={vswitchId} readOnly placeholder="先在网络配置中选择" />
                </Field>
                <Field label="公网 IP">
                  <div className="flex gap-2">
                    <Input
                      value={clientIp}
                      onChange={(event) => setClientIp(event.target.value)}
                      placeholder="自动检测或手动填写"
                    />
                    <Button size="sm" variant="secondary" loading={detectingIp} onClick={() => void detectIp()}>
                      检测
                    </Button>
                  </div>
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-slate-600">创建通常需要 5~15 分钟，期间可以继续留在当前页面。</span>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Zap size={13} />}
                  loading={creatingMeta && autoJob?.status === "running"}
                  disabled={!vpcId || !vswitchId}
                  onClick={() => void createMetadataPg()}
                >
                  创建并初始化
                </Button>
              </div>
            </div>
            {autoJob ? (
              <div className="rounded-xl border border-edge bg-white/[0.02] p-4">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">{autoJob.message}</span>
                  <span className="mono text-slate-500">{autoJob.progress}%</span>
                </div>
                <div className="mt-2">
                  <Progress value={autoJob.progress} tone={autoJob.status === "failed" ? "rose" : "cyan"} />
                </div>
                {autoJob.error ? <div className="mt-2 text-[11px] text-rose">{autoJob.error}</div> : null}
                {autoJob.status === "succeeded" ? (
                  <div className="mt-2 text-[11px] text-acid">
                    已就绪：{String(autoJob.result?.public_connection ?? "")}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <SectionTitle
              icon={<Globe2 size={15} />}
              title="默认网络（控制面）"
              subtitle="仅用于控制面元数据 PG 自动创建"
            />
            <Button size="sm" variant="secondary" loading={loadingNetwork} onClick={() => void loadVpcs()}>
              发现网络
            </Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="VPC">
              <Select value={vpcId} onChange={(event) => void loadVswitches(event.target.value)}>
                <option value="">请选择 VPC</option>
                {vpcs.map((vpc) => (
                  <option key={vpc.vpc_id} value={vpc.vpc_id}>
                    {vpc.name || vpc.vpc_id} · {vpc.cidr}
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
            <Field label="可用区">
              <Input
                value={zoneId}
                onChange={(event) => setZoneId(event.target.value)}
                placeholder="随 VSwitch 自动带出"
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-600">
              业务实例的网络与共享 PG 请到「地域与资源池」按地域配置；这里只影响元数据 PG 自动创建。
            </span>
            <Button
              size="sm"
              variant="primary"
              icon={<Save size={13} />}
              loading={savingSettings}
              onClick={() => void saveSettings()}
            >
              保存默认网络
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Layers size={15} className="text-cyan-400" />
            <span className="display-title text-sm text-slate-200">地域与资源池</span>
          </div>
          <p className="mt-3 text-[11px] leading-6 text-slate-400">
            每个地域维护独立的单租户池和多租共享池。目标水位、最大实例数、自动补货、释放策略、冻结方式与网络都在
            「地域与资源池」页面按池配置。
          </p>
          <ul className="mt-3 space-y-2 text-[11px] leading-6 text-slate-500">
            <li>· 单租池：每个实例独享 PG，可配置 PG 规格、存储与白名单。</li>
            <li>· 多租共享池：可挂多台共享 PG，按负载比例选择最空闲的一台。</li>
            <li>· 自动补货按池执行，巡检任务覆盖所有已启用资源池。</li>
          </ul>
          <div className="mt-4">
            <Link to="/pools">
              <Button size="sm" variant="primary" icon={<ArrowRight size={13} />}>
                前往地域与资源池
              </Button>
            </Link>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={<Terminal size={15} />} title="预检" subtitle="凭证、资源与接口可用性" />
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={13} />}
            loading={preflightLoading}
            onClick={() => void runPreflight()}
          >
            运行预检
          </Button>
        </div>
        {preflight ? (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2 text-[10px]">
              <Badge className="border-acid/25 bg-acid/[0.07] text-acid">通过 {preflight.summary.pass}</Badge>
              <Badge className="border-amber/25 bg-amber/[0.07] text-amber">警告 {preflight.summary.warn}</Badge>
              <Badge className="border-rose/25 bg-rose/[0.07] text-rose">失败 {preflight.summary.fail}</Badge>
              <Badge className="border-edge bg-white/[0.03] text-slate-400">模式 {preflight.mode}</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {preflight.checks.map((check) => (
                <CheckRow key={check.name} check={check} />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-edge bg-white/[0.02] px-3 py-3 text-[11px] text-slate-500">
            预检会检查 AK/SK、STS 身份、VPC、RDS、RdsAi、服务关联角色、元数据库与容量接口。真实模式下大约需要数秒。
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionTitle icon={<Wifi size={15} />} title="连接信息" subtitle="当前控制面" />
          <div className="mt-3 space-y-2 text-[11px]">
            <KeyValue label="数据库 URL" value={metadata?.database_url || "未配置"} mono />
            <KeyValue label="Schema" value={metadata?.schema_ready ? "已初始化" : "未初始化"} />
            <KeyValue label="来源" value={metadata?.source || "—"} />
            <KeyValue label="PG 实例" value={metadata?.pg_instance_id || "—"} mono />
            <KeyValue label="最近刷新" value={lastUpdated ? relativeTime(lastUpdated) : "—"} />
          </div>
        </Card>
        <Card className="p-5">
          <SectionTitle icon={<AlertTriangle size={15} />} title="安全边界" subtitle="真实模式请谨慎操作" />
          <ul className="mt-3 space-y-2 text-[11px] leading-6 text-slate-400">
            <li>· 所有创建、销毁操作都需要在页面二次确认；自动补货默认关闭。</li>
            <li>· AK/SK 仅保存在本机 0600 文件，不进入数据库，页面只展示脱敏值。</li>
            <li>· 删除单租户实例会同时删除底层 PG；多租共享池只删除当前租户。</li>
            <li>· 普通停不会释放连接名额；需要降低活跃租户数时请使用 Force 停。</li>
            <li>· 真实模式会产生费用，建议先用 Mock 模式跑通页面与流程。</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-cyan-400">{icon}</span>
      <span className="display-title text-sm text-slate-200">{title}</span>
      {subtitle ? <span className="text-[10px] text-slate-600">{subtitle}</span> : null}
    </div>
  );
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-edge/60 py-1.5 last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={cx("break-all text-right text-slate-300", mono && "mono text-[10px]")}>{value}</span>
    </div>
  );
}

function CheckRow({ check }: { check: CheckResult }) {
  const icon =
    check.status === "pass" ? (
      <CheckCircle2 size={14} className="text-acid" />
    ) : check.status === "warn" ? (
      <AlertTriangle size={14} className="text-amber" />
    ) : (
      <XCircle size={14} className="text-rose" />
    );
  return (
    <div className="flex items-start gap-2 rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-300">{check.name}</div>
        <div className="mt-0.5 break-all text-[10px] leading-5 text-slate-500">{check.message}</div>
      </div>
    </div>
  );
}

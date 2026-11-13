import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Boxes, RotateCcw, Trash2, Zap } from "lucide-react";
import { api } from "../lib/api";
import { cx, STATUS_META } from "../lib/format";
import { useAppData } from "../lib/store";
import type { Instance } from "../lib/types";
import { Badge, Button, Field, Input, Modal, StatusBadge, useToast } from "./ui";

export function PrewarmModal({
  open,
  onClose,
  defaultMode = "single",
}: {
  open: boolean;
  onClose: () => void;
  defaultMode?: "single" | "shared";
}) {
  const { overview, refreshAll } = useAppData();
  const { push } = useToast();
  const [mode, setMode] = useState<"single" | "shared">(defaultMode);
  const [count, setCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(defaultMode);
      setCount(1);
    }
  }, [open, defaultMode]);

  const sharedPgs = overview?.shared_pgs ?? [];
  const single = overview?.pools?.single;
  const shared = overview?.pools?.shared;
  const stats = mode === "single" ? single : shared;
  const sharedAvailable = sharedPgs.some((item) => item.enabled && (item.status || "").toLowerCase() === "running");
  const modeBlocked = mode === "shared" ? !shared?.id || !sharedAvailable : !single?.id;
  const maxCount = stats?.max ?? 4;

  const submit = async () => {
    if (!stats?.id) return;
    setSubmitting(true);
    try {
      const result = await api.prewarm(stats.id, count);
      push("success", `已提交 ${result.count} 个预热任务`);
      await refreshAll();
      onClose();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="预热实例"
      subtitle="后台异步创建实例并冻结进入冷池，可被应用秒级分配"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            icon={<Zap size={14} />}
            loading={submitting}
            disabled={modeBlocked}
            onClick={() => void submit()}
          >
            开始预热
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              value: "single" as const,
              title: "单租户池",
              subtitle: "每个实例独享 PG",
              stats: single,
              accent: "cyan" as const,
            },
            {
              value: "shared" as const,
              title: "多租共享池",
              subtitle: "共享已有 PG，成本更低",
              stats: shared,
              accent: "violet" as const,
            },
          ].map((item) => (
            <button
              key={item.value}
              onClick={() => setMode(item.value)}
              className={cx(
                "relative rounded-xl border p-4 text-left transition-all",
                mode === item.value
                  ? item.accent === "cyan"
                    ? "border-cyan/45 bg-cyan/[0.07] shadow-[0_0_28px_rgba(34,211,238,.08)]"
                    : "border-violet/45 bg-violet/[0.07] shadow-[0_0_28px_rgba(129,140,248,.08)]"
                  : "border-edge bg-white/[0.02] hover:border-slate-500/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="display-title text-sm text-white">{item.title}</span>
                <Badge
                  className={
                    item.accent === "cyan"
                      ? "border-cyan/30 bg-cyan/10 text-cyan-300"
                      : "border-violet/30 bg-violet/10 text-violet"
                  }
                >
                  {item.stats?.total ?? 0} 个
                </Badge>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{item.subtitle}</div>
              <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
                <span>
                  冷池 <span className="mono text-slate-300">{item.stats?.cold ?? 0}</span>
                </span>
                <span>
                  使用中 <span className="mono text-slate-300">{item.stats?.in_use ?? 0}</span>
                </span>
                <span>
                  水位 <span className="mono text-slate-300">{item.stats?.target ?? 0}</span>
                </span>
              </div>
            </button>
          ))}
        </div>

        {modeBlocked ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-2.5 text-[11px] text-amber">
            <AlertTriangle size={14} className="mt-0.5" />
            {mode === "shared"
              ? "当前地域共享池没有可用的共享 PG，请先到「地域与资源池」添加并启用。"
              : "当前地域没有单租户池，请先到「地域与资源池」创建。"}
          </div>
        ) : null}

        <Field label="预热数量" hint={`当前池上限 ${maxCount} 个`}>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((value) => (
              <button
                key={value}
                onClick={() => setCount(value)}
                disabled={value > maxCount}
                className={cx(
                  "h-9 w-12 rounded-lg border text-sm transition-all disabled:cursor-not-allowed disabled:opacity-40",
                  count === value
                    ? "border-cyan/50 bg-cyan/10 text-cyan-300"
                    : "border-edge bg-white/[0.02] text-slate-500 hover:text-slate-300",
                )}
              >
                {value}
              </button>
            ))}
            <Input
              type="number"
              min={1}
              max={Math.max(1, maxCount)}
              value={count}
              onChange={(event) =>
                setCount(Math.max(1, Math.min(Math.max(1, maxCount), Number(event.target.value) || 1)))
              }
              className="w-24"
            />
          </div>
        </Field>

        <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5 text-[11px] leading-5 text-slate-500">
          预热会真实创建资源（真实模式下产生费用），并按批间隔执行。创建完成后实例会被停止并进入冷池。
        </div>
      </div>
    </Modal>
  );
}

export function AllocateModal({
  instance,
  open,
  onClose,
}: {
  instance: Instance | null;
  open: boolean;
  onClose: () => void;
}) {
  const { refreshAll } = useAppData();
  const { push } = useToast();
  const [appName, setAppName] = useState("");
  const [user, setUser] = useState("demo-user");
  const [submitting, setSubmitting] = useState(false);
  const reservedApp = instance ? String((instance.detail || {}).reserved_app_name || "") : "";

  useEffect(() => {
    if (open && instance) {
      setAppName(reservedApp);
      setUser(instance.bound_user || "demo-user");
    }
  }, [open, instance, reservedApp]);

  const submit = async () => {
    if (!instance) return;
    setSubmitting(true);
    try {
      await api.allocate(instance.id, { app_name: appName, user });
      push("success", "分配任务已提交，正在唤醒实例");
      await refreshAll();
      onClose();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reservedApp ? "复用实例" : "分配实例"}
      subtitle={
        reservedApp
          ? `该实例保留给应用 ${reservedApp}，仅支持同应用复用`
          : "绑定应用并从冷池唤醒，分配后实例状态变为使用中"
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            icon={<Boxes size={14} />}
            loading={submitting}
            disabled={!appName.trim()}
            onClick={() => void submit()}
          >
            {reservedApp ? "确认复用" : "确认分配"}
          </Button>
        </>
      }
    >
      {instance ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-edge bg-white/[0.02] p-3">
            <div className="flex items-center justify-between">
              <span className="mono text-xs text-slate-300">{instance.app_name}</span>
              <StatusBadge status={instance.status} />
            </div>
            <div className="mt-2 grid gap-1 text-[11px] text-slate-500">
              <span>
                Supabase：<span className="mono text-slate-400">{instance.supabase_instance_id ?? "—"}</span>
              </span>
              <span>
                底层 PG：<span className="mono text-slate-400">{instance.pg_instance_id ?? "—"}</span>
              </span>
            </div>
          </div>
          <Field label="应用名称">
            <Input
              value={appName}
              onChange={(event) => setAppName(event.target.value)}
              placeholder="例如：vibe-app-orders"
              disabled={Boolean(reservedApp)}
              autoFocus
            />
          </Field>
          {reservedApp ? (
            <div className="rounded-lg border border-amber/30 bg-amber/[0.06] px-3 py-2.5 text-[11px] text-amber">
              该实例已保留给应用 <span className="mono">{reservedApp}</span>
              ，其他应用不能分配。如需给新应用使用，请先删除该实例。
            </div>
          ) : null}
          <Field label="使用者" hint="仅用于演示绑定关系">
            <Input value={user} onChange={(event) => setUser(event.target.value)} placeholder="demo-user" />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

export function ReleaseDialog({
  instance,
  open,
  onClose,
}: {
  instance: Instance | null;
  open: boolean;
  onClose: () => void;
}) {
  const { region, refreshAll } = useAppData();
  const { push } = useToast();
  const poolConfig = region?.pools.find((item) => item.id === instance?.pool_id)?.config;
  const defaultDestroy = (poolConfig?.release_policy ?? "return") === "destroy";
  const canRetain = instance?.status === "InUse";
  const [destroy, setDestroy] = useState(defaultDestroy || !canRetain);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setDestroy(!canRetain || defaultDestroy);
  }, [open, canRetain, defaultDestroy]);

  const submit = async () => {
    if (!instance) return;
    setSubmitting(true);
    try {
      await api.release(instance.id, destroy);
      push("success", destroy ? "删除任务已提交" : "保留任务已提交");
      await refreshAll();
      onClose();
    } catch (error) {
      push("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const options = useMemo(
    () => [
      {
        value: false,
        title: "同应用复用",
        description: "保留实例和数据，仅原应用可再次分配；其他应用不可使用。",
        icon: RotateCcw,
        tone: "cyan" as const,
      },
      {
        value: true,
        title: "直接删除",
        description:
          instance?.mode === "shared"
            ? "删除当前租户的 Supabase 实例，不会删除共享 PG。"
            : "删除 Supabase 与底层 PG，资源不可恢复。",
        icon: Trash2,
        tone: "rose" as const,
      },
    ],
    [instance?.mode],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="释放实例"
      subtitle={instance ? `${instance.app_name} · ${instance.supabase_instance_id ?? ""}` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={destroy ? "danger" : "primary"}
            loading={submitting}
            icon={destroy ? <Trash2 size={14} /> : <RotateCcw size={14} />}
            onClick={() => void submit()}
          >
            {destroy ? "确认删除" : "确认保留"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const disabled = option.value === false && !canRetain;
          return (
            <button
              key={String(option.value)}
              disabled={disabled}
              onClick={() => {
                if (!disabled) setDestroy(option.value);
              }}
              className={cx(
                "rounded-xl border p-4 text-left transition-all",
                disabled && "cursor-not-allowed opacity-40",
                destroy === option.value
                  ? option.tone === "cyan"
                    ? "border-cyan/45 bg-cyan/[0.07]"
                    : "border-rose/45 bg-rose/[0.07]"
                  : "border-edge bg-white/[0.02] hover:border-slate-500/40",
              )}
            >
              <option.icon size={18} className={option.tone === "cyan" ? "text-cyan-400" : "text-rose"} />
              <div className="display-title mt-3 text-sm text-white">{option.title}</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-500">{option.description}</div>
            </button>
          );
        })}
      </div>
      {!canRetain ? (
        <div className="mt-3 rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5 text-[11px] text-slate-500">
          只有使用中的实例可以保留给原应用复用；当前实例请直接删除。
        </div>
      ) : null}
      {destroy ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/[0.06] px-3 py-2.5 text-[11px] text-rose">
          <AlertTriangle size={14} className="mt-0.5" />
          销毁会真实删除云端资源，请确认实例已不再使用。
        </div>
      ) : null}
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "确认",
  variant = "primary",
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "primary" | "danger" | "acid";
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant={variant} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-xs leading-6 text-slate-400">{description}</p>
      {children}
    </Modal>
  );
}

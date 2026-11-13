import clsx, { type ClassValue } from "clsx";

export function cx(...values: ClassValue[]): string {
  return clsx(values);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function relativeTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 0) return "刚刚";
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 前`;
  return `${Math.floor(diff / 86400)}d 前`;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function shortId(value?: string | null, length = 8): string {
  if (!value) return "—";
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

export function compactId(value?: string | null, length = 10): string {
  if (!value) return "—";
  return value.length <= length ? value : `${value.slice(0, length)}`;
}

export function formatNumber(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export const STATUS_META: Record<
  string,
  { label: string; badge: string; dot: string; bar: string; description: string }
> = {
  Creating: {
    label: "创建中",
    badge: "border-amber/30 bg-amber/10 text-amber",
    dot: "bg-amber shadow-[0_0_10px_rgba(245,158,11,.8)]",
    bar: "bg-amber",
    description: "已调用云端 API，等待实例就绪",
  },
  Available: {
    label: "可用",
    badge: "border-cyan/30 bg-cyan/10 text-cyan-400",
    dot: "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,.8)]",
    bar: "bg-cyan-400",
    description: "运行中且未绑定应用",
  },
  InCold: {
    label: "冷池空闲",
    badge: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    dot: "bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,.8)]",
    bar: "bg-sky-400",
    description: "已冻结；未保留的可分配，保留的仅原应用可复用",
  },
  InUse: {
    label: "使用中",
    badge: "border-acid/30 bg-acid/10 text-acid",
    dot: "bg-acid shadow-[0_0_10px_rgba(163,230,53,.8)]",
    bar: "bg-acid",
    description: "已绑定应用并唤醒",
  },
  Releasing: {
    label: "释放中",
    badge: "border-violet/30 bg-violet/10 text-violet",
    dot: "bg-violet shadow-[0_0_10px_rgba(129,140,248,.8)]",
    bar: "bg-violet",
    description: "正在保留复用或删除资源",
  },
  Deleted: {
    label: "已删除",
    badge: "border-slate-500/30 bg-slate-500/10 text-slate-400",
    dot: "bg-slate-500",
    bar: "bg-slate-500",
    description: "资源已销毁",
  },
  Failed: {
    label: "失败",
    badge: "border-rose/30 bg-rose/10 text-rose",
    dot: "bg-rose shadow-[0_0_10px_rgba(251,113,133,.8)]",
    bar: "bg-rose",
    description: "任务失败，需要处理",
  },
};

export const TASK_STATUS_META: Record<string, { label: string; badge: string; dot: string }> = {
  pending: { label: "排队中", badge: "border-slate-500/30 bg-slate-500/10 text-slate-400", dot: "bg-slate-500" },
  running: { label: "执行中", badge: "border-cyan/30 bg-cyan/10 text-cyan-400", dot: "bg-cyan-400" },
  succeeded: { label: "成功", badge: "border-acid/30 bg-acid/10 text-acid", dot: "bg-acid" },
  failed: { label: "失败", badge: "border-rose/30 bg-rose/10 text-rose", dot: "bg-rose" },
};

export const MODE_META: Record<string, { label: string; badge: string; accent: string }> = {
  single: {
    label: "单租户池",
    badge: "border-cyan/30 bg-cyan/10 text-cyan-400",
    accent: "text-cyan-400",
  },
  shared: {
    label: "多租共享池",
    badge: "border-violet/30 bg-violet/10 text-violet",
    accent: "text-violet",
  },
};

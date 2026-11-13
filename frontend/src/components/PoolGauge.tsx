import { cx, STATUS_META } from "../lib/format";

export function PoolGauge({
  cold,
  target,
  total,
  max,
  inUse,
  accent,
  size = 196,
}: {
  cold: number;
  target: number;
  total: number;
  max: number;
  inUse: number;
  accent: "cyan" | "violet";
  size?: number;
}) {
  const center = size / 2;
  const rOuter = center - 12;
  const rInner = center - 28;
  const cOuter = 2 * Math.PI * rOuter;
  const cInner = 2 * Math.PI * rInner;
  const sweep = 0.75;
  const outerFraction = max > 0 ? Math.min(1, total / max) : 0;
  const innerFraction = target > 0 ? Math.min(1, cold / target) : 0;
  const outerColor = accent === "cyan" ? "#22d3ee" : "#818cf8";
  const innerColor = accent === "cyan" ? "#a3e635" : "#22d3ee";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-0">
        <defs>
          <filter id={`glow-${accent}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={center}
          cy={center}
          r={rOuter}
          fill="none"
          stroke="rgba(148,163,184,.12)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${cOuter * sweep} ${cOuter}`}
          transform={`rotate(135 ${center} ${center})`}
        />
        <circle
          cx={center}
          cy={center}
          r={rOuter}
          fill="none"
          stroke={outerColor}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${cOuter * sweep * outerFraction} ${cOuter}`}
          transform={`rotate(135 ${center} ${center})`}
          filter={`url(#glow-${accent})`}
          style={{ transition: "stroke-dasharray .7s cubic-bezier(.22,.8,.32,1)" }}
        />
        <circle
          cx={center}
          cy={center}
          r={rInner}
          fill="none"
          stroke="rgba(148,163,184,.09)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${cInner * sweep} ${cInner}`}
          transform={`rotate(135 ${center} ${center})`}
        />
        <circle
          cx={center}
          cy={center}
          r={rInner}
          fill="none"
          stroke={innerColor}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${cInner * sweep * innerFraction} ${cInner}`}
          transform={`rotate(135 ${center} ${center})`}
          opacity=".9"
          style={{ transition: "stroke-dasharray .7s cubic-bezier(.22,.8,.32,1)" }}
        />
        {Array.from({ length: 24 }).map((_, index) => {
          const angle = (135 + (270 / 23) * index) * (Math.PI / 180);
          const r1 = rOuter + 8;
          const r2 = rOuter + 11;
          const x1 = center + Math.cos(angle) * r1;
          const y1 = center + Math.sin(angle) * r1;
          const x2 = center + Math.cos(angle) * r2;
          const y2 = center + Math.sin(angle) * r2;
          return <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(148,163,184,.25)" strokeWidth="1" />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="label-eyebrow">COLD READY</div>
        <div className="display-title mt-1 flex items-baseline gap-1 text-white">
          <span className="text-4xl font-semibold leading-none" style={{ color: innerColor }}>
            {cold}
          </span>
          <span className="text-sm text-slate-500">/ {target}</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
          <span>
            TOTAL <span className="mono text-slate-300">{total}</span>
          </span>
          <span className="h-3 w-px bg-edge" />
          <span>
            IN USE <span className="mono text-slate-300">{inUse}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function StatusDistribution({ byStatus }: { byStatus: Record<string, number> }) {
  const entries = Object.entries(byStatus).filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) {
    return <div className="text-[11px] text-slate-600">暂无实例</div>;
  }
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.04]">
        {entries.map(([status, value]) => (
          <div
            key={status}
            className={cx("h-full transition-all", STATUS_META[status]?.bar ?? "bg-slate-500")}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${STATUS_META[status]?.label ?? status}: ${value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([status, value]) => (
          <span key={status} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className={cx("h-1.5 w-1.5 rounded-full", STATUS_META[status]?.dot ?? "bg-slate-500")} />
            {STATUS_META[status]?.label ?? status}
            <span className="mono text-slate-300">{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function RatioDial({
  ratio,
  size = 132,
  label = "ACTIVE RATIO",
  accent = "#22d3ee",
}: {
  ratio: number;
  size?: number;
  label?: string;
  accent?: string;
}) {
  const center = size / 2;
  const radius = center - 10;
  const circumference = 2 * Math.PI * radius;
  const sweep = 0.75;
  const fraction = Math.min(1, Math.max(0, ratio));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,.12)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${circumference * sweep} ${circumference}`}
          transform={`rotate(135 ${center} ${center})`}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={accent}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${circumference * sweep * fraction} ${circumference}`}
          transform={`rotate(135 ${center} ${center})`}
          style={{
            transition: "stroke-dasharray .7s cubic-bezier(.22,.8,.32,1)",
            filter: `drop-shadow(0 0 6px ${accent}66)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="label-eyebrow text-[8px]">{label}</div>
        <div className="display-title text-2xl font-semibold text-white">{(ratio * 100).toFixed(0)}%</div>
        <div className="text-[10px] text-slate-500">当前生效值</div>
      </div>
    </div>
  );
}

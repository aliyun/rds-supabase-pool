import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Boxes,
  Database,
  Gauge,
  Globe2,
  LayoutDashboard,
  Layers,
  RefreshCw,
  ScrollText,
  Settings2,
  UsersRound,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useAppData } from "../lib/store";
import { cx, relativeTime } from "../lib/format";
import { Badge, Button, StatusBadge } from "./ui";
import { UserMenu } from "./UserMenu";

const NAV_ITEMS = [
  { to: "/global", label: "全局总览", icon: Globe2, eyebrow: "GLOBAL" },
  { to: "/", label: "地域总览", icon: LayoutDashboard, eyebrow: "OVERVIEW" },
  { to: "/pools", label: "地域与资源池", icon: Layers, eyebrow: "POOLS" },
  { to: "/instances", label: "实例管理", icon: Boxes, eyebrow: "INSTANCES" },
  { to: "/capacity", label: "容量管理", icon: Gauge, eyebrow: "CAPACITY" },
  { to: "/tasks", label: "任务与日志", icon: ScrollText, eyebrow: "OPERATIONS" },
  { to: "/users", label: "平台账号", icon: UsersRound, eyebrow: "IDENTITY" },
  { to: "/billing", label: "池成本", icon: Wallet, eyebrow: "COST" },
  { to: "/settings", label: "设置与预检", icon: Settings2, eyebrow: "SYSTEM" },
];

export function PoolMark() {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id="pg" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a3e635" />
        </linearGradient>
      </defs>
      <path d="M24 3 42.5 13.5v21L24 45 5.5 34.5v-21L24 3Z" stroke="url(#pg)" strokeWidth="1.4" opacity=".75" />
      <path d="M24 10.5 36 17.5v13L24 37.5 12 30.5v-13l12-7Z" stroke="url(#pg)" strokeWidth="1" opacity=".35" />
      <circle cx="24" cy="24" r="4.2" fill="url(#pg)" />
      <circle cx="24" cy="24" r="8.5" stroke="url(#pg)" strokeWidth=".8" strokeDasharray="2 4" opacity=".7" />
    </svg>
  );
}

export function Layout() {
  const { overview, connected, refreshing, refreshAll, lastUpdated, regions, regionId, setRegion, loading } =
    useAppData();
  const location = useLocation();
  const cloudMode = overview?.cloud_mode ?? "mock";
  const configured = overview?.configured ?? false;
  const waiting = loading && !overview;
  const modeLabel = waiting ? "连接中" : cloudMode === "real" ? "真实调用" : "模拟模式";
  const modeBadge = waiting
    ? "border-edge bg-white/[0.03] text-slate-400"
    : cloudMode === "real"
      ? "border-acid/30 bg-acid/10 text-acid"
      : "border-cyan/30 bg-cyan/10 text-cyan-300";
  const modeDot = waiting ? "bg-slate-500" : cloudMode === "real" ? "bg-acid" : "bg-cyan-400";
  const dbHost = overview?.database?.host || "未配置";
  const dbName = overview?.database?.database || "—";
  const current = NAV_ITEMS.find((item) =>
    item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to),
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-edge bg-ink-900/65 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <PoolMark />
          <div>
            <div className="display-title text-[15px] font-semibold tracking-wide text-white">POOL CONTROL</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">RDS Supabase</div>
          </div>
        </div>
        <div className="mx-4 mb-2 h-px bg-gradient-to-r from-transparent via-edge to-transparent" />
        <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cx(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200",
                  isActive
                    ? "bg-cyan/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,.14)]"
                    : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-200",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full transition-all",
                      isActive ? "bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,.9)]" : "bg-transparent",
                    )}
                  />
                  <item.icon
                    size={16}
                    className={isActive ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"}
                  />
                  <div className="flex flex-1 items-center justify-between">
                    <span className="text-[13px]">{item.label}</span>
                    <span className="text-[9px] tracking-[0.16em] text-slate-600 group-hover:text-slate-500">
                      {item.eyebrow}
                    </span>
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-edge px-4 py-4">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Database size={12} className="text-slate-500" />
              元数据库
            </span>
            <span className={cx(configured ? "text-acid" : waiting ? "text-slate-500" : "text-rose")}>
              {configured ? "ONLINE" : waiting ? "LOADING" : "SETUP"}
            </span>
          </div>
          <div className="mono truncate text-[10px] text-slate-500" title={`${dbHost}/${dbName}`}>
            {dbHost} / {dbName}
          </div>
          <div className="flex items-center justify-between">
            <Badge
              className={
                waiting
                  ? "border-edge bg-white/[0.03] text-slate-400"
                  : cloudMode === "real"
                    ? "border-acid/30 bg-acid/10 text-acid"
                    : "border-cyan/30 bg-cyan/10 text-cyan-300"
              }
              dot={modeDot}
            >
              {waiting ? "CONNECTING" : cloudMode === "real" ? "REAL" : "MOCK"}
            </Badge>
            <span className="text-[10px] text-slate-500">v0.1.0</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-edge bg-ink-900/75 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-7">
            <div className="flex items-center gap-3">
              <div className="lg:hidden">
                <PoolMark />
              </div>
              <div>
                <div className="label-eyebrow">{current?.eyebrow ?? "POOL CONTROL"}</div>
                <div className="display-title text-lg font-semibold text-white">{current?.label ?? "总览"}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={modeBadge} dot={modeDot}>
                {modeLabel}
              </Badge>
              <select
                value={regionId}
                onChange={(event) => setRegion(event.target.value)}
                className="min-w-[170px] rounded-md border border-edge bg-ink-850 px-2 py-1 text-[11px] text-slate-300 outline-none transition-colors hover:border-cyan/40 focus:border-cyan/50"
                title="切换地域"
              >
                {regions.length === 0 ? <option value="">未配置地域</option> : null}
                {regions.map((item) => (
                  <option key={item.region_id} value={item.region_id}>
                    {item.name && item.name !== item.region_id ? `${item.name} (${item.region_id})` : item.region_id}
                  </option>
                ))}
              </select>
              <span
                className={cx(
                  "hidden items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] sm:inline-flex",
                  connected ? "border-acid/25 bg-acid/[0.06] text-acid" : "border-amber/25 bg-amber/[0.06] text-amber",
                )}
              >
                {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
                {connected ? "LIVE" : "POLLING"}
              </span>
              <span className="hidden text-[10px] text-slate-500 md:inline">
                {lastUpdated ? `更新 ${relativeTime(lastUpdated)}` : "—"}
              </span>
              <UserMenu />
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />}
                onClick={() => void refreshAll()}
              >
                刷新
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-edge/60 px-3 py-2 lg:hidden">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cx(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px]",
                    isActive ? "bg-cyan/10 text-cyan-300" : "text-slate-400",
                  )
                }
              >
                <item.icon size={13} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 lg:px-7 lg:py-6">
          {!waiting && !configured ? <SetupBanner /> : null}
          <Outlet />
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-edge px-4 py-3 text-[10px] text-slate-500 lg:px-7">
          <span className="flex items-center gap-1.5">
            <Activity size={11} />
            RDS Supabase Resource Pool Console
          </span>
          <span className="mono">control-plane · {overview?.database?.dialect ?? "postgresql"}</span>
        </footer>
      </div>
    </div>
  );
}

function SetupBanner() {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber/[0.06] px-4 py-3">
      <div className="flex items-start gap-2 text-xs text-amber">
        <StatusBadge status="Creating" />
        <span>控制面元数据库尚未配置，实例与任务页面不可用。请先完成初始化向导。</span>
      </div>
      <NavLink to="/settings">
        <Button size="sm" variant="primary">
          打开初始化向导
        </Button>
      </NavLink>
    </div>
  );
}

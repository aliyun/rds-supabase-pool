import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Info, Loader2, X } from "lucide-react";
import { cx, STATUS_META, TASK_STATUS_META } from "../lib/format";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "acid";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-cyan-400 text-ink-950 font-semibold hover:bg-cyan-300 shadow-[0_0_26px_rgba(34,211,238,.28)] border border-cyan-300/40",
  secondary:
    "border border-edge bg-white/[0.03] text-slate-200 hover:border-cyan/40 hover:text-white hover:bg-white/[0.055]",
  ghost: "text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent",
  danger: "border border-rose/35 bg-rose/10 text-rose hover:bg-rose/20 hover:border-rose/60",
  acid: "bg-acid text-ink-950 font-semibold hover:bg-lime-300 shadow-[0_0_26px_rgba(163,230,53,.24)] border border-lime-300/40",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-lg transition-all duration-200 whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-45",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({
  className,
  children,
  noCorners,
  glow,
}: {
  className?: string;
  children: ReactNode;
  noCorners?: boolean;
  glow?: "cyan" | "acid" | "violet" | "rose" | "none";
}) {
  const glowClass =
    glow === "cyan"
      ? "shadow-[0_0_40px_rgba(34,211,238,.08)]"
      : glow === "acid"
        ? "shadow-[0_0_40px_rgba(163,230,53,.08)]"
        : glow === "violet"
          ? "shadow-[0_0_40px_rgba(129,140,248,.08)]"
          : glow === "rose"
            ? "shadow-[0_0_40px_rgba(251,113,133,.08)]"
            : "";
  return <div className={cx("panel", !noCorners && "hud-corners", glowClass, className)}>{children}</div>;
}

export function Badge({ children, className, dot }: { children: ReactNode; className?: string; dot?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-5",
        className,
      )}
    >
      {dot ? <span className={cx("h-1.5 w-1.5 rounded-full", dot)} /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || {
    label: status,
    badge: "border-slate-500/30 bg-slate-500/10 text-slate-400",
    dot: "bg-slate-500",
  };
  return (
    <Badge className={meta.badge} dot={meta.dot}>
      {meta.label}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: string }) {
  const meta = TASK_STATUS_META[status] || {
    label: status,
    badge: "border-slate-500/30 bg-slate-500/10 text-slate-400",
    dot: "bg-slate-500",
  };
  return (
    <Badge className={meta.badge} dot={meta.dot}>
      {meta.label}
    </Badge>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        {hint ? <span className="text-[10px] text-slate-500">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("input-base", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx("input-base appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "inline-flex items-center gap-2 text-xs transition-opacity disabled:opacity-40",
        disabled && "cursor-not-allowed",
      )}
    >
      <span
        className={cx(
          "relative h-5 w-9 rounded-full border transition-colors duration-200",
          checked ? "border-cyan/50 bg-cyan/25" : "border-edge bg-white/[0.04]",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-200",
            checked ? "left-[18px] bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,.7)]" : "left-0.5 bg-slate-500",
          )}
        />
      </span>
      {label ? <span className={checked ? "text-slate-200" : "text-slate-500"}>{label}</span> : null}
    </button>
  );
}

export function Progress({
  value,
  tone = "cyan",
  className,
}: {
  value: number;
  tone?: "cyan" | "acid" | "amber" | "rose" | "violet" | "slate";
  className?: string;
}) {
  const toneClass = {
    cyan: "bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,.6)]",
    acid: "bg-acid shadow-[0_0_12px_rgba(163,230,53,.55)]",
    amber: "bg-amber shadow-[0_0_12px_rgba(245,158,11,.55)]",
    rose: "bg-rose shadow-[0_0_12px_rgba(251,113,133,.55)]",
    violet: "bg-violet shadow-[0_0_12px_rgba(129,140,248,.55)]",
    slate: "bg-slate-500",
  }[tone];
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div
        className={cx("h-full rounded-full transition-all duration-500", toneClass)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx("animate-spin text-cyan-400", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <div className="text-slate-600">{icon}</div> : null}
      <div className="display-title text-sm text-slate-300">{title}</div>
      {description ? <div className="max-w-md text-xs leading-6 text-slate-400">{description}</div> : null}
      {action}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cx(
          "panel hud-corners relative w-full animate-rise overflow-hidden shadow-[0_30px_120px_rgba(0,0,0,.6)]",
          width,
        )}
      >
        <div className="flex items-start justify-between border-b border-edge px-5 py-4">
          <div>
            <div className="display-title text-base text-white">{title}</div>
            {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cx(
          "panel relative h-full w-full animate-rise overflow-hidden rounded-none border-y-0 border-r-0 shadow-[-30px_0_80px_rgba(0,0,0,.5)]",
          width,
        )}
      >
        <div className="flex items-start justify-between border-b border-edge px-5 py-4">
          <div>
            <div className="display-title text-base text-white">{title}</div>
            {subtitle ? <div className="mt-1 text-xs text-slate-500">{subtitle}</div> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="h-[calc(100%-65px)] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("inline-flex items-center gap-1 rounded-lg border border-edge bg-white/[0.025] p-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-all",
            value === tab.value
              ? "bg-cyan/15 text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,.2)]"
              : "text-slate-500 hover:text-slate-300",
          )}
        >
          {tab.label}
          {tab.count != null ? (
            <span
              className={cx(
                "rounded px-1 text-[10px]",
                value === tab.value ? "bg-cyan/20 text-cyan-200" : "bg-white/[0.06] text-slate-500",
              )}
            >
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Toasts ----------------------------- */

type ToastType = "success" | "error" | "info";
interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

const ToastContext = createContext<{ push: (type: ToastType, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 4600);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="fixed bottom-5 right-5 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={cx(
                "panel flex items-start gap-3 px-4 py-3 text-xs animate-rise",
                item.type === "success" && "border-acid/30",
                item.type === "error" && "border-rose/40",
                item.type === "info" && "border-cyan/30",
              )}
            >
              <span
                className={cx(
                  "mt-0.5",
                  item.type === "success" && "text-acid",
                  item.type === "error" && "text-rose",
                  item.type === "info" && "text-cyan-400",
                )}
              >
                {item.type === "success" ? (
                  <Check size={15} />
                ) : item.type === "error" ? (
                  <AlertTriangle size={15} />
                ) : (
                  <Info size={15} />
                )}
              </span>
              <span className="flex-1 leading-5 text-slate-300">{item.message}</span>
              <button
                className="text-slate-600 transition-colors hover:text-white"
                onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

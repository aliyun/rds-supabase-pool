import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../lib/auth";
import { PoolMark } from "../components/Layout";
import { Button, Field, Input } from "../components/ui";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(username, password);
      navigate(user.role === "user" ? "/portal" : "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="PLATFORM ACCESS"
      title="登录资源池控制台"
      description="管理员管理地域、资源池与账号；使用者进入独立门户申请和使用 Supabase 实例。"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field label="用户名">
          <div className="relative">
            <UserRound
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="密码">
          <div className="relative">
            <LockKeyhole
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              className="pl-9 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition-colors hover:text-slate-300"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        {error ? (
          <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          icon={<ArrowRight size={14} />}
          loading={submitting}
          disabled={!username.trim() || !password}
        >
          登录
        </Button>
        <div className="text-center text-[10px] leading-5 text-slate-500">
          使用者账号由管理员创建。忘记密码请联系资源管理员重置。
        </div>
      </form>
    </AuthShell>
  );
}

export function BootstrapPage() {
  const { bootstrap } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await bootstrap(username, password, displayName);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="FIRST RUN / ADMIN BOOTSTRAP"
      title="初始化平台管理员"
      description="控制面元数据库已就绪。创建第一个管理员账号后，控制台与使用者门户将统一走平台登录。"
      badge="仅首次可用"
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="管理员用户名">
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </Field>
          <Field label="显示名称" hint="可选">
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如：资源管理员"
            />
          </Field>
        </div>
        <Field label="密码" hint="至少 8 位">
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition-colors hover:text-slate-300"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        <Field label="确认密码">
          <Input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {error ? (
          <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          icon={<ShieldCheck size={14} />}
          loading={submitting}
          disabled={!username.trim() || password.length < 8 || password !== confirm}
        >
          创建管理员并进入控制台
        </Button>
        <div className="text-center text-[10px] leading-5 text-slate-500">
          创建完成后，管理员可在「平台账号」中创建使用者账号。
        </div>
      </form>
    </AuthShell>
  );
}

function AuthShell({
  eyebrow,
  title,
  description,
  badge,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(34,211,238,.10),transparent_35%),radial-gradient(circle_at_82%_75%,rgba(129,140,248,.10),transparent_38%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(148,163,184,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.15)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-2xl border border-edge bg-ink-900/85 shadow-[0_40px_160px_rgba(0,0,0,.65)] backdrop-blur-xl lg:grid-cols-[1.05fr_.95fr]">
        <div className="hidden flex-col justify-between border-r border-edge bg-white/[0.015] p-10 lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <PoolMark />
              <div>
                <div className="display-title text-lg font-semibold tracking-wide text-white">POOL CONTROL</div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500">RDS Supabase</div>
              </div>
            </div>
            <div className="mt-12">
              <div className="label-eyebrow">COLD / HOT POOL</div>
              <h2 className="display-title mt-3 text-3xl font-semibold leading-tight text-white">
                一份资源，
                <br />
                两套角色边界。
              </h2>
              <p className="mt-4 max-w-sm text-xs leading-6 text-slate-400">
                管理员持有阿里云资源控制权限；使用者不接触云账号，只通过平台门户申请和归还实例。删除操作始终只属于管理员。
              </p>
            </div>
          </div>
          <div className="grid gap-3">
            {[
              { icon: ShieldCheck, title: "管理员", detail: "地域、资源池、账号与实例生命周期" },
              { icon: KeyRound, title: "使用者", detail: "按地域自助申请、连接与归还" },
              { icon: LockKeyhole, title: "权限边界", detail: "使用者无删除权限，也看不到云凭证" },
            ].map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-3 rounded-xl border border-edge bg-white/[0.02] px-4 py-3"
              >
                <item.icon size={15} className="mt-0.5 text-cyan-400" />
                <div>
                  <div className="text-[11px] text-slate-200">{item.title}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-7 sm:p-10">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5">
              <PoolMark />
              <div className="display-title text-sm text-white">POOL CONTROL</div>
            </div>
            {badge ? <BadgeLike>{badge}</BadgeLike> : null}
          </div>
          <div className="label-eyebrow">{eyebrow}</div>
          <h1 className="display-title mt-2 text-2xl font-semibold text-white">{title}</h1>
          <p className="mt-2 text-xs leading-6 text-slate-500">{description}</p>
          {badge ? (
            <div className="mt-4 hidden lg:block">
              <BadgeLike>{badge}</BadgeLike>
            </div>
          ) : null}
          <div className="mt-7">{children}</div>
          <div className="mt-8 border-t border-edge pt-4 text-[10px] text-slate-600">
            平台账号与密码仅保存在控制面数据库，密码使用 PBKDF2 哈希，不会回显明文。
          </div>
        </div>
      </div>
    </div>
  );
}

function BadgeLike({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-amber/30 bg-amber/[0.07] px-2.5 py-1 text-[10px] text-amber">
      {children}
    </span>
  );
}

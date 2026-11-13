import { useEffect, useMemo, useState, type ReactNode } from "react";
import { KeyRound, Plus, RefreshCw, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cx, formatDateTime, relativeTime } from "../lib/format";
import type { PlatformRole, PlatformUser } from "../lib/types";
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
  Toggle,
  useToast,
} from "../components/ui";

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const { push } = useToast();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PlatformUser | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listPlatformUsers();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(
    () => ({
      admin: users.filter((item) => item.role === "admin").length,
      user: users.filter((item) => item.role === "user").length,
      enabled: users.filter((item) => item.enabled).length,
    }),
    [users],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-eyebrow">PLATFORM / IDENTITY</div>
          <h1 className="display-title mt-1 text-2xl font-semibold text-white">平台账号</h1>
          <p className="mt-1 text-xs text-slate-500">
            管理员使用完整控制台；使用者只能进入独立门户申请和归还实例，不能访问云资源管理、成本或删除能力。
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
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            创建账号
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="管理员" value={counts.admin} icon={<ShieldCheck size={15} />} tone="cyan" />
        <Summary label="使用者" value={counts.user} icon={<UserRound size={15} />} tone="violet" />
        <Summary
          label="启用账号"
          value={`${counts.enabled} / ${users.length}`}
          icon={<UsersRound size={15} />}
          tone="acid"
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">{error}</div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div className="display-title text-sm text-slate-200">账号列表</div>
          <span className="text-[10px] text-slate-500">密码仅保存 PBKDF2 哈希，编辑时不回显</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={22} />
          </div>
        ) : users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-normal">账号</th>
                  <th className="px-3 py-2.5 font-normal">角色</th>
                  <th className="px-3 py-2.5 font-normal">状态</th>
                  <th className="px-3 py-2.5 font-normal">最近登录</th>
                  <th className="px-3 py-2.5 font-normal">创建时间</th>
                  <th className="px-3 py-2.5 text-right font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id} className="border-t border-edge/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cx(
                            "flex h-7 w-7 items-center justify-center rounded-md border",
                            item.role === "admin"
                              ? "border-cyan/20 bg-cyan/[0.05] text-cyan-300"
                              : "border-violet/20 bg-violet/[0.05] text-violet",
                          )}
                        >
                          {item.role === "admin" ? <ShieldCheck size={13} /> : <UserRound size={13} />}
                        </span>
                        <div>
                          <div className="flex items-center gap-1.5 text-[12px] text-slate-200">
                            {item.display_name}
                            {currentUser?.id === item.id ? (
                              <Badge className="border-edge bg-white/[0.03] text-slate-400">当前账号</Badge>
                            ) : null}
                          </div>
                          <div className="mono text-[10px] text-slate-600">{item.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        className={
                          item.role === "admin"
                            ? "border-cyan/25 bg-cyan/[0.07] text-cyan-300"
                            : "border-violet/25 bg-violet/[0.07] text-violet"
                        }
                      >
                        {item.role === "admin" ? "管理员" : "使用者"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <span className={item.enabled ? "text-acid" : "text-slate-500"}>
                        {item.enabled ? "启用" : "已停用"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[10px] text-slate-500">
                      {item.last_login_at ? relativeTime(item.last_login_at) : "从未登录"}
                    </td>
                    <td className="px-3 py-3 text-[10px] text-slate-500">{formatDateTime(item.created_at)}</td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<KeyRound size={12} />}
                        onClick={() => setEditTarget(item)}
                      >
                        编辑
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<UsersRound size={26} />}
            title="还没有平台账号"
            description="创建使用者账号后，他们即可登录独立门户申请实例。"
            action={
              <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setCreateOpen(true)}>
                创建账号
              </Button>
            }
          />
        )}
      </Card>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />
      {editTarget ? (
        <EditUserModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { push } = useToast();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<PlatformRole>("user");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.createPlatformUser({ username, display_name: displayName, password, role });
      push("success", "账号已创建");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="创建平台账号"
      subtitle="使用者账号无需阿里云权限，只能进入资源门户"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            loading={saving}
            disabled={!username.trim() || password.length < 8}
            onClick={() => void submit()}
          >
            创建账号
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="用户名" hint="登录名，3~40 位">
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="例如 alice"
              autoComplete="off"
            />
          </Field>
          <Field label="显示名称" hint="可选">
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如 应用开发者"
            />
          </Field>
        </div>
        <Field label="初始密码" hint="至少 8 位，创建后请通知本人修改">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="角色">
          <Select value={role} onChange={(event) => setRole(event.target.value as PlatformRole)}>
            <option value="user">使用者 · 仅资源门户</option>
            <option value="admin">管理员 · 完整控制台</option>
          </Select>
        </Field>
        {error ? (
          <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5 text-[10px] leading-5 text-slate-500">
          使用者不能访问管理端 API、成本或任务日志；也不能删除实例，只能归还给原应用复用。
        </div>
      </div>
    </Modal>
  );
}

function EditUserModal({
  target,
  onClose,
  onSaved,
}: {
  target: PlatformUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [displayName, setDisplayName] = useState(target.display_name);
  const [role, setRole] = useState<PlatformRole>(target.role);
  const [enabled, setEnabled] = useState(target.enabled);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updatePlatformUser(target.id, {
        display_name: displayName,
        role,
        enabled,
        ...(password ? { password } : {}),
      });
      push("success", "账号已更新；角色、状态或密码变更会使该账号现有登录失效");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="编辑平台账号"
      subtitle={`${target.username} · ${target.role === "admin" ? "管理员" : "使用者"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={password.length > 0 && password.length < 8}
            onClick={() => void submit()}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="显示名称">
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </Field>
        <Field label="角色">
          <Select value={role} onChange={(event) => setRole(event.target.value as PlatformRole)}>
            <option value="user">使用者 · 仅资源门户</option>
            <option value="admin">管理员 · 完整控制台</option>
          </Select>
        </Field>
        <div className="flex items-center justify-between rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5">
          <div>
            <div className="text-[11px] text-slate-300">允许登录</div>
            <div className="mt-0.5 text-[10px] text-slate-500">停用后现有会话立即失效</div>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
        <Field label="重置密码" hint="留空表示不修改；至少 8 位">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="可选"
          />
        </Field>
        {error ? (
          <div className="rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Summary({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone: "cyan" | "violet" | "acid";
}) {
  const toneClass = { cyan: "text-cyan-300", violet: "text-violet", acid: "text-acid" }[tone];
  const borderClass = {
    cyan: "border-cyan/20 bg-cyan/[0.04]",
    violet: "border-violet/20 bg-violet/[0.04]",
    acid: "border-acid/20 bg-acid/[0.04]",
  }[tone];
  return (
    <Card className="p-4">
      <div
        className={cx("flex items-center gap-2 rounded-lg border px-2 py-1 text-[10px] w-fit", borderClass, toneClass)}
      >
        {icon}
        {label}
      </div>
      <div className={cx("display-title mt-2 text-2xl font-semibold", toneClass)}>{value}</div>
    </Card>
  );
}

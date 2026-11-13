import { useState, type FormEvent } from "react";
import { KeyRound, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button, Field, Input, Modal, useToast } from "./ui";

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout, changePassword } = useAuth();
  const { push } = useToast();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(oldPassword, newPassword);
      push("success", "密码已更新");
      setPasswordOpen(false);
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 rounded-lg border border-edge bg-white/[0.02] px-2 py-1">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan/[0.08] text-cyan-300">
          {user.role === "admin" ? <ShieldCheck size={12} /> : <UserRound size={12} />}
        </span>
        {!compact ? (
          <div className="min-w-0 leading-tight">
            <div className="max-w-[110px] truncate text-[11px] text-slate-200">{user.display_name}</div>
            <div className="text-[9px] text-slate-500">{user.role === "admin" ? "管理员" : "使用者"}</div>
          </div>
        ) : null}
        <button
          title="修改密码"
          onClick={() => setPasswordOpen(true)}
          className="rounded p-1 text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
        >
          <KeyRound size={13} />
        </button>
        <button
          title="退出登录"
          onClick={() => void logout()}
          className="rounded p-1 text-slate-500 transition-colors hover:bg-rose/[0.08] hover:text-rose"
        >
          <LogOut size={13} />
        </button>
      </div>

      <Modal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="修改登录密码"
        subtitle={`${user.username} · ${user.role === "admin" ? "管理员" : "使用者"}`}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              form="change-password-form"
              variant="primary"
              loading={saving}
              disabled={!oldPassword || newPassword.length < 8 || newPassword !== confirm}
            >
              保存新密码
            </Button>
          </>
        }
      >
        <form id="change-password-form" onSubmit={(event) => void submitPassword(event)} className="space-y-4">
          <Field label="原密码">
            <Input
              type="password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="新密码" hint="至少 8 位">
            <Input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="确认新密码">
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
        </form>
      </Modal>
    </>
  );
}

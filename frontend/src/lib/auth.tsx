import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { AuthStatus, PlatformUser } from "./types";

interface AuthContextValue {
  status: AuthStatus | null;
  user: PlatformUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<AuthStatus | null>;
  login: (username: string, password: string) => Promise<PlatformUser>;
  bootstrap: (username: string, password: string, displayName: string) => Promise<PlatformUser>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.authStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener("pool-console:unauthorized", handler);
    return () => window.removeEventListener("pool-console:unauthorized", handler);
  }, [refresh]);

  useEffect(() => {
    if (!status || status.configured) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login({ username, password });
    setStatus({
      configured: true,
      users_ready: true,
      bootstrap_required: false,
      authenticated: true,
      user: result.user,
    });
    setError(null);
    return result.user;
  }, []);

  const bootstrap = useCallback(async (username: string, password: string, displayName: string) => {
    const result = await api.bootstrapAdmin({ username, password, display_name: displayName });
    setStatus({
      configured: true,
      users_ready: true,
      bootstrap_required: false,
      authenticated: true,
      user: result.user,
    });
    setError(null);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setStatus((current) =>
        current
          ? { ...current, authenticated: false, user: null }
          : { configured: true, users_ready: true, bootstrap_required: false, authenticated: false, user: null },
      );
    }
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const result = await api.changePassword({ old_password: oldPassword, new_password: newPassword });
    setStatus((current) => (current ? { ...current, authenticated: true, user: result.user } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status?.user ?? null,
      loading,
      error,
      refresh,
      login,
      bootstrap,
      logout,
      changePassword,
    }),
    [status, loading, error, refresh, login, bootstrap, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

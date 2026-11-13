import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, API_BASE } from "./api";
import type { ApiLog, GlobalOverview, Instance, MetaInfo, Overview, Region, TaskRecord } from "./types";

const REGION_KEY = "pool-console.region-id";

interface AppData {
  overview: Overview | null;
  meta: MetaInfo | null;
  instances: Instance[];
  tasks: TaskRecord[];
  logs: ApiLog[];
  regions: Region[];
  regionId: string;
  region: Region | null;
  globalOverview: GlobalOverview | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  connected: boolean;
  lastUpdated: string | null;
  refreshOverview: () => Promise<void>;
  refreshOperational: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshRegions: () => Promise<Region[]>;
  refreshGlobal: () => Promise<void>;
  setRegion: (regionId: string) => void;
  setOverview: (value: Overview | null) => void;
}

const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState(() => window.localStorage.getItem(REGION_KEY) || "");
  const [globalOverview, setGlobalOverview] = useState<GlobalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const configuredRef = useRef(false);
  const regionIdRef = useRef(regionId);
  const lastOperationalFetch = useRef(0);

  regionIdRef.current = regionId;

  const setRegion = useCallback((next: string) => {
    setRegionId(next);
    if (next) window.localStorage.setItem(REGION_KEY, next);
    else window.localStorage.removeItem(REGION_KEY);
  }, []);

  const refreshRegions = useCallback(async () => {
    try {
      const data = await api.regions();
      setRegions(data.regions);
      return data.regions;
    } catch {
      setRegions([]);
      return [];
    }
  }, []);

  const refreshOverview = useCallback(async () => {
    try {
      const data = await api.overview(regionIdRef.current || undefined);
      configuredRef.current = data.configured;
      setOverview(data);
      setLastUpdated(new Date().toISOString());
      setError(null);
      if (data.region_id && data.region_id !== regionIdRef.current) {
        setRegion(data.region_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [setRegion]);

  const refreshOperational = useCallback(async () => {
    if (!configuredRef.current) return;
    const now = Date.now();
    if (now - lastOperationalFetch.current < 1800) return;
    lastOperationalFetch.current = now;
    const scope = regionIdRef.current || undefined;
    try {
      const [instanceData, taskData, logData] = await Promise.all([
        api.listInstances({ region_id: scope }),
        api.tasks({ limit: 120, region_id: scope }),
        api.logs(80, scope),
      ]);
      setInstances(instanceData.instances);
      setTasks(taskData.tasks);
      setLogs(logData.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshGlobal = useCallback(async () => {
    try {
      setGlobalOverview(await api.globalOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshRegions();
      await refreshOverview();
      await refreshOperational();
    } finally {
      setRefreshing(false);
    }
  }, [refreshOverview, refreshOperational, refreshRegions]);

  const initializedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const metaInfo = await api.meta();
        if (cancelled) return;
        setMeta(metaInfo);
        const available = await refreshRegions();
        const stored = window.localStorage.getItem(REGION_KEY) || "";
        const preferred =
          available.find((item) => item.region_id === stored)?.region_id || available[0]?.region_id || "";
        if (preferred) {
          setRegion(preferred);
          regionIdRef.current = preferred;
        }
        const ov = await api.overview(preferred || undefined);
        if (cancelled) return;
        configuredRef.current = ov.configured;
        setOverview(ov);
        setLastUpdated(new Date().toISOString());
        if (ov.region_id) {
          setRegion(ov.region_id);
          regionIdRef.current = ov.region_id;
        }
        if (ov.configured) {
          await refreshOperational();
        }
        initializedRef.current = true;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshOperational, refreshRegions, setRegion]);

  const lastLoadedRegion = useRef(regionId);
  useEffect(() => {
    if (!initializedRef.current || !regionId || regionId === lastLoadedRegion.current) return;
    lastLoadedRegion.current = regionId;
    lastOperationalFetch.current = 0;
    void refreshOverview();
    void refreshOperational();
  }, [regionId, refreshOverview, refreshOperational]);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallback: number | null = null;
    let debounce: number | null = null;

    const connect = () => {
      if (!configuredRef.current) return;
      const suffix = regionIdRef.current ? `?region_id=${encodeURIComponent(regionIdRef.current)}` : "";
      source = new EventSource(`${API_BASE}/stream${suffix}`);
      source.addEventListener("overview", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as Overview;
          if (regionIdRef.current && data.region_id && data.region_id !== regionIdRef.current) return;
          setOverview(data);
          setConnected(true);
          setLastUpdated(new Date().toISOString());
          configuredRef.current = data.configured;
          if (debounce) window.clearTimeout(debounce);
          debounce = window.setTimeout(() => {
            void refreshOperational();
          }, 900);
        } catch {
          /* ignore malformed frame */
        }
      });
      source.onerror = () => {
        setConnected(false);
        source?.close();
        source = null;
        if (fallback === null) {
          fallback = window.setInterval(() => {
            void refreshOverview();
          }, 5000);
        }
      };
    };

    connect();
    return () => {
      source?.close();
      if (fallback !== null) window.clearInterval(fallback);
      if (debounce !== null) window.clearTimeout(debounce);
    };
  }, [regionId, loading, refreshOperational, refreshOverview]);

  const region = useMemo(
    () => regions.find((item) => item.region_id === regionId) || overview?.region || null,
    [regions, regionId, overview],
  );

  const value = useMemo<AppData>(
    () => ({
      overview,
      meta,
      instances,
      tasks,
      logs,
      regions,
      regionId,
      region,
      globalOverview,
      loading,
      refreshing,
      error,
      connected,
      lastUpdated,
      refreshOverview,
      refreshOperational,
      refreshAll,
      refreshRegions,
      refreshGlobal,
      setRegion,
      setOverview,
    }),
    [
      overview,
      meta,
      instances,
      tasks,
      logs,
      regions,
      regionId,
      region,
      globalOverview,
      loading,
      refreshing,
      error,
      connected,
      lastUpdated,
      refreshOverview,
      refreshOperational,
      refreshAll,
      refreshRegions,
      refreshGlobal,
      setRegion,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used inside AppDataProvider");
  return ctx;
}

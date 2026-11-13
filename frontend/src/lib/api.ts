import type {
  ApiLog,
  AuditEvent,
  AuthInfo,
  AuthStatus,
  Capacity,
  DatabaseSizeInfo,
  EndpointsInfo,
  GlobalOverview,
  Instance,
  MetaInfo,
  MetadataStatus,
  Overview,
  PgInstance,
  PlatformRole,
  PlatformToken,
  PlatformUser,
  PoolCostOverview,
  PoolSettings,
  PortalInstance,
  PortalOverview,
  PreflightResult,
  Region,
  RegionPool,
  ResourceInfo,
  Settings,
  SetupJob,
  SharedPg,
  TaskRecord,
  VSwitch,
  Vpc,
} from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
    const code = (payload as { code?: string } | undefined)?.code;
    this.code = code;
  }
}

export const API_BASE = ((window as { __POOL_API_BASE__?: string }).__POOL_API_BASE__ || "/api").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "same-origin",
    ...init,
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    if ((response.status === 401 || response.status === 428) && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("pool-console:unauthorized"));
    }
    const detail =
      (payload as { detail?: string } | null)?.detail ||
      (typeof payload === "string" ? payload : `请求失败（HTTP ${response.status}）`);
    throw new ApiError(detail, response.status, payload);
  }
  return payload as T;
}

export const api = {
  authStatus: () => request<AuthStatus>("/auth/status"),
  login: (body: { username: string; password: string }) =>
    request<{ user: PlatformUser; token: string }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  bootstrapAdmin: (body: { username: string; password: string; display_name: string }) =>
    request<{ user: PlatformUser; token: string }>("/auth/bootstrap", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ logged_out: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<PlatformUser>("/auth/me"),
  changePassword: (body: { old_password: string; new_password: string }) =>
    request<{ user: PlatformUser; token: string }>("/auth/password", { method: "POST", body: JSON.stringify(body) }),

  listPlatformUsers: () => request<{ users: PlatformUser[] }>("/admin/users"),
  createPlatformUser: (body: { username: string; password: string; display_name?: string; role: PlatformRole }) =>
    request<PlatformUser>("/admin/users", { method: "POST", body: JSON.stringify(body) }),
  updatePlatformUser: (
    userId: string,
    body: { display_name?: string; password?: string; role?: PlatformRole; enabled?: boolean },
  ) =>
    request<PlatformUser>(`/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  portalOverview: () => request<PortalOverview>("/portal/overview"),
  portalApply: (body: { region_id: string; app_name: string; mode: "single" | "shared" }) =>
    request<{ task_id: string; instance_id: string; bound_app_id: string; app_name: string; region_id: string }>(
      "/portal/instances/apply",
      { method: "POST", body: JSON.stringify(body) },
    ),
  portalTokens: () => request<{ tokens: PlatformToken[]; scopes: string[] }>("/portal/tokens"),
  createPortalToken: (body: { name: string; scopes: string[]; expires_in_days: number }) =>
    request<PlatformToken & { token: string }>("/portal/tokens", { method: "POST", body: JSON.stringify(body) }),
  revokePortalToken: (tokenId: string) =>
    request<{ revoked: boolean; id: string }>(`/portal/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" }),
  portalRelease: (id: string) =>
    request<{ task_id: string; destroy: boolean }>(`/portal/instances/${id}/release`, { method: "POST" }),
  portalInstance: (id: string) => request<PortalInstance>(`/portal/instances/${id}`),
  portalEndpoints: (id: string) => request<EndpointsInfo>(`/portal/instances/${id}/endpoints`),
  portalAuthInfo: (id: string) => request<AuthInfo>(`/portal/instances/${id}/auth-info`),

  health: () => request<Record<string, unknown>>("/health"),
  meta: () => request<MetaInfo>("/meta"),
  overview: (regionId?: string) =>
    request<Overview>(`/overview${regionId ? `?region_id=${encodeURIComponent(regionId)}` : ""}`),
  globalOverview: () => request<GlobalOverview>("/overview/global"),

  regions: () => request<{ regions: Region[] }>("/regions"),
  createRegion: (body: { region_id: string; name: string; vpc_id: string; vswitch_id: string; zone_id?: string }) =>
    request<Region>("/regions", { method: "POST", body: JSON.stringify(body) }),
  updateRegion: (
    regionId: string,
    patch: Partial<Pick<Region, "name" | "enabled" | "portal_enabled" | "portal_pool_mode">>,
  ) => request<Region>(`/regions/${encodeURIComponent(regionId)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  pools: (regionId?: string) =>
    request<{ pools: RegionPool[] }>(`/pools${regionId ? `?region_id=${encodeURIComponent(regionId)}` : ""}`),
  updatePool: (
    poolId: string,
    patch: Partial<Pick<RegionPool, "name" | "enabled" | "vpc_id" | "vswitch_id" | "zone_id">> & {
      config?: PoolSettings;
    },
  ) => request<RegionPool>(`/pools/${encodeURIComponent(poolId)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  sharedPgs: (poolId: string) => request<{ shared_pgs: SharedPg[] }>(`/pools/${encodeURIComponent(poolId)}/shared-pgs`),
  addSharedPg: (poolId: string, body: { pg_instance_id: string; name?: string }) =>
    request<SharedPg>(`/pools/${encodeURIComponent(poolId)}/shared-pgs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createSharedPg: (
    poolId: string,
    body: { name?: string; instance_class?: string; storage_gb?: number; engine_version?: string; zone_id?: string },
  ) =>
    request<{ task_id: string; pool_id: string; name: string }>(
      `/pools/${encodeURIComponent(poolId)}/shared-pgs/create`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  updateSharedPg: (pgId: string, patch: { name?: string; enabled?: boolean; weight?: number }) =>
    request<SharedPg>(`/shared-pgs/${encodeURIComponent(pgId)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeSharedPg: (pgId: string, deleteCloud = false) =>
    request<{ removed: boolean; pg_instance_id: string; cloud_deleted: boolean }>(
      `/shared-pgs/${encodeURIComponent(pgId)}${deleteCloud ? "?delete_cloud=1" : ""}`,
      { method: "DELETE" },
    ),
  syncSharedPg: (pgId: string) => request<SharedPg>(`/shared-pgs/${encodeURIComponent(pgId)}/sync`, { method: "POST" }),

  poolCost: (month?: string, regionId?: string) => {
    const query = new URLSearchParams();
    if (month) query.set("month", month);
    if (regionId) query.set("region_id", regionId);
    return request<PoolCostOverview>(`/billing/pool-cost${query.toString() ? `?${query}` : ""}`);
  },
  getSettings: () =>
    request<{
      settings: Settings;
      credentials: unknown;
      mode: string;
      metadata: MetadataStatus;
      database: { configured: boolean };
    }>("/settings"),
  updateSettings: (patch: Partial<Settings> | Record<string, unknown>) =>
    request<{ settings: Settings; mode: string }>("/settings", { method: "PUT", body: JSON.stringify(patch) }),
  setMode: (mode: string) =>
    request<{ mode: string }>("/settings/mode", { method: "PUT", body: JSON.stringify({ mode }) }),
  preflight: () => request<PreflightResult>("/preflight", { method: "POST", body: "{}" }),

  metadataStatus: () => request<MetadataStatus>("/metadata/status"),
  testMetadata: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/metadata/test", { method: "POST", body: JSON.stringify(body) }),
  configureMetadata: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/metadata/configure", { method: "POST", body: JSON.stringify(body) }),
  autoCreateMetadata: (ip: string) =>
    request<SetupJob>("/metadata/auto-create", { method: "POST", body: JSON.stringify({ ip }) }),
  metadataJob: (jobId: string) => request<SetupJob>(`/metadata/jobs/${jobId}`),
  detectIp: () => request<{ ip: string; source: string }>("/network/my-ip"),
  discoverPgs: () => request<{ mode: string; pgs: PgInstance[] }>("/metadata/discover"),

  listInstances: (params?: {
    mode?: string;
    status?: string;
    include_deleted?: boolean;
    region_id?: string;
    pool_id?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.mode) query.set("mode", params.mode);
    if (params?.status) query.set("status", params.status);
    if (params?.include_deleted) query.set("include_deleted", "true");
    if (params?.region_id) query.set("region_id", params.region_id);
    if (params?.pool_id) query.set("pool_id", params.pool_id);
    return request<{ instances: Instance[] }>(`/instances${query.toString() ? `?${query}` : ""}`);
  },
  getInstance: (id: string) => request<Instance>(`/instances/${id}`),
  getEvents: (id: string) => request<{ events: AuditEvent[] }>(`/instances/${id}/events`),
  prewarm: (poolId: string, count: number) =>
    request<{ task_ids: string[]; count: number; pool_id: string }>("/instances/prewarm", {
      method: "POST",
      body: JSON.stringify({ pool_id: poolId, count }),
    }),
  allocate: (id: string, body: { app_name: string; user?: string }) =>
    request<{ task_id: string; instance_id: string; bound_app_id: string }>(`/instances/${id}/allocate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  release: (id: string, destroy?: boolean | null) =>
    request<{ task_id: string; destroy: boolean }>(`/instances/${id}/release`, {
      method: "POST",
      body: JSON.stringify({ destroy }),
    }),
  action: (id: string, action: string, force?: boolean) =>
    request<{ task_id: string; action: string }>(`/instances/${id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, force }),
    }),
  destroy: (id: string) => request<{ task_id: string }>(`/instances/${id}`, { method: "DELETE" }),
  endpoints: (id: string) => request<EndpointsInfo>(`/instances/${id}/endpoints`),
  authInfo: (id: string) => request<AuthInfo>(`/instances/${id}/auth-info`),
  resource: (id: string) => request<ResourceInfo>(`/instances/${id}/resource`),
  modifyResource: (id: string, body: Record<string, number | null>) =>
    request<{ instance_name: string; request_id: string }>(`/instances/${id}/resource`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  databaseSize: (id: string) => request<DatabaseSizeInfo>(`/instances/${id}/database-size`),

  capacity: (pgId?: string) =>
    request<{
      pg_id: string;
      region_id: string;
      pool_id: string | null;
      mode: string;
      capacity: Capacity | null;
      capacity_error?: string | null;
      stale?: boolean;
    }>(`/capacity${pgId ? `?pg_id=${encodeURIComponent(pgId)}` : ""}`),
  capacityOverview: (regionId?: string) =>
    request<{ region_id: string; pool_id: string | null; shared_pgs: SharedPg[]; aggregate: Capacity }>(
      `/capacity${regionId ? `?region_id=${encodeURIComponent(regionId)}` : ""}`,
    ),
  modifyCapacity: (activeRatio: number, pgId: string) =>
    request<{ pg_id: string; mode: string; capacity: Capacity; message: string }>("/capacity", {
      method: "PUT",
      body: JSON.stringify({ active_ratio: activeRatio, pg_id: pgId }),
    }),

  tasks: (params?: { status?: string; kind?: string; limit?: number; region_id?: string; pool_id?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.kind) query.set("kind", params.kind);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.region_id) query.set("region_id", params.region_id);
    if (params?.pool_id) query.set("pool_id", params.pool_id);
    return request<{ tasks: TaskRecord[] }>(`/tasks${query.toString() ? `?${query}` : ""}`);
  },
  task: (id: string) => request<TaskRecord>(`/tasks/${id}`),
  retryTask: (id: string) => request<{ task_id: string }>(`/tasks/${id}/retry`, { method: "POST" }),
  selfheal: () => request<{ task_id: string }>("/tasks/selfheal", { method: "POST" }),
  logs: (limit = 100, regionId?: string) =>
    request<{ logs: ApiLog[] }>(`/logs?limit=${limit}${regionId ? `&region_id=${encodeURIComponent(regionId)}` : ""}`),

  vpcs: (regionId?: string) =>
    request<{ mode: string; vpcs: Vpc[] }>(
      `/resources/vpcs${regionId ? `?region_id=${encodeURIComponent(regionId)}` : ""}`,
    ),
  vswitches: (vpcId: string, regionId?: string) =>
    request<{ mode: string; vswitches: VSwitch[] }>(
      `/resources/vswitches?vpc_id=${encodeURIComponent(vpcId)}${regionId ? `&region_id=${encodeURIComponent(regionId)}` : ""}`,
    ),
  pgs: (regionId?: string) =>
    request<{ mode: string; pgs: PgInstance[] }>(
      `/resources/pgs${regionId ? `?region_id=${encodeURIComponent(regionId)}` : ""}`,
    ),
  pgNet: (pgId: string, regionId?: string) =>
    request<Record<string, unknown>>(
      `/resources/pgs/${encodeURIComponent(pgId)}/net${regionId ? `?region_id=${encodeURIComponent(regionId)}` : ""}`,
    ),
};

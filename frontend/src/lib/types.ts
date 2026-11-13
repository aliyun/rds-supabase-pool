export type CloudMode = "real" | "mock";
export type PoolMode = "single" | "shared";

export interface PoolSettings {
  target: number;
  max: number;
  batch_size: number;
  batch_interval_sec: number;
  poll_interval_sec: number;
  create_timeout_sec: number;
  auto_refill: boolean;
  refill_interval_sec: number;
  release_policy: "return" | "destroy";
  stop_mode: "normal" | "force";
  single_pg_class: string;
  single_pg_storage: number;
  single_pg_category: string;
  single_engine_version: string;
  shared_pg_class: string;
  shared_pg_storage: number;
  shared_pg_category: string;
  shared_pg_engine_version: string;
  single_pg_security_ips: string;
  public_endpoint_enabled: boolean;
}

export interface MetadataPgSettings {
  pg_instance_id: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslmode: string;
  source: string;
  public_connection: string;
}

export interface Settings {
  region_id: string;
  zone_id: string;
  vpc_id: string;
  vswitch_id: string;
  shared_pg_id: string;
  mode: string;
  metadata_pg: MetadataPgSettings;
  pool: PoolSettings;
}

export interface MetadataStatus {
  configured: boolean;
  dialect: string;
  database_url: string;
  host: string;
  port: number;
  database: string;
  username: string;
  pg_instance_id: string;
  source: string;
  public_connection: string;
  schema_ready: boolean;
  error?: string;
}

export interface CredentialStatus {
  has_credentials: boolean;
  source: string;
  masked_access_key_id: string;
  can_override?: boolean;
}

export interface CloudIdentity {
  account_id: string;
  arn: string;
  user_id: string;
  verified_at: string;
  source: string;
}

export interface PoolCostItem {
  pg_instance_id: string;
  pool_id: string;
  pool_name: string;
  region_id: string;
  region_name: string;
  mode: "single" | "shared" | "metadata";
  role: string;
  label: string;
  pool_status: string;
  deleted: boolean;
  spec: string;
  region: string;
  currency: string;
  pretax_amount: number;
  payment_amount: number;
  payg_amount: number;
  subscription_amount: number;
  storage_amount: number;
  compute_amount: number;
  other_amount: number;
  billing_type: "payg" | "subscription" | "mixed" | "unknown" | "none";
  found: boolean;
}

export interface PoolCostOverview {
  available: boolean;
  reason?: string;
  message?: string;
  month: string;
  region_id?: string;
  account_id?: string;
  currency?: string;
  total_pretax?: number;
  total_payment?: number;
  payg_total?: number;
  subscription_total?: number;
  pg_count?: number;
  items?: PoolCostItem[];
  errors?: string[];
  fetched_at?: string;
  notes?: string;
}

export interface PoolSummary {
  id?: string | null;
  name?: string;
  enabled?: boolean;
  mode: PoolMode;
  target: number;
  max: number;
  total: number;
  by_status: Record<string, number>;
  cold: number;
  reserved: number;
  in_use: number;
  creating: number;
  failed: number;
}

export interface RegionPool extends PoolSummary {
  id: string;
  region_id: string;
  name: string;
  enabled: boolean;
  vpc_id: string;
  vswitch_id: string;
  zone_id: string;
  config: PoolSettings;
  shared_pg_count: number;
}

export interface Region {
  region_id: string;
  name: string;
  enabled: boolean;
  portal_enabled: boolean;
  portal_pool_mode: PoolMode | "both";
  created_at: string | null;
  pools: RegionPool[];
}

export interface SharedPg {
  pg_instance_id: string;
  pool_id: string | null;
  name: string;
  region_id: string;
  status: string;
  instance_class: string;
  engine_version: string;
  storage_gb: number | null;
  vpc_id: string;
  vswitch_id: string;
  zone_id: string;
  enabled: boolean;
  weight: number;
  reserved_slots: number;
  tenant_count: number;
  active_tenant_count?: number;
  capacity: Capacity;
  last_checked_at: string | null;
  added_at: string | null;
}

export interface GlobalRegionSummary {
  region_id: string;
  name: string;
  enabled: boolean;
  pools: Record<PoolMode, PoolSummary>;
  shared_pgs: SharedPg[];
  capacity: Capacity;
  instance_total: number;
  alerts: Alert[];
}

export interface GlobalOverview {
  configured?: boolean;
  regions: GlobalRegionSummary[];
  totals: {
    region_count: number;
    instance_total: number;
    cold: number;
    in_use: number;
    failed: number;
    shared_pg_count: number;
    estimated_max_active_tenants: number;
    estimated_max_total_tenants: number;
    current_active_tenants: number;
    current_total_tenants: number;
  };
  fetched_at?: string;
}

export interface Capacity {
  db_instance_name: string;
  active_ratio: number;
  estimated_max_active_tenants: number;
  estimated_max_total_tenants: number;
  current_active_tenants: number;
  current_total_tenants: number;
  message?: string;
}

export interface Alert {
  level: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface Overview {
  configured: boolean;
  cloud_mode: CloudMode;
  credentials: CredentialStatus;
  database: MetadataStatus;
  settings: Settings;
  alerts: Alert[];
  region?: Region | null;
  region_id?: string;
  pools: Record<PoolMode, PoolSummary>;
  shared_pgs?: SharedPg[];
  capacity_cached?: Capacity;
  recent_tasks: TaskRecord[];
  instance_total?: number;
}

export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export type PlatformRole = "admin" | "user";

export interface PlatformUser {
  id: string;
  username: string;
  display_name: string;
  role: PlatformRole;
  enabled: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

export interface AuthStatus {
  configured: boolean;
  users_ready: boolean;
  bootstrap_required: boolean;
  authenticated: boolean;
  user: PlatformUser | null;
}

export interface PortalRegionPool {
  mode: PoolMode;
  mode_label: string;
  pool_id: string;
  pool_name: string;
  cold: number;
  reserved: number;
  available: number;
  in_use: number;
  target: number;
  max: number;
}

export interface PortalRegion {
  region_id: string;
  name: string;
  pools: PortalRegionPool[];
  available: number;
  cold: number;
  in_use: number;
  target: number;
}

export interface PortalInstance {
  id: string;
  app_name: string;
  resource_name?: string;
  status: string;
  mode: PoolMode;
  region_id: string;
  region_name: string;
  pool_id: string | null;
  pool_name: string;
  supabase_instance_id: string | null;
  bound_app_id: string | null;
  bound_user: string | null;
  reserved: boolean;
  reserved_app_name: string | null;
  public_connection: string | null;
  vpc_connection: string | null;
  cloud_status: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PortalOverview {
  user: PlatformUser;
  regions: PortalRegion[];
  instances: PortalInstance[];
  active_count: number;
  fetched_at: string;
}

export interface PlatformToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
}

export interface TaskRecord {
  id: string;
  kind: string;
  mode: string;
  pool_id: string | null;
  target_id: string | null;
  title: string;
  status: TaskStatus;
  progress: number;
  message: string | null;
  result: Record<string, unknown>;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
}

export interface InstanceComponent {
  type: string;
  status: string;
}

export interface InstanceCloud {
  instance_name?: string;
  app_name?: string;
  instance_class?: string;
  instance_minor_version?: string;
  status?: string;
  db_instance_name?: string;
  region_id?: string;
  zone_id?: string;
  vswitch_id?: string;
  eip_status?: string;
  nat_status?: string;
}

export interface InstanceDetail {
  source?: string;
  cloud_mode?: CloudMode;
  cloud?: InstanceCloud;
  components?: InstanceComponent[];
  bound_app_name?: string;
  reserved?: boolean;
  reserved_app_name?: string;
  [key: string]: unknown;
}

export interface Instance {
  id: string;
  mode: PoolMode;
  pool_id: string | null;
  owner_user_id?: string | null;
  status: string;
  app_name: string;
  bound_app_id: string | null;
  bound_user: string | null;
  region_id: string;
  vpc_id: string | null;
  vswitch_id: string | null;
  pg_instance_id: string | null;
  supabase_instance_id: string | null;
  instance_class: string;
  cloud_status: string | null;
  vpc_connection: string | null;
  public_connection: string | null;
  error: string | null;
  detail: InstanceDetail;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  deleted_at: string | null;
  age_seconds: number;
}

export interface AuditEvent {
  id: number;
  action: string;
  message: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ApiLog {
  id: number;
  action: string;
  product: string;
  region: string;
  request_id: string;
  success: boolean;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number;
  params: Record<string, unknown>;
  created_at: string;
}

export interface PgInstance {
  pg_instance_id: string;
  description: string;
  status: string;
  instance_class: string;
  engine_version: string;
  storage_gb: number;
  vpc_id: string;
  vswitch_id: string;
  zone_id: string;
  region_id: string;
  connection_string?: string;
  port?: string;
}

export interface Vpc {
  vpc_id: string;
  name: string;
  cidr: string;
  status: string;
  region_id: string;
}

export interface VSwitch {
  vswitch_id: string;
  name: string;
  zone_id: string;
  cidr: string;
  available_ips: number;
  vpc_id: string;
}

export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  detail: Record<string, unknown>;
}

export interface PreflightResult {
  mode: CloudMode;
  checks: CheckResult[];
  summary: { pass: number; warn: number; fail: number };
}

export interface EndpointsInfo {
  instance_name: string;
  instance_endpoints: { connection_string: string; ip: string; port: string; ip_type: string }[];
}

export interface AuthInfo {
  instance_name: string;
  jwt_secret: string;
  api_keys: { anon_key: string; service_key: string };
  config_list: { name: string; value: string }[];
}

export interface ResourceInfo {
  instance_name: string;
  app_type: string;
  status: string;
  cpu_cores: number;
  memory_size_gb: number;
  share_mode: boolean;
  authenticator_conn_limit?: number;
  auth_admin_conn_limit?: number;
  realtime_conn_limit?: number;
  admin_conn_limit?: number;
}

export interface DatabaseSizeInfo {
  instance_name: string;
  database_name: string;
  database_size_bytes: number;
  database_size_human: string;
}

export interface SetupJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at?: string;
}

export interface MetaInfo {
  statuses: { value: string; label: string }[];
  modes: { value: PoolMode; label: string }[];
  cloud_modes: { value: CloudMode; label: string }[];
  release_policies: { value: string; label: string }[];
  stop_modes: { value: string; label: string }[];
  task_kinds: { value: string; label: string }[];
  cpu_options: number[];
}

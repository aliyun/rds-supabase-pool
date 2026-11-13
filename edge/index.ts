// @ts-nocheck
import postgres from "npm:postgres@3.4.5";

const ENV_CONTROL_DB_URL = Deno.env.get("CONTROL_DB_URL")!;
let activeControlDbUrl = ENV_CONTROL_DB_URL;
let sql = postgres(activeControlDbUrl, { max: 1, prepare: false });
const JWT_SECRET = Deno.env.get("PLATFORM_JWT_SECRET") || "";
if (!JWT_SECRET) throw new Error("PLATFORM_JWT_SECRET 未配置");
let CLOUD_MODE = Deno.env.get("CLOUD_MODE") || "mock";
const TOKEN_TTL = 7 * 24 * 3600;
const SCOPES = ["instances:read", "instances:apply", "instances:release", "credentials:read"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extra } });
}

function error(detail: string, status = 400) {
  return json({ detail }, status);
}

function b64urlEncode(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let value = "";
  for (const byte of raw) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, iterationsText, saltText, expectedText] = encoded.split("$", 4);
    if (algorithm !== "pbkdf2_sha256") return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: b64urlDecode(saltText),
        iterations: Number(iterationsText),
      },
      key,
      256,
    );
    const actual = b64urlEncode(new Uint8Array(bits));
    return actual === expectedText;
  } catch {
    return false;
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 260000 },
    key,
    256,
  );
  return `pbkdf2_sha256$260000$${b64urlEncode(salt)}$${b64urlEncode(new Uint8Array(bits))}`;
}

async function configCryptoKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${JWT_SECRET}:platform-config`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptConfig(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await configCryptoKey();
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(cipher))}`;
}

async function decryptConfig(value: string): Promise<string> {
  if (!value.startsWith("v1.")) return value;
  const [, ivText, dataText] = value.split(".");
  const key = await configCryptoKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(ivText) },
    key,
    b64urlDecode(dataText),
  );
  return new TextDecoder().decode(plain);
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncode(JSON.stringify(payload));
  const message = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return `${message}.${b64urlEncode(new Uint8Array(signature))}`;
}

async function verifyJwt(token: string): Promise<Record<string, any> | null> {
  try {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(signature),
      new TextEncoder().encode(`${header}.${body}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function publicUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    role: row.role,
    enabled: row.enabled,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function authenticate(req: Request): Promise<{ user: any; scopes: string[] | null } | null> {
  const authorization = req.headers.get("authorization") || "";
  const headerToken = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const cookie = req.headers.get("cookie") || "";
  const cookieToken = cookie.match(/(?:^|;\s*)pool_console_token=([^;]+)/)?.[1] || "";
  const token = headerToken || cookieToken;
  if (!token) return null;
  if (token.startsWith("pctl_")) {
    const rest = token.slice(5);
    const split = rest.indexOf("_");
    if (split < 1) return null;
    const prefix = rest.slice(0, split);
    const hash = await sha256(token);
    const rows = await sql`
      select t.id, t.user_id, t.scopes, t.expires_at, t.revoked_at,
             u.id, u.username, u.display_name, u.role, u.enabled, u.token_version, u.created_at, u.last_login_at
      from platform_tokens t
      join platform_users u on u.id = t.user_id
      where t.prefix = ${prefix} and t.token_hash = ${hash}
      limit 1
    `;
    const row: any = rows[0];
    if (!row || row.revoked_at || !row.enabled || (row.expires_at && new Date(row.expires_at) <= new Date())) return null;
    await sql`update platform_tokens set last_used_at = now() where id = ${row.id}`;
    return { user: publicUser(row), scopes: parseScopes(row.scopes) };
  }
  const payload = await verifyJwt(token);
  if (!payload) return null;
  const rows = await sql`select * from platform_users where id = ${payload.sub} and enabled = true limit 1`;
  const row: any = rows[0];
  if (!row) return null;
  if (Number(row.token_version || 0) !== Number(payload.ver || 0)) return null;
  return { user: publicUser(row), scopes: null };
}

function hasScope(ctx: { scopes: string[] | null } | null, scope: string): boolean {
  return !!ctx && (ctx.scopes === null || ctx.scopes.includes(scope));
}

async function requireAdmin(req: Request) {
  const ctx = await authenticate(req);
  if (!ctx || ctx.scopes !== null || ctx.user.role !== "admin") return null;
  return ctx;
}

function poolStats(rows: any[]) {
  const byStatus: Record<string, number> = {};
  let reserved = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    const detail = parseObject(row.detail);
    if (row.status === "InCold" && detail.reserved) reserved += 1;
  }
  return {
    total: rows.length,
    by_status: byStatus,
    cold: byStatus.InCold || 0,
    reserved,
    in_use: byStatus.InUse || 0,
    creating: byStatus.Creating || 0,
    failed: byStatus.Failed || 0,
  };
}

async function regionsPayload() {
  const regions = await sql`select * from regions order by region_id`;
  const pools = await sql`select * from pools order by region_id, mode`;
  const instances = await sql`select pool_id, status, detail from pool_instances where is_deleted = false`;
  const shared = await sql`select pg_instance_id, pool_id, name, region_id, status, enabled, reserved_slots, capacity from shared_pgs`;
  return regions.map((region: any) => ({
    ...region,
    enabled: !!region.enabled,
    portal_enabled: !!region.portal_enabled,
    pools: pools.filter((pool: any) => pool.region_id === region.region_id).map((pool: any) => {
      const subset = instances.filter((inst: any) => inst.pool_id === pool.id);
      const config = parseObject(pool.config);
      return {
        ...pool,
        enabled: !!pool.enabled,
        config,
        target: Number(config.target || 2),
        max: Number(config.max || 4),
        ...poolStats(subset),
        shared_pg_count: shared.filter((item: any) => item.pool_id === pool.id).length,
      };
    }),
  }));
}

async function portalRegions() {
  const regions = await regionsPayload();
  return regions
    .filter((region: any) => region.enabled && region.portal_enabled)
    .map((region: any) => {
      const mode = region.portal_pool_mode || "shared";
      const modes = mode === "both" ? ["single", "shared"] : [mode];
      const pools = region.pools.filter((pool: any) => modes.includes(pool.mode) && pool.enabled).map((pool: any) => ({
        mode: pool.mode,
        mode_label: pool.mode === "single" ? "单租户池" : "多租共享池",
        pool_id: pool.id,
        pool_name: pool.name,
        cold: pool.cold,
        reserved: pool.reserved,
        available: Math.max(0, pool.cold - pool.reserved),
        in_use: pool.in_use,
        target: pool.target,
        max: pool.max,
      }));
      return {
        region_id: region.region_id,
        name: region.name || region.region_id,
        pools,
        available: pools.reduce((sum: number, pool: any) => sum + pool.available, 0),
        cold: pools.reduce((sum: number, pool: any) => sum + pool.cold, 0),
        in_use: pools.reduce((sum: number, pool: any) => sum + pool.in_use, 0),
        target: pools.reduce((sum: number, pool: any) => sum + pool.target, 0),
      };
    })
    .filter((region: any) => region.pools.length > 0);
}

async function portalInstances(userId: string) {
  const rows = await sql`select * from pool_instances where owner_user_id = ${userId} and is_deleted = false order by created_at desc`;
  const regions = await sql`select region_id, name from regions`;
  const pools = await sql`select id, name from pools`;
  return rows.map((row: any) => {
    const detail = parseObject(row.detail);
    return {
      id: row.id,
      app_name: detail.bound_app_name || row.app_name,
      resource_name: row.app_name,
      status: row.status,
      mode: row.mode,
      region_id: row.region_id,
      region_name: regions.find((item: any) => item.region_id === row.region_id)?.name || row.region_id,
      pool_id: row.pool_id,
      pool_name: pools.find((item: any) => item.id === row.pool_id)?.name || row.mode,
      supabase_instance_id: row.supabase_instance_id,
      bound_app_id: row.bound_app_id,
      bound_user: row.bound_user,
      reserved: !!detail.reserved,
      reserved_app_name: detail.reserved_app_name || null,
      public_connection: row.public_connection,
      vpc_connection: row.vpc_connection,
      cloud_status: row.cloud_status,
      error: row.error,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

function taskPayload(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    mode: row.mode,
    pool_id: row.pool_id,
    target_id: row.target_id,
    title: row.title,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result || {},
    error: row.error,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

async function issueJwt(user: any) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: user.id,
    username: user.username,
    role: user.role,
    ver: Number(user.token_version || 0),
    iat: now,
    exp: now + TOKEN_TTL,
  });
}

async function loginResponse(user: any) {
  return { user: publicUser(user), token: await issueJwt(user) };
}

async function createPat(user: any, body: any) {
  const prefix = Array.from(crypto.getRandomValues(new Uint8Array(6))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const secret = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const plain = `pctl_${prefix}_${secret}`;
  const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes.filter((scope: string) => SCOPES.includes(scope)) : SCOPES;
  const days = Number(body.expires_in_days ?? 30);
  const expiresAt = days > 0 ? new Date(Date.now() + Math.min(365, days) * 86400_000) : null;
  const rows = await sql`
    insert into platform_tokens (id, user_id, name, prefix, token_hash, scopes, expires_at, created_at)
    values (${crypto.randomUUID().replace(/-/g, "")}, ${user.id}, ${body.name || "API Token"}, ${prefix}, ${await sha256(plain)}, ${JSON.stringify(scopes)}::json, ${expiresAt}, now())
    returning *
  `;
  return { token: plain, ...tokenPublic(rows[0]) };
}

function tokenPublic(row: any) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes),
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked: !!row.revoked_at,
  };
}

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) || {};
    } catch {
      return {};
    }
  }
  return {};
}

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 16) return "***";
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function maskAuthInfo(data: Record<string, any>) {
  const keys = data.api_keys || {};
  return {
    instance_name: data.instance_name,
    jwt_secret: maskSecret(String(data.jwt_secret || "")),
    api_keys: {
      anon_key: maskSecret(String(keys.anon_key || "")),
      service_key: maskSecret(String(keys.service_key || "")),
    },
    config_list: (data.config_list || []).map((item: any) => {
      const name = String(item.name || item.Name || "");
      const value = String(item.value || item.Value || "");
      const sensitive = /SECRET|KEY|PASSWORD|TOKEN/.test(name.toUpperCase());
      return { name, value: sensitive ? maskSecret(value) : value };
    }),
  };
}

function randomId(prefix = ""): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "")}`;
}

function randomToken(bytes = 16): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

function aliyunEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function aliyunTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function hmacSha1Base64(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  let raw = "";
  for (const byte of new Uint8Array(signature)) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function rdsaiEndpoint(region: string): string {
  const central = new Set(["cn-beijing", "cn-hangzhou", "cn-shanghai", "cn-shenzhen", "cn-guangzhou", "cn-wulanchabu", "cn-zhangjiakou"]);
  return central.has(region) ? "rdsai.aliyuncs.com" : `rdsai.${region}.aliyuncs.com`;
}

class CloudApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

class RealAdapter {
  mode = "real";
  region: string;
  credsOverride: Record<string, string> | null;
  constructor(region: string, credsOverride: Record<string, string> | null = null) {
    this.region = region;
    this.credsOverride = credsOverride;
  }

  credentials() {
    if (this.credsOverride?.access_key_id) {
      return {
        id: this.credsOverride.access_key_id,
        secret: this.credsOverride.access_key_secret || "",
        token: this.credsOverride.security_token || "",
      };
    }
    const id = Deno.env.get("ALIBABA_CLOUD_ACCESS_KEY_ID") || "";
    const secret = Deno.env.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET") || "";
    if (!id || !secret) throw new CloudApiError("MissingCredentials", "Edge 未配置阿里云 AK/SK");
    return { id, secret, token: Deno.env.get("ALIBABA_CLOUD_SECURITY_TOKEN") || "" };
  }

  async rpc(endpoint: string, action: string, version: string, body: Record<string, any> = {}) {
    const started = Date.now();
    const product = endpoint.startsWith("rdsai") ? "RdsAi"
      : endpoint.startsWith("vpc") ? "VPC"
      : endpoint.startsWith("business") ? "BSS"
      : endpoint.startsWith("sts") ? "STS"
      : endpoint.startsWith("ram") ? "RAM"
      : "RDS";
    try {
      const creds = this.credentials();
      const params: Record<string, string> = {
        AccessKeyId: creds.id,
        Action: action,
        Format: "JSON",
        RegionId: this.region,
        SignatureMethod: "HMAC-SHA1",
        SignatureNonce: randomToken(12),
        SignatureVersion: "1.0",
        Timestamp: aliyunTimestamp(),
        Version: version,
      };
      if (creds.token) params.SecurityToken = creds.token;
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) params[key] = String(value);
      }
      const canonical = Object.keys(params).sort().map((key) => `${aliyunEncode(key)}=${aliyunEncode(params[key])}`).join("&");
      const stringToSign = `POST&%2F&${aliyunEncode(canonical)}`;
      params.Signature = await hmacSha1Base64(`${creds.secret}&`, stringToSign);
      const response = await fetch(`https://${endpoint}/`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
      const data = await response.json().catch(() => ({}));
      const successCode = !data.Code || ["Success", "OK", "200"].includes(String(data.Code));
      if (!response.ok || !successCode) {
        throw new CloudApiError(String(data.Code || `HTTP${response.status}`), String(data.Message || data.Code || "云 API 调用失败"));
      }
      void writeApiLog({ action, product, region: this.region, requestId: String(data.RequestId || ""), success: true, params: body, durationMs: Date.now() - started });
      return data;
    } catch (err) {
      void writeApiLog({ action, product, region: this.region, requestId: "", success: false, params: body, durationMs: Date.now() - started, errorCode: (err as any)?.code, errorMessage: String(err) });
      throw err;
    }
  }

  sts(action: string, body: Record<string, any> = {}) {
    return this.rpc("sts.aliyuncs.com", action, "2015-04-01", body);
  }

  async getIdentity() {
    const data = await this.sts("GetCallerIdentity");
    return {
      account_id: String(data.AccountId || ""),
      arn: String(data.Arn || ""),
      user_id: String(data.UserId || ""),
    };
  }

  rds(action: string, body: Record<string, any> = {}) {
    return this.rpc("rds.aliyuncs.com", action, "2014-08-15", body);
  }

  rdsai(action: string, body: Record<string, any> = {}) {
    return this.rpc(rdsaiEndpoint(this.region), action, "2025-05-07", body);
  }

  vpc(action: string, body: Record<string, any> = {}) {
    return this.rpc("vpc.aliyuncs.com", action, "2016-04-28", body);
  }

  async listVpcs() {
    const data = await this.vpc("DescribeVpcs", { PageSize: 50, PageNumber: 1 });
    return (data.Vpcs?.Vpc || []).map((item: any) => ({
      vpc_id: item.VpcId,
      name: item.VpcName || item.VpcId,
      cidr: item.CidrBlock || "",
      status: item.Status || "",
      region_id: this.region,
    }));
  }

  async listVSwitches(vpcId: string) {
    const data = await this.vpc("DescribeVSwitches", { VpcId: vpcId, PageSize: 50, PageNumber: 1 });
    return (data.VSwitches?.VSwitch || []).map((item: any) => ({
      vswitch_id: item.VSwitchId,
      name: item.VSwitchName || item.VSwitchId,
      zone_id: item.ZoneId || "",
      cidr: item.CidrBlock || "",
      available_ips: Number(item.AvailableIpAddressCount || 0),
      vpc_id: item.VpcId || vpcId,
    }));
  }

  async listPgs() {
    const data = await this.rds("DescribeDBInstances", { PageSize: 100, PageNumber: 1, Engine: "PostgreSQL" });
    return (data.Items?.DBInstance || []).map((item: any) => ({
      pg_instance_id: item.DBInstanceId,
      description: item.DBInstanceDescription || "",
      status: item.DBInstanceStatus || "",
      instance_class: item.DBInstanceClass || "",
      engine_version: item.EngineVersion || "",
      storage_gb: Number(item.DBInstanceStorage || 0),
      vpc_id: item.VpcId || "",
      vswitch_id: item.VSwitchId || "",
      zone_id: item.ZoneId || "",
      region_id: this.region,
      connection_string: item.ConnectionString || "",
      port: String(item.Port || 5432),
    }));
  }

  async pgNet(pgId: string) {
    const data = await this.rds("DescribeDBInstanceNetInfo", { DBInstanceId: pgId });
    const items = data.DBInstanceNetInfos?.DBInstanceNetInfo || data.DBInstanceNetInfos?.DBInstanceNetInfoItem || [];
    const result: any = { pg_instance_id: pgId, public_connection: "", public_port: 5432, vpc_connection: "", vpc_port: 5432, whitelist: [] };
    for (const item of Array.isArray(items) ? items : []) {
      const type = String(item.IPType || "").toLowerCase();
      if (type === "public") {
        result.public_connection = item.ConnectionString || "";
        result.public_port = Number(item.Port || 5432);
      } else if (["inner", "private", "vpc"].includes(type)) {
        result.vpc_connection = item.ConnectionString || "";
        result.vpc_port = Number(item.Port || 5432);
      }
    }
    try {
      result.whitelist = await this.pgWhitelist(pgId);
    } catch {
      // whitelist is best-effort
    }
    return result;
  }

  async pgWhitelist(pgId: string) {
    const data = await this.rds("DescribeDBInstanceIPArrayList", { DBInstanceId: pgId });
    const items = data.Items?.DBInstanceIPArray || [];
    const ips: string[] = [];
    for (const item of Array.isArray(items) ? items : []) {
      for (const ip of String(item.SecurityIps || "").split(",")) {
        if (ip.trim()) ips.push(ip.trim());
      }
    }
    return ips;
  }

  async appendPgWhitelist(pgId: string, ip: string) {
    await this.rds("ModifySecurityIps", { DBInstanceId: pgId, SecurityIps: ip, ModifyMode: "Append", SecurityIPType: "IPv4" });
    return { pg_instance_id: pgId, whitelist: await this.pgWhitelist(pgId), mode: "Append" };
  }

  async allocatePgPublicConnection(pgId: string, prefix: string, port = 5432) {
    const data = await this.rds("AllocateInstancePublicConnection", {
      DBInstanceId: pgId,
      ConnectionStringPrefix: prefix.toLowerCase().slice(0, 30),
      Port: String(port),
    });
    return { pg_instance_id: pgId, public_connection: String(data.ConnectionString || ""), public_port: port };
  }

  async createPgAccount(pgId: string, account: string, password: string) {
    await this.rds("CreateAccount", {
      DBInstanceId: pgId,
      AccountName: account,
      AccountPassword: password,
      AccountType: "Super",
      AccountDescription: "pool console metadata owner",
    });
  }

  async listSupabase() {
    const data = await this.rdsai("DescribeAppInstances", { PageSize: 100, PageNumber: 1 });
    return data.Instances?.Instance || data.Instances || [];
  }

  ram(action: string, body: Record<string, any> = {}) {
    return this.rpc("ram.aliyuncs.com", action, "2015-05-01", body);
  }

  async capacityCall(action: string, body: Record<string, any>) {
    const publicEndpoint = rdsaiEndpoint(this.region);
    try {
      return await this.rpc(publicEndpoint, action, "2025-05-07", body);
    } catch (err: any) {
      if (String(err?.code || "") !== "InvalidParameter") throw err;
      try {
        return await this.rpc(`rdsai-vpc.${this.region}.aliyuncs.com`, action, "2025-05-07", body);
      } catch (vpcErr: any) {
        if (String(vpcErr?.code || "") === "ServiceUnavailable") throw vpcErr;
        throw err;
      }
    }
  }

  async getCapacity(pgId: string) {
    const data = await this.capacityCall("DescribeDBInstanceCapacity", { DBInstanceName: pgId });
    return {
      db_instance_name: data.DBInstanceName || pgId,
      active_ratio: Number(data.ActiveRatio || 0.5),
      estimated_max_active_tenants: Number(data.EstimatedMaxActiveTenants || 0),
      estimated_max_total_tenants: Number(data.EstimatedMaxTotalTenants || 0),
      current_active_tenants: Number(data.CurrentActiveTenants || 0),
      current_total_tenants: Number(data.CurrentTotalTenants || 0),
      message: data.Message || "",
    };
  }

  async modifyCapacity(pgId: string, activeRatio: number) {
    const data = await this.capacityCall("ModifyDBInstanceCapacity", { DBInstanceName: pgId, ActiveRatio: activeRatio });
    return {
      db_instance_name: data.DBInstanceName || pgId,
      active_ratio: Number(data.ActiveRatio || activeRatio),
      estimated_max_active_tenants: Number(data.EstimatedMaxActiveTenants || 0),
      estimated_max_total_tenants: Number(data.EstimatedMaxTotalTenants || 0),
      current_active_tenants: Number(data.CurrentActiveTenants || 0),
      current_total_tenants: Number(data.CurrentTotalTenants || 0),
      message: data.Message || "",
    };
  }

  async supabaseEndpoints(instanceName: string) {
    const data = await this.rdsai("DescribeInstanceEndpoints", { InstanceName: instanceName });
    const items = data.InstanceEndpoints?.InstanceEndpoint || data.InstanceEndpoints || [];
    return {
      instance_name: instanceName,
      instance_endpoints: (Array.isArray(items) ? items : [items]).map((item: any) => ({
        connection_string: item.ConnectionString || "",
        ip: item.IP || item.Ip || "",
        port: item.Port || "",
        ip_type: item.IpType || item.IPType || "",
      })),
    };
  }

  async supabaseAuthInfo(instanceName: string) {
    const data = await this.rdsai("DescribeInstanceAuthInfo", { InstanceName: instanceName });
    const keys = data.ApiKeys || data.APIKeys || {};
    return {
      instance_name: instanceName,
      jwt_secret: data.JwtSecret || "",
      api_keys: { anon_key: keys.AnonKey || "", service_key: keys.ServiceKey || "" },
      config_list: data.ConfigList?.Config || data.ConfigList || [],
    };
  }

  async supabaseResource(instanceName: string) {
    const data = await this.rdsai("DescribeAppInstanceResource", { InstanceName: instanceName });
    return {
      instance_name: instanceName,
      app_type: String(data.AppType || ""),
      status: String(data.Status || ""),
      cpu_cores: Number(data.CpuCores || 0),
      memory_size_gb: Number(data.MemorySizeGB || 0),
      share_mode: !!data.ShareMode,
      authenticator_conn_limit: Number(data.AuthenticatorConnLimit || 0),
      auth_admin_conn_limit: Number(data.AuthAdminConnLimit || 0),
      realtime_conn_limit: Number(data.RealtimeConnLimit || 0),
      admin_conn_limit: Number(data.AdminConnLimit || 0),
    };
  }

  async modifySupabaseResource(instanceName: string, fields: Record<string, any>) {
    const mapping: Record<string, string> = {
      cpu_cores: "CpuCores",
      memory_size_gb: "MemorySizeGB",
      authenticator_conn_limit: "AuthenticatorConnLimit",
      auth_admin_conn_limit: "AuthAdminConnLimit",
      realtime_conn_limit: "RealtimeConnLimit",
      admin_conn_limit: "AdminConnLimit",
    };
    const body: Record<string, any> = { InstanceName: instanceName };
    for (const [key, apiKey] of Object.entries(mapping)) {
      if (fields[key] !== undefined && fields[key] !== null) body[apiKey] = fields[key];
    }
    const data = await this.rdsai("ModifyAppInstanceResource", body);
    return { instance_name: instanceName, request_id: String(data.RequestId || "") };
  }

  async supabaseDatabaseSize(instanceName: string) {
    const data = await this.rdsai("DescribeInstanceDatabaseSize", { InstanceName: instanceName });
    return {
      instance_name: instanceName,
      database_name: String(data.DatabaseName || ""),
      database_size_bytes: Number(data.DatabaseSizeBytes || 0),
      database_size_human: String(data.DatabaseSizeHuman || ""),
    };
  }

  async createPg(spec: Record<string, any>): Promise<string> {
    const category = String(spec.category || "Basic");
    const data = await this.rds("CreateDBInstance", {
      Engine: "PostgreSQL",
      EngineVersion: spec.engine_version || "17.0",
      DBInstanceClass: spec.instance_class || "pg.n2.2c.1m",
      DBInstanceStorage: Number(spec.storage_gb || 20),
      DBInstanceStorageType: "general_essd",
      Category: category,
      ...(category === "HighAvailability" ? { ZoneIdSlave1: spec.zone_id_slave1 || "Auto" } : {}),
      PayType: "Postpaid",
      DBInstanceNetType: "Intranet",
      InstanceNetworkType: "VPC",
      VPCId: spec.vpc_id,
      VSwitchId: spec.vswitch_id,
      ZoneId: spec.zone_id,
      SecurityIPList: spec.security_ip_list || "127.0.0.1",
      DBInstanceDescription: spec.description || "pool-edge",
      ClientToken: spec.client_token || randomId(),
    });
    if (!data.DBInstanceId) throw new CloudApiError("CreateDBInstanceFailed", "CreateDBInstance 未返回实例 ID");
    return String(data.DBInstanceId);
  }

  async describePg(pgId: string) {
    const data = await this.rds("DescribeDBInstanceAttribute", { DBInstanceId: pgId });
    const item = data.Items?.DBInstanceAttribute?.[0] || data.Items?.DBInstanceAttribute || {};
    return {
      pg_instance_id: pgId,
      status: String(item.DBInstanceStatus || item.Status || ""),
      vpc_id: String(item.VpcId || ""),
      vswitch_id: String(item.VSwitchId || ""),
      zone_id: String(item.ZoneId || ""),
    };
  }

  async deletePg(pgId: string) {
    await this.rds("DeleteDBInstance", { DBInstanceId: pgId });
  }

  async createSupabase(opts: Record<string, any>): Promise<string> {
    const body: Record<string, any> = {
      AppType: "supabase",
      VSwitchId: opts.vswitch_id,
      InstanceClass: opts.instance_class || "rdsai.supabase.basic",
      AppName: opts.app_name,
      DashboardUsername: opts.dashboard_username || "supabase",
      DashboardPassword: opts.dashboard_password,
      DatabasePassword: opts.database_password,
      PublicEndpointEnabled: opts.public_endpoint_enabled !== false,
      ClientToken: randomId(),
    };
    if (opts.pg_id) body.DBInstanceName = opts.pg_id;
    const data = await this.rdsai("CreateAppInstance", body);
    if (!data.InstanceName) throw new CloudApiError("CreateAppInstanceFailed", "CreateAppInstance 未返回实例 ID");
    return String(data.InstanceName);
  }

  async describeSupabase(instanceName: string) {
    const data = await this.rdsai("DescribeAppInstanceAttribute", { InstanceName: instanceName });
    return {
      instance_name: String(data.InstanceName || instanceName),
      status: String(data.Status || ""),
      vpc_connection_string: String(data.VpcConnectionString || ""),
      public_connection_string: String(data.PublicConnectionString || ""),
      components: data.Components || [],
    };
  }

  async startSupabase(instanceName: string) {
    await this.rdsai("StartInstance", { InstanceName: instanceName });
  }

  async restartSupabase(instanceName: string) {
    await this.rdsai("RestartInstance", { InstanceName: instanceName });
  }

  async stopSupabase(instanceName: string, force = false) {
    const body: Record<string, any> = { InstanceName: instanceName };
    if (force) body.Force = true;
    await this.rdsai("StopInstance", body);
  }

  async deleteSupabase(instanceName: string) {
    await this.rdsai("DeleteAppInstance", {
      InstanceName: instanceName,
      DeleteDBInstance: false,
      ClientToken: randomId(),
    });
  }
}

class MockAdapter {
  mode = "mock";
  constructor(public region: string) {}  async listVpcs() {
    return [{ vpc_id: "vpc-mock-01", name: "Mock VPC", cidr: "172.16.0.0/12", status: "Available", region_id: this.region }];
  }
  async listVSwitches(vpcId: string) {
    return [
      { vswitch_id: "vsw-mock-01", name: "mock-vsw-a", zone_id: "cn-chengdu-a", cidr: "172.16.0.0/24", available_ips: 240, vpc_id: vpcId },
      { vswitch_id: "vsw-mock-02", name: "mock-vsw-b", zone_id: "cn-chengdu-b", cidr: "172.16.1.0/24", available_ips: 250, vpc_id: vpcId },
    ];
  }
  async listPgs() {
    return [
      { pg_instance_id: "pgm-mock-edge-01", description: "Mock Edge PG", status: "Running", instance_class: "pg.n2.2c.1m", engine_version: "17.0", storage_gb: 20, vpc_id: "vpc-mock-01", vswitch_id: "vsw-mock-01", zone_id: "cn-chengdu-a", region_id: this.region },
    ];
  }
  async pgNet(pgId: string) {
    return { pg_instance_id: pgId, public_connection: "mock-pg.pg.rds.aliyuncs.com", public_port: 5432, vpc_connection: "172.16.0.10", vpc_port: 5432, whitelist: ["127.0.0.1"] };
  }
  async createPg(spec: Record<string, any>) {
    return randomId("pgm-mock-");
  }
  async describePg(pgId: string) {
    return { pg_instance_id: pgId, status: "Running", vpc_id: "vpc-mock-01", vswitch_id: "vsw-mock-01", zone_id: "cn-chengdu-a" };
  }
  async deletePg(_pgId: string) {}
  async getCapacity(pgId: string) {
    return { db_instance_name: pgId, active_ratio: 0.5, estimated_max_active_tenants: 411, estimated_max_total_tenants: 822, current_active_tenants: 0, current_total_tenants: 0, message: "" };
  }
  async modifyCapacity(pgId: string, ratio: number) {
    return { db_instance_name: pgId, active_ratio: ratio, estimated_max_active_tenants: 411, estimated_max_total_tenants: Math.floor(411 / ratio), current_active_tenants: 0, current_total_tenants: 0, message: "mock capacity updated" };
  }
  async createSupabase(opts: Record<string, any>) {
    return randomId("ra-supabase-mock-");
  }
  async describeSupabase(instanceName: string) {
    return { instance_name: instanceName, status: "Running", vpc_connection_string: "", public_connection_string: "", components: [] };
  }
  async startSupabase(_instanceName: string) {}
  async restartSupabase(_instanceName: string) {}
  async stopSupabase(_instanceName: string, _force = false) {}
  async deleteSupabase(_instanceName: string) {}
  async supabaseEndpoints(instanceName: string) {
    return { instance_name: instanceName, instance_endpoints: [{ connection_string: "mock.supabase.rds.aliyuncs.com:443", ip: "127.0.0.1", port: "443", ip_type: "Public" }] };
  }
  async supabaseAuthInfo(instanceName: string) {
    return { instance_name: instanceName, jwt_secret: "mock-secret", api_keys: { anon_key: "mock-anon", service_key: "mock-service" }, config_list: [] };
  }
  async supabaseResource(instanceName: string) {
    const shared = instanceName.startsWith("sm-");
    return {
      instance_name: instanceName,
      app_type: "supabase",
      status: "Running",
      cpu_cores: 2,
      memory_size_gb: 4,
      share_mode: shared,
      authenticator_conn_limit: 8,
      auth_admin_conn_limit: 4,
      realtime_conn_limit: 4,
      admin_conn_limit: 8,
    };
  }
  async modifySupabaseResource(instanceName: string) {
    return { instance_name: instanceName, request_id: `mock-${randomToken(10)}` };
  }
  async supabaseDatabaseSize(instanceName: string) {
    return {
      instance_name: instanceName,
      database_name: "supabase_db",
      database_size_bytes: 128 * 1024 * 1024,
      database_size_human: "128.00 MB",
    };
  }
}

const MOCK_ACTION_MAP: Record<string, [string, string]> = {
  listVpcs: ["DescribeVpcs", "VPC"],
  listVSwitches: ["DescribeVSwitches", "VPC"],
  listPgs: ["DescribeDBInstances", "RDS"],
  pgNet: ["DescribeDBInstanceNetInfo", "RDS"],
  pgWhitelist: ["DescribeDBInstanceIPArrayList", "RDS"],
  createPg: ["CreateDBInstance", "RDS"],
  describePg: ["DescribeDBInstanceAttribute", "RDS"],
  deletePg: ["DeleteDBInstance", "RDS"],
  getCapacity: ["DescribeDBInstanceCapacity", "RdsAi"],
  modifyCapacity: ["ModifyDBInstanceCapacity", "RdsAi"],
  createSupabase: ["CreateAppInstance", "RdsAi"],
  describeSupabase: ["DescribeAppInstanceAttribute", "RdsAi"],
  startSupabase: ["StartInstance", "RdsAi"],
  stopSupabase: ["StopInstance", "RdsAi"],
  restartSupabase: ["RestartInstance", "RdsAi"],
  deleteSupabase: ["DeleteAppInstance", "RdsAi"],
  supabaseEndpoints: ["DescribeInstanceEndpoints", "RdsAi"],
  supabaseAuthInfo: ["DescribeInstanceAuthInfo", "RdsAi"],
  supabaseResource: ["DescribeAppInstanceResource", "RdsAi"],
  modifySupabaseResource: ["ModifyAppInstanceResource", "RdsAi"],
  supabaseDatabaseSize: ["DescribeInstanceDatabaseSize", "RdsAi"],
};

function withMockLogging(adapter: MockAdapter) {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || prop === "constructor") return value;
      const mapped = MOCK_ACTION_MAP[String(prop)];
      const bound = value.bind(target);
      if (!mapped) return bound;
      return (...args: any[]) => {
        const started = Date.now();
        const params = args.length && typeof args[0] === "object" ? args[0] : { args };
        const finish = (success: boolean, error?: unknown) => {
          void writeApiLog({
            action: mapped[0],
            product: mapped[1],
            region: target.region,
            requestId: `mock-${randomToken(8)}`,
            success,
            params,
            durationMs: Date.now() - started,
            errorCode: success ? "" : "MockError",
            errorMessage: success ? "" : String(error),
          });
        };
        try {
          const result = bound(...args);
          if (result && typeof result.then === "function") {
            return result.then(
              (value: any) => {
                finish(true);
                return value;
              },
              (error: unknown) => {
                finish(false, error);
                throw error;
              },
            );
          }
          finish(true);
          return result;
        } catch (error) {
          finish(false, error);
          throw error;
        }
      };
    },
  });
}

function cloudAdapter(cloudMode: string, region: string) {
  if (cloudMode === "real") return new RealAdapter(region);
  return withMockLogging(new MockAdapter(region)) as unknown as MockAdapter;
}

let workerSchemaReady = false;
async function ensureWorkerSchema() {
  if (workerSchemaReady) return;
  await sql`alter table tasks add column if not exists step varchar(48) default 'prepare'`;
  await sql`alter table tasks add column if not exists attempts integer default 0`;
  await sql`alter table tasks add column if not exists next_run_at timestamp`;
  await sql`alter table tasks add column if not exists locked_at timestamp`;
  workerSchemaReady = true;
}

const BASE_SCHEMA_STATEMENTS = [
    `create table if not exists regions (
      region_id varchar(40) primary key,
      name varchar(120) not null default '',
      enabled boolean not null default true,
      portal_enabled boolean not null default true,
      portal_pool_mode varchar(16) not null default 'shared',
      created_at timestamp not null default now()
    )`,
    `create table if not exists pools (
      id varchar(40) primary key,
      region_id varchar(40) not null,
      mode varchar(16) not null,
      name varchar(120) not null default '',
      enabled boolean not null default true,
      vpc_id varchar(80),
      vswitch_id varchar(80),
      zone_id varchar(80),
      config json not null default '{}'::json,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      constraint uq_pool_region_mode unique (region_id, mode)
    )`,
    `create index if not exists ix_pools_region_id on pools (region_id)`,
    `create index if not exists ix_pools_mode on pools (mode)`,
    `create table if not exists shared_pgs (
      pg_instance_id varchar(80) primary key,
      pool_id varchar(40),
      name varchar(160) not null default '',
      region_id varchar(40) not null default 'cn-beijing',
      status varchar(40),
      instance_class varchar(80),
      engine_version varchar(40),
      storage_gb integer,
      vpc_id varchar(80),
      vswitch_id varchar(80),
      zone_id varchar(80),
      enabled boolean not null default true,
      weight integer not null default 1,
      reserved_slots integer not null default 0,
      capacity json not null default '{}'::json,
      added_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      last_checked_at timestamp
    )`,
    `create table if not exists pool_instances (
      id varchar(40) primary key,
      mode varchar(16) not null,
      pool_id varchar(40),
      status varchar(24) not null default 'Creating',
      app_name varchar(160) not null default '',
      bound_app_id varchar(160),
      bound_user varchar(160),
      owner_user_id varchar(40),
      region_id varchar(40) not null default 'cn-beijing',
      vpc_id varchar(80),
      vswitch_id varchar(80),
      pg_instance_id varchar(80),
      supabase_instance_id varchar(80),
      instance_class varchar(80) not null default '',
      cloud_status varchar(40),
      vpc_connection varchar(300),
      public_connection varchar(300),
      error text,
      detail json not null default '{}'::json,
      is_deleted boolean not null default false,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      last_checked_at timestamp,
      deleted_at timestamp
    )`,
    `create index if not exists ix_pool_instances_mode on pool_instances (mode)`,
    `create index if not exists ix_pool_instances_status on pool_instances (status)`,
    `create index if not exists ix_pool_instances_pool_id on pool_instances (pool_id)`,
    `create index if not exists ix_pool_instances_owner_user_id on pool_instances (owner_user_id)`,
    `create index if not exists ix_pool_instances_pg_instance_id on pool_instances (pg_instance_id)`,
    `create index if not exists ix_pool_instances_supabase_instance_id on pool_instances (supabase_instance_id)`,
    `create index if not exists ix_pool_instances_is_deleted on pool_instances (is_deleted)`,
    `create table if not exists tasks (
      id varchar(40) primary key,
      kind varchar(40) not null,
      mode varchar(16) not null default 'single',
      pool_id varchar(40),
      target_id varchar(40),
      title varchar(240) not null default '',
      status varchar(24) not null default 'pending',
      progress integer not null default 0,
      message text,
      payload json not null default '{}'::json,
      result json not null default '{}'::json,
      error text,
      created_at timestamp not null default now(),
      started_at timestamp,
      finished_at timestamp,
      step varchar(48) default 'prepare',
      attempts integer default 0,
      next_run_at timestamp,
      locked_at timestamp
    )`,
    `create index if not exists ix_tasks_kind on tasks (kind)`,
    `create index if not exists ix_tasks_status on tasks (status)`,
    `create index if not exists ix_tasks_pool_id on tasks (pool_id)`,
    `create index if not exists ix_tasks_target_id on tasks (target_id)`,
    `create table if not exists platform_users (
      id varchar(40) primary key,
      username varchar(80) not null unique,
      display_name varchar(120) not null default '',
      password_hash varchar(255) not null,
      role varchar(16) not null default 'user',
      enabled boolean not null default true,
      token_version integer not null default 0,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      last_login_at timestamp
    )`,
    `create unique index if not exists ix_platform_users_username on platform_users (username)`,
    `create table if not exists platform_tokens (
      id varchar(40) primary key,
      user_id varchar(40) not null,
      name varchar(120) not null default '',
      prefix varchar(24) not null unique,
      token_hash varchar(64) not null unique,
      scopes json not null default '[]'::json,
      expires_at timestamp,
      revoked_at timestamp,
      last_used_at timestamp,
      created_at timestamp not null default now()
    )`,
    `create index if not exists ix_platform_tokens_user_id on platform_tokens (user_id)`,
    `create table if not exists audit_events (
      id serial primary key,
      instance_id varchar(40),
      action varchar(80) not null,
      message text not null default '',
      detail json not null default '{}'::json,
      created_at timestamp not null default now()
    )`,
    `create index if not exists ix_audit_events_instance_id on audit_events (instance_id)`,
    `create table if not exists api_call_logs (
      id serial primary key,
      action varchar(80) not null,
      product varchar(40) not null default 'RdsAi',
      region varchar(40),
      request_id varchar(80),
      success boolean not null default true,
      error_code varchar(120),
      error_message text,
      duration_ms integer not null default 0,
      params json not null default '{}'::json,
      created_at timestamp not null default now()
    )`,
    `create table if not exists platform_config (
      key varchar(80) primary key,
      value json not null default '{}'::json,
      updated_at timestamp not null default now()
    )`,
];

let baseSchemaReady = false;
const BASE_TABLE_NAMES = ["pool_instances", "tasks", "platform_users", "platform_tokens", "shared_pgs", "regions", "pools", "audit_events", "api_call_logs", "platform_config"];

async function ensureBaseSchema() {
  if (baseSchemaReady) return;
  const existing = await sql`
    select
      to_regclass('public.pool_instances') as pool_instances,
      to_regclass('public.tasks') as tasks,
      to_regclass('public.platform_users') as platform_users,
      to_regclass('public.platform_tokens') as platform_tokens,
      to_regclass('public.shared_pgs') as shared_pgs,
      to_regclass('public.regions') as regions,
      to_regclass('public.pools') as pools,
      to_regclass('public.audit_events') as audit_events,
      to_regclass('public.api_call_logs') as api_call_logs,
      to_regclass('public.platform_config') as platform_config
  `;
  const present = existing[0] || {};
  if (BASE_TABLE_NAMES.every((name) => !!present[name])) {
    baseSchemaReady = true;
    return;
  }
  for (const statement of BASE_SCHEMA_STATEMENTS) {
    await sql.unsafe(statement);
  }
  baseSchemaReady = true;
}

async function applyBaseSchema(db: any) {
  for (const statement of BASE_SCHEMA_STATEMENTS) {
    await db.unsafe(statement);
  }
}

let runtimeConfigAt = 0;
let controlDbCheckedAt = 0;

async function configGet(key: string): Promise<any> {
  const rows = await sql`select value from platform_config where key = ${key} limit 1`;
  return rows[0] ? parseObject(rows[0].value) : null;
}

async function configSet(key: string, value: any) {
  await sql`
    insert into platform_config (key, value, updated_at) values (${key}, ${JSON.stringify(value)}::json, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

async function configDelete(key: string) {
  await sql`delete from platform_config where key = ${key}`;
}

function maskCredential(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function credentialInfo() {
  const envId = Deno.env.get("ALIBABA_CLOUD_ACCESS_KEY_ID") || "";
  return {
    has_credentials: !!envId,
    source: envId ? "edge-secret" : "",
    masked_access_key_id: maskCredential(envId),
    can_override: false,
  };
}

function defaultRegionId() {
  return Deno.env.get("DEFAULT_REGION") || "cn-chengdu";
}

async function loadRuntimeConfig(force = false) {
  if (!force && runtimeConfigAt && Date.now() - runtimeConfigAt < 5000) return;
  const rows = await sql`select key, value from platform_config where key = 'cloud_mode'`;
  const values = new Map<string, any>();
  for (const row of rows) values.set(row.key, parseObject(row.value));
  const mode = String(values.get("cloud_mode")?.mode || "");
  if (["real", "mock"].includes(mode)) CLOUD_MODE = mode;
  runtimeConfigAt = Date.now();
}

async function switchControlDb(targetUrl: string) {
  if (!targetUrl || targetUrl === activeControlDbUrl) return;
  const next = postgres(targetUrl, { max: 1, prepare: false, connect_timeout: 10 });
  await next`select 1`;
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // ignore shutdown errors
  }
  sql = next;
  activeControlDbUrl = targetUrl;
  baseSchemaReady = false;
  workerSchemaReady = false;
  runtimeConfigAt = 0;
  controlDbCheckedAt = Date.now();
}

async function resolveControlDb(force = false) {
  if (!force && controlDbCheckedAt && Date.now() - controlDbCheckedAt < 30000) return;
  controlDbCheckedAt = Date.now();
  const admin = await adminDb();
  try {
    await admin`create table if not exists pool_control_config (key text primary key, value text not null, updated_at timestamp not null default now())`;
    const rows = await admin`select value from pool_control_config where key = 'control_db_url' limit 1`;
    let target = rows[0]?.value || "";
    if (target) {
      try {
        target = await decryptConfig(target);
      } catch {
        target = "";
      }
    }
    if (target && target !== activeControlDbUrl) await switchControlDb(target);
  } catch (err) {
    console.error("resolve control db failed", String(err));
  } finally {
    await admin.end();
  }
}

let autoWhitelistAt = 0;

async function maybeSelfWhitelistControlDb(err: unknown) {
  if (Deno.env.get("AUTO_WHITELIST") === "false") return false;
  if (Date.now() - autoWhitelistAt < 60000) return false;
  const message = String(err);
  if (!/pg_hba|whitelist|timeout|timed out|connect|refused|no route/i.test(message)) return false;
  let host = "";
  try {
    host = new URL(activeControlDbUrl).hostname;
  } catch {
    return false;
  }
  const parts = host.split(".");
  const pgId = parts[0];
  if (!pgId.startsWith("pgm-")) return false;
  let ip = "";
  try {
    ip = (await detectPublicIp()).ip;
  } catch {
    return false;
  }
  const region = parts[1] === "pgsql" && parts[2] ? parts[2] : defaultRegionId();
  autoWhitelistAt = Date.now();
  try {
    const adapter = new RealAdapter(region);
    await adapter.rds("ModifySecurityIps", {
      DBInstanceId: pgId,
      SecurityIps: ip,
      ModifyMode: "Append",
      SecurityIPType: "IPv4",
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return true;
  } catch (whitelistErr) {
    console.error("auto whitelist failed", String(whitelistErr));
    return false;
  }
}

async function initControlPlane(force = false) {
  await resolveControlDb(force);
  await ensureBaseSchema();
  await loadRuntimeConfig();
  await ensureWorkerSchema();
}

async function setControlDbPointer(targetUrl: string) {
  const admin = await adminDb();
  try {
    await admin`create table if not exists pool_control_config (key text primary key, value text not null, updated_at timestamp not null default now())`;
    const encrypted = await encryptConfig(targetUrl);
    await admin`
      insert into pool_control_config (key, value, updated_at) values ('control_db_url', ${encrypted}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
  } finally {
    await admin.end();
  }
}

async function controlDbInfo() {
  try {
    const parsed = new URL(activeControlDbUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: parsed.pathname.replace(/^\//, ""),
      username: parsed.username,
    };
  } catch {
    return { host: "", port: 5432, database: "", username: "" };
  }
}

function activeDbParts() {
  const parsed = new URL(activeControlDbUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    sslmode: parsed.searchParams.get("sslmode") || "require",
  };
}

function pgConnectOptions(input: {
  host: string;
  port?: number;
  database?: string;
  username: string;
  password?: string;
  sslmode?: string;
}) {
  const options: Record<string, any> = {
    host: input.host,
    port: Number(input.port || 5432),
    database: input.database || "postgres",
    username: input.username,
    password: input.password || "",
    max: 1,
    prepare: false,
    connect_timeout: 8,
  };
  const sslmode = input.sslmode === undefined ? "require" : input.sslmode;
  if (sslmode === "disable" || sslmode === "") options.ssl = false;
  else if (sslmode) options.ssl = sslmode;
  return options;
}

function buildControlDbUrl(input: {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  sslmode?: string;
}) {
  const url = new URL("postgres://localhost");
  url.hostname = input.host;
  url.port = String(input.port || 5432);
  url.pathname = `/${input.database}`;
  url.username = input.username;
  url.password = input.password || "";
  url.searchParams.set("sslmode", input.sslmode || "require");
  return url.toString();
}

async function ensureTargetDatabase(input: {
  host: string;
  port?: number;
  username: string;
  password: string;
  database: string;
  sslmode?: string;
}) {
  const database = input.database || "postgres";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database)) throw new Error(`数据库名不合法：${database}`);
  if (database === "postgres") return;
  const admin = postgres(pgConnectOptions({ ...input, database: "postgres" }));
  try {
    const rows = await admin`select 1 from pg_database where datname = ${database}`;
    if (rows[0]) return;
    const identifier = `"${database.replace(/"/g, '""')}"`;
    await admin.unsafe(`create database ${identifier}`);
  } finally {
    await admin.end({ timeout: 3 });
  }
}

async function configureMetadataTarget(input: {
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  sslmode?: string;
  pg_instance_id?: string;
  source?: string;
  public_connection?: string;
}) {
  const sslmode = input.sslmode || "require";
  await ensureTargetDatabase({ ...input, sslmode });
  const targetUrl = buildControlDbUrl({ ...input, sslmode });
  const carried = await sql`select key, value from platform_config where key in ('cloud_mode', 'settings')`;
  const target = postgres(targetUrl, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    await target`select 1`;
    await applyBaseSchema(target);
    for (const row of carried) {
      await target`
        insert into platform_config (key, value, updated_at) values (${row.key}, ${JSON.stringify(parseObject(row.value))}::json, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `;
    }
  } finally {
    await target.end({ timeout: 3 });
  }
  await setControlDbPointer(targetUrl);
  await switchControlDb(targetUrl);
  await ensureBaseSchema();
  await loadRuntimeConfig(true);
  const metadataPg = {
    host: input.host,
    port: Number(input.port || 5432),
    database: input.database,
    username: input.username,
    sslmode,
    pg_instance_id: input.pg_instance_id || "",
    source: input.source || "manual",
    public_connection: input.public_connection || "",
  };
  await configSet("metadata_pg", metadataPg);
  const settings = (await configGet("settings")) || {};
  settings.metadata_pg = metadataPg;
  await configSet("settings", settings);
  return {
    configured: true,
    database_url: `${input.host}:${Number(input.port || 5432)}/${input.database}`,
    metadata_pg: metadataPg,
  };
}

async function configureExistingPg(
  adapter: RealAdapter,
  input: {
    pg_instance_id: string;
    database: string;
    username: string;
    password: string;
    ip?: string;
    sslmode?: string;
    ensure_public?: boolean;
  },
) {
  const net = await adapter.pgNet(input.pg_instance_id);
  let publicHost = String(net.public_connection || "");
  let publicPort = Number(net.public_port || 5432);
  if (input.ensure_public !== false && !publicHost) {
    try {
      const allocated = await adapter.allocatePgPublicConnection(
        input.pg_instance_id,
        `poolmeta-${input.pg_instance_id.slice(-8)}`,
        5432,
      );
      publicHost = String(allocated.public_connection || "");
      publicPort = Number(allocated.public_port || 5432);
    } catch {
      const retry = await adapter.pgNet(input.pg_instance_id);
      publicHost = String(retry.public_connection || "");
      publicPort = Number(retry.public_port || 5432);
    }
  }
  if (input.ip) await adapter.appendPgWhitelist(input.pg_instance_id, input.ip);
  if (!publicHost) throw new Error("该 PG 没有公网连接地址，无法从 Edge 初始化元数据库");
  return configureMetadataTarget({
    host: publicHost,
    port: publicPort,
    database: input.database,
    username: input.username,
    password: input.password,
    sslmode: input.sslmode || "require",
    pg_instance_id: input.pg_instance_id,
    source: "existing",
    public_connection: `${publicHost}:${publicPort}`,
  });
}

async function testPgConnection(body: Record<string, any>) {
  const current = activeDbParts();
  const host = String(body.host || current.host);
  const username = String(body.username || current.username);
  if (!host || !username) throw new Error("请填写元数据 PG 的 host 和用户名");
  const port = Number(body.port || current.port || 5432);
  const password = body.password !== undefined ? String(body.password) : current.password;
  const database = String(body.database || current.database || "postgres");
  const sslmode = body.sslmode !== undefined ? String(body.sslmode) : current.sslmode;
  const db = postgres(pgConnectOptions({ host, port, database, username, password, sslmode }));
  try {
    const versionRows = await db`select version() as version, current_database() as database, current_user as username`;
    const databaseRows = await db`select datname from pg_database where datistemplate = false order by datname`;
    return {
      ok: true,
      host,
      port,
      database: String(versionRows[0]?.database || database),
      username: String(versionRows[0]?.username || username),
      version: String(versionRows[0]?.version || ""),
      databases: databaseRows.map((row: any) => row.datname),
    };
  } finally {
    await db.end({ timeout: 3 });
  }
}

async function metadataStatusPayload() {
  const info = await controlDbInfo();
  const rows = await sql`select to_regclass('public.pool_instances') as ready`;
  const storedSettings = (await configGet("settings")) || {};
  const metadataPg = (await configGet("metadata_pg")) || storedSettings.metadata_pg || {};
  return {
    configured: true,
    dialect: "postgresql",
    database_url: `${info.host}:${info.port}/${info.database}`,
    host: metadataPg.host || info.host,
    port: Number(metadataPg.port || info.port || 5432),
    database: metadataPg.database || info.database,
    username: metadataPg.username || info.username,
    pg_instance_id: metadataPg.pg_instance_id || "",
    source: metadataPg.source || "edge",
    public_connection: metadataPg.public_connection || "",
    schema_ready: !!rows[0]?.ready,
  };
}

function sanitizeParams(params: Record<string, any>) {
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(params || {})) {
    output[key] = /password|secret|token|accesskey/i.test(key) ? "***" : value;
  }
  return output;
}

async function writeApiLog(entry: {
  action: string;
  product: string;
  region: string;
  requestId: string;
  success: boolean;
  params: Record<string, any>;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}) {
  try {
    await sql`
      insert into api_call_logs (action, product, region, request_id, success, error_code, error_message, duration_ms, params, created_at)
      values (${entry.action}, ${entry.product}, ${entry.region}, ${entry.requestId || null}, ${entry.success},
              ${entry.errorCode || null}, ${entry.errorMessage || null}, ${entry.durationMs},
              ${JSON.stringify(sanitizeParams(entry.params))}::json, now())
    `;
  } catch (err) {
    console.error("write api log failed", String(err));
  }
}

async function writeAuditEvent(instanceId: string | null, action: string, message: string, detail: Record<string, any> = {}) {
  try {
    await sql`
      insert into audit_events (instance_id, action, message, detail, created_at)
      values (${instanceId}, ${action}, ${message}, ${JSON.stringify(detail)}::json, now())
    `;
  } catch (err) {
    console.error("write audit event failed", String(err));
  }
}

async function preflightPayload() {
  if (CLOUD_MODE !== "real") {
    const checks = [
      { name: "阿里云凭证", status: "pass", message: "Mock 模式无需真实凭证", detail: {} },
      { name: "地域", status: "pass", message: `当前地域 ${defaultRegionId()}`, detail: {} },
      { name: "VPC / VSwitch", status: "pass", message: "Mock 网络资源可用", detail: {} },
      { name: "RDS PostgreSQL", status: "pass", message: "Mock 实例列表可用", detail: {} },
      { name: "RDS AI Supabase", status: "pass", message: "Mock 实例管理可用", detail: {} },
      { name: "服务关联角色", status: "pass", message: "Mock 模式跳过", detail: {} },
      { name: "控制面数据库", status: "warn", message: "Mock 模式仅模拟云资源，元数据仍写入已配置的 PG", detail: {} },
      { name: "容量接口", status: "pass", message: "Mock 容量接口可用", detail: {} },
    ];
    return {
      mode: "mock",
      checks,
      summary: { pass: checks.filter((check) => check.status === "pass").length, warn: 1, fail: 0 },
    };
  }
  const checks: any[] = [];
  const creds = credentialInfo();
  checks.push({
    name: "阿里云凭证",
    status: creds.has_credentials ? "pass" : "fail",
    message: creds.has_credentials ? `已配置（${creds.source}，${creds.masked_access_key_id}）` : "未配置 AK/SK",
    detail: {},
  });
  if (!checks.some((check) => check.status === "fail")) {
    const adapter = new RealAdapter(defaultRegionId());
    try {
      const identity = await adapter.getIdentity();
      checks.push({ name: "STS 身份", status: "pass", message: `账号 ${identity.account_id}`, detail: identity });
    } catch (err) {
      checks.push({ name: "STS 身份", status: "fail", message: String(err), detail: {} });
    }
    if (!checks.some((check) => check.status === "fail")) {
      try {
        const vpcs = await adapter.listVpcs();
        checks.push({ name: "VPC 读取", status: "pass", message: `发现 ${vpcs.length} 个 VPC`, detail: {} });
      } catch (err) {
        checks.push({ name: "VPC 读取", status: "warn", message: String(err), detail: {} });
      }
      try {
        const pgs = await adapter.listPgs();
        checks.push({ name: "RDS PostgreSQL 读取", status: "pass", message: `发现 ${pgs.length} 个实例`, detail: {} });
      } catch (err) {
        checks.push({ name: "RDS PostgreSQL 读取", status: "fail", message: String(err), detail: {} });
      }
      try {
        const apps = await adapter.listSupabase();
        checks.push({ name: "RDS AI Supabase 读取", status: "pass", message: `发现 ${apps.length} 个实例`, detail: {} });
      } catch (err) {
        checks.push({ name: "RDS AI Supabase 读取", status: "warn", message: String(err), detail: {} });
      }
      try {
        const month = new Date().toISOString().slice(0, 7);
        await adapter.rpc("business.aliyuncs.com", "DescribeInstanceBill", "2017-12-14", { BillingCycle: month, Granularity: "MONTHLY", MaxResults: 1 });
        checks.push({ name: "账单权限", status: "pass", message: "BSS 实例账单接口可用", detail: {} });
      } catch (err) {
        checks.push({ name: "账单权限", status: "warn", message: String(err), detail: {} });
      }
      const roles = ["AliyunServiceRoleForRds", "AliyunServiceRoleForRdsPgsqlOnEcs", "AliyunServiceRoleForRDSAISupabase"];
      const missing: string[] = [];
      for (const role of roles) {
        try {
          await adapter.ram("GetRole", { RoleName: role });
        } catch {
          missing.push(role);
        }
      }
      checks.push(
        missing.length
          ? { name: "服务关联角色", status: "warn", message: `缺少或无权查看：${missing.join(", ")}`, detail: { missing } }
          : { name: "服务关联角色", status: "pass", message: "三个 SLR 均已授权", detail: {} },
      );
    }
  }
  try {
    const dbRows = await sql`select version() as version`;
    checks.push({ name: "控制面数据库", status: "pass", message: `已连接（${String(dbRows[0]?.version || "").slice(0, 40)}）`, detail: {} });
  } catch (err) {
    checks.push({ name: "控制面数据库", status: "fail", message: String(err), detail: {} });
  }
  return {
    mode: CLOUD_MODE,
    checks,
    summary: {
      pass: checks.filter((check) => check.status === "pass").length,
      warn: checks.filter((check) => check.status === "warn").length,
      fail: checks.filter((check) => check.status === "fail").length,
    },
  };
}

async function overviewPayload(requestedRegionId = "") {
  const regions = await regionsPayload();
  const stored = (await configGet("settings")) || {};
  const selectedRegionId = requestedRegionId || stored.region_id || regions[0]?.region_id || "";
  const region = regions.find((item: any) => item.region_id === selectedRegionId) || regions[0] || null;
  const instances = region
    ? await sql`select count(*)::int as total from pool_instances where is_deleted = false and region_id = ${region.region_id}`
    : await sql`select count(*)::int as total from pool_instances where is_deleted = false`;
  const tasks = region
    ? await sql`select t.* from tasks t left join pools p on p.id = t.pool_id where p.region_id = ${region.region_id} or t.pool_id is null order by t.created_at desc limit 8`
    : await sql`select * from tasks order by created_at desc limit 8`;
  const firstPool = region?.pools?.[0];
  const shared = await sharedPgRows(undefined, region?.region_id);
  const capacityCached = aggregateCapacity(shared);
  const failedTasks = region
    ? await sql`select count(*)::int as total from tasks t join pools p on p.id = t.pool_id where t.status = 'failed' and t.finished_at >= now() - interval '24 hours' and p.region_id = ${region.region_id}`
    : await sql`select count(*)::int as total from tasks where status = 'failed' and finished_at >= now() - interval '24 hours'`;
  const failedInstances = region
    ? await sql`select count(*)::int as total from pool_instances where is_deleted = false and status = 'Failed' and region_id = ${region.region_id}`
    : await sql`select count(*)::int as total from pool_instances where is_deleted = false and status = 'Failed'`;
  const alerts: any[] = [];
  if (CLOUD_MODE === "mock") alerts.push({ level: "info", title: "当前为 Mock 模式", detail: "云资源为模拟数据，元数据仍写入已配置的 PG。" });
  if (region && (region.pools || []).some((pool: any) => pool.mode === "shared") && shared.length === 0) {
    alerts.push({ level: "warning", title: "共享池还没有共享 PG", detail: "请到地域与资源池页面为共享池添加共享 PG。" });
  }
  const unavailable = shared.filter((item: any) => !item.enabled || String(item.status || "").toLowerCase() !== "running");
  if (unavailable.length) alerts.push({ level: "warning", title: `${unavailable.length} 台共享 PG 不可用于新租户`, detail: "请检查共享 PG 的启用状态和运行状态。" });
  if (region && !(region.pools || []).some((pool: any) => parseObject(pool.config).auto_refill)) {
    alerts.push({ level: "info", title: "自动补货已关闭", detail: "需要手动预热实例，或到地域与资源池页面开启自动补货。" });
  }
  if (Number(failedTasks[0]?.total || 0) > 0) {
    alerts.push({ level: "warning", title: `近 24 小时有 ${failedTasks[0].total} 个失败任务`, detail: "请到任务中心查看错误并重试。" });
  }
  if (Number(failedInstances[0]?.total || 0) > 0) {
    alerts.push({ level: "critical", title: `${failedInstances[0].total} 个实例处于 Failed`, detail: "请查看实例详情或执行自愈巡检。" });
  }
  const metadataStatus = await metadataStatusPayload();
  return {
    configured: true,
    cloud_mode: CLOUD_MODE,
    credentials: credentialInfo(),
    database: metadataStatus,
    settings: {
      region_id: region?.region_id || "",
      vpc_id: stored.vpc_id || firstPool?.vpc_id || "",
      vswitch_id: stored.vswitch_id || firstPool?.vswitch_id || "",
      zone_id: stored.zone_id || firstPool?.zone_id || "",
      shared_pg_id: stored.shared_pg_id || shared[0]?.pg_instance_id || "",
      mode: CLOUD_MODE,
      pool: stored.pool || firstPool?.config || DEFAULT_POOL_CONFIG,
      metadata_pg: {
        host: metadataStatus.host,
        port: metadataStatus.port,
        database: metadataStatus.database,
        username: metadataStatus.username,
        sslmode: stored.metadata_pg?.sslmode || "require",
        source: metadataStatus.source,
      },
    },
    regions,
    region: region || null,
    region_id: region?.region_id || "",
    instance_total: instances[0].total,
    pools: Object.fromEntries((region?.pools || []).map((pool: any) => [pool.mode, pool])),
    shared_pgs: shared,
    capacity_cached: capacityCached,
    recent_tasks: tasks.map(taskPayload),
    alerts,
  };
}

async function updateTask(task: any, fields: Record<string, any>) {
  const allowed = new Set([
    "status", "step", "progress", "message", "result", "error",
    "attempts", "next_run_at", "locked_at", "started_at", "finished_at",
  ]);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || !allowed.has(key)) continue;
    const encoded = ["result"].includes(key) && typeof value === "string" ? value : value;
    await sql.unsafe(`update tasks set ${key} = $1 where id = $2`, [encoded, task.id]);
  }
}

async function setInstance(id: string, fields: Record<string, any>) {
  const allowed = new Set([
    "status", "supabase_instance_id", "pg_instance_id", "vswitch_id",
    "cloud_status", "detail", "error", "is_deleted", "deleted_at",
    "owner_user_id", "bound_user", "bound_app_id",
  ]);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || !allowed.has(key)) continue;
    await sql.unsafe(`update pool_instances set ${key} = $1, updated_at = now() where id = $2`, [value, id]);
  }
}

async function instanceCloud(id: string) {
  const rows = await sql`select * from pool_instances where id = ${id} and is_deleted = false limit 1`;
  const inst: any = rows[0];
  if (!inst) return { inst: null, adapter: null, detail: {} as Record<string, any> };
  const detail = parseObject(inst.detail);
  return { inst, adapter: cloudAdapter(detail.cloud_mode || CLOUD_MODE, inst.region_id), detail };
}

async function finishTask(task: any, result: Record<string, any> = {}) {
  await updateTask(task, {
    status: "succeeded",
    progress: 100,
    message: "任务完成",
    result: JSON.stringify(result),
    error: null,
    next_run_at: null,
    locked_at: null,
  });
  await sql`update tasks set finished_at = now() where id = ${task.id}`;
}

async function scheduleTask(task: any, step: string, progress: number, message: string, seconds = 5) {
  await updateTask(task, {
    status: "pending",
    step,
    progress,
    message,
    locked_at: null,
  });
  await sql`update tasks set next_run_at = now() + make_interval(secs => ${seconds}) where id = ${task.id}`;
}

async function failTask(task: any, error: string) {
  const attempts = Number(task.attempts || 0) + 1;
  if (attempts >= 3) {
    await updateTask(task, {
      status: "failed",
      attempts,
      error,
      message: "任务失败",
      locked_at: null,
      next_run_at: null,
    });
    await sql`update tasks set finished_at = now() where id = ${task.id}`;
    if (task.target_id) {
      await setInstance(task.target_id, { status: "Failed", error });
    }
  } else {
    await updateTask(task, {
      status: "pending",
      attempts,
      error,
      message: `自动重试 ${attempts}/3`,
      locked_at: null,
    });
    await sql`update tasks set next_run_at = now() + make_interval(secs => ${10 * attempts}) where id = ${task.id}`;
  }
}

async function processPrewarm(task: any, inst: any) {
  const payload = parseObject(task.payload);
  const adapter = cloudAdapter(payload.cloud_mode || CLOUD_MODE, inst.region_id);
  const step = task.step || "prepare";
  const detail = parseObject(inst.detail);
  const poolRows = await sql`select * from pools where id = ${inst.pool_id} limit 1`;
  const pool = poolRows[0] || {};
  const config = parseObject(pool.config);
  if (step === "prepare") {
    if (!inst.pg_instance_id) {
      if (inst.mode === "single") {
        const pgId = await adapter.createPg({
          instance_class: config.single_pg_class,
          engine_version: config.single_engine_version,
          storage_gb: config.single_pg_storage,
          category: config.single_pg_category,
          vpc_id: pool.vpc_id,
          vswitch_id: pool.vswitch_id,
          zone_id: pool.zone_id,
          security_ip_list: config.single_pg_security_ips,
          description: `pool-single-${inst.id.slice(0, 8)}`,
          client_token: inst.id,
        });
        await setInstance(inst.id, { pg_instance_id: pgId });
      } else {
        const shared = await sql`
          select * from shared_pgs
          where pool_id = ${inst.pool_id} and enabled = true and status = 'Running'
          order by added_at asc limit 1
        `;
        if (!shared[0]) throw new Error("共享池没有可用的共享 PG");
        await setInstance(inst.id, { pg_instance_id: shared[0].pg_instance_id, vswitch_id: shared[0].vswitch_id });
      }
    }
    return scheduleTask(task, "wait_pg", 20, "等待 PG 就绪", 3);
  }
  if (step === "wait_pg") {
    if (inst.mode === "single" && inst.pg_instance_id) {
      const pg = await adapter.describePg(inst.pg_instance_id);
      if (pg.status !== "Running") return scheduleTask(task, "wait_pg", 25, "等待 PG Running", 8);
    }
    return scheduleTask(task, "create_supabase", 35, "创建 Supabase 实例", 1);
  }
  if (step === "create_supabase") {
    let supabaseId = inst.supabase_instance_id;
    if (!supabaseId) {
      const vswitch = inst.mode === "shared" ? inst.vswitch_id : pool.vswitch_id;
      supabaseId = await adapter.createSupabase({
        mode: inst.mode,
        pg_id: inst.pg_instance_id,
        vswitch_id: vswitch,
        app_name: `pool-${inst.id.slice(0, 8)}`,
        instance_class: inst.mode === "shared" ? "rdsai.supabase.share.basic" : "rdsai.supabase.basic",
        dashboard_username: "supabase",
        dashboard_password: Deno.env.get("SUPABASE_DASHBOARD_PASSWORD") || randomToken(18),
        database_password: Deno.env.get("SUPABASE_DATABASE_PASSWORD") || randomToken(18),
        public_endpoint_enabled: config.public_endpoint_enabled !== false,
      });
      await setInstance(inst.id, { supabase_instance_id: supabaseId });
    }
    return scheduleTask(task, "wait_supabase", 55, "等待 Supabase 就绪", 5);
  }
  if (step === "wait_supabase") {
    const data = await adapter.describeSupabase(inst.supabase_instance_id);
    if (data.status !== "Running") return scheduleTask(task, "wait_supabase", 60, "等待 Supabase Running", 10);
    const cloudDetail = { ...detail, cloud: data };
    await setInstance(inst.id, { status: "Available", detail: JSON.stringify(cloudDetail), error: null });
    return scheduleTask(task, "stop_supabase", 75, "冻结进入冷池", 1);
  }
  if (step === "stop_supabase") {
    await adapter.stopSupabase(inst.supabase_instance_id, config.stop_mode === "force");
    return scheduleTask(task, "wait_stopped", 85, "等待实例停止", 5);
  }
  if (step === "wait_stopped") {
    if (adapter.mode === "real" && inst.supabase_instance_id) {
      const data = await adapter.describeSupabase(inst.supabase_instance_id);
      if (data.status !== "Stopped") return scheduleTask(task, "wait_stopped", 90, "等待实例停止", 8);
    }
    const nextDetail = { ...detail };
    await setInstance(inst.id, { status: "InCold", cloud_status: "Stopped", detail: JSON.stringify(nextDetail), error: null });
    await finishTask(task);
  }
}

async function processSharedPgCreate(task: any) {
  const payload = parseObject(task.payload);
  const poolRows = await sql`select * from pools where id = ${task.target_id} limit 1`;
  const pool: any = poolRows[0];
  if (!pool || pool.mode !== "shared") {
    await failTask(task, "共享池不存在");
    return;
  }
  const adapter = cloudAdapter(payload.cloud_mode || CLOUD_MODE, pool.region_id);
  const config = poolConfig(pool.config);
  const result = parseObject(task.result);
  let pgId = String(result.pg_instance_id || "");

  if (task.step === "create_pg") {
    if (!pgId) {
      pgId = await adapter.createPg({
        instance_class: payload.instance_class || config.shared_pg_class,
        engine_version: payload.engine_version || config.shared_pg_engine_version,
        storage_gb: Number(payload.storage_gb || config.shared_pg_storage),
        category: payload.category || config.shared_pg_category,
        vpc_id: pool.vpc_id,
        vswitch_id: pool.vswitch_id,
        zone_id: payload.zone_id || pool.zone_id,
        security_ip_list: config.single_pg_security_ips,
        description: String(payload.name || `pool-shared-${pool.id.slice(0, 8)}`).slice(0, 64),
        client_token: task.id,
      });
    }
    await sql`
      insert into shared_pgs (pg_instance_id, pool_id, name, region_id, status, instance_class, engine_version, storage_gb,
                              vpc_id, vswitch_id, zone_id, enabled, weight, reserved_slots, capacity, added_at, updated_at, last_checked_at)
      values (${pgId}, ${pool.id}, ${payload.name || pgId}, ${pool.region_id}, 'Creating',
              ${payload.instance_class || config.shared_pg_class}, ${payload.engine_version || config.shared_pg_engine_version},
              ${Number(payload.storage_gb || config.shared_pg_storage)}, ${pool.vpc_id}, ${pool.vswitch_id},
              ${payload.zone_id || pool.zone_id}, true, 1, 0, '{}'::json, now(), now(), now())
      on conflict (pg_instance_id) do update set
        pool_id = excluded.pool_id, name = excluded.name, region_id = excluded.region_id,
        status = 'Creating', vpc_id = excluded.vpc_id, vswitch_id = excluded.vswitch_id,
        zone_id = excluded.zone_id, enabled = true, updated_at = now()
    `;
    await updateTask(task, {
      step: "wait_pg",
      progress: 30,
      message: "等待共享 PG Running",
      result: JSON.stringify({ ...result, pg_instance_id: pgId }),
      locked_at: null,
    });
    await sql`update tasks set next_run_at = now() + interval '15 seconds' where id = ${task.id}`;
    return;
  }

  if (task.step === "wait_pg") {
    if (!pgId) {
      await failTask(task, "共享 PG 缺少实例 ID");
      return;
    }
    const pg = await adapter.describePg(pgId);
    if (pg.status === "Running") {
      let capacity: Record<string, any> = {};
      try {
        capacity = await adapter.getCapacity(pgId);
      } catch {
        capacity = {};
      }
      await sql`
        update shared_pgs set status = 'Running', capacity = ${JSON.stringify(capacity)}::json,
          last_checked_at = now(), updated_at = now()
        where pg_instance_id = ${pgId}
      `;
      await finishTask(task, { pg_instance_id: pgId, status: "Running" });
      return;
    }
    if (["Creating", "Initializing", "Rebooting"].includes(String(pg.status || ""))) {
      await scheduleTask(task, "wait_pg", 60, `等待共享 PG Running（${pg.status}）`, 15);
      return;
    }
    await sql`update shared_pgs set status = 'Failed', updated_at = now() where pg_instance_id = ${pgId}`;
    await failTask(task, `共享 PG 状态异常：${pg.status}`);
    return;
  }

  await failTask(task, `未知步骤：${task.step}`);
}

async function processAllocate(task: any, inst: any) {
  const payload = parseObject(task.payload);
  const adapter = cloudAdapter(payload.cloud_mode || CLOUD_MODE, inst.region_id);
  const step = task.step || "start";
  if (inst.status === "Available" || !inst.supabase_instance_id) {
    await setInstance(inst.id, { status: "InUse", error: null });
    await finishTask(task, { instance_id: inst.id, status: "InUse" });
    return;
  }
  if (step === "start") {
    await adapter.startSupabase(inst.supabase_instance_id);
    return scheduleTask(task, "wait_running", 40, "等待实例 Running", 5);
  }
  if (step === "wait_running") {
    const data = await adapter.describeSupabase(inst.supabase_instance_id);
    if (data.status !== "Running") return scheduleTask(task, "wait_running", 70, "等待实例 Running", 8);
    await setInstance(inst.id, {
      status: "InUse",
      error: null,
      cloud_status: "Running",
      detail: JSON.stringify({ ...parseObject(inst.detail), cloud: data }),
    });
    await finishTask(task, { instance_id: inst.id, status: "InUse" });
  }
}

async function processRelease(task: any, inst: any) {
  const payload = parseObject(task.payload);
  const adapter = cloudAdapter(payload.cloud_mode || CLOUD_MODE, inst.region_id);
  const step = task.step || (payload.destroy ? "delete_supabase" : "stop");
  const detail = parseObject(inst.detail);
  if (payload.destroy) {
    if (step === "delete_supabase") {
      if (inst.supabase_instance_id) await adapter.deleteSupabase(inst.supabase_instance_id);
      return scheduleTask(task, "delete_pg", 60, "删除 Supabase 完成", 2);
    }
    if (step === "delete_pg") {
      if (inst.mode === "single" && inst.pg_instance_id) await adapter.deletePg(inst.pg_instance_id);
      await setInstance(inst.id, { status: "Deleted", is_deleted: true, deleted_at: new Date(), error: null });
      await finishTask(task, { instance_id: inst.id, status: "Deleted" });
    }
    return;
  }
  if (step === "stop") {
    if (inst.supabase_instance_id) await adapter.stopSupabase(inst.supabase_instance_id, false);
    return scheduleTask(task, "wait_stopped", 60, "等待实例停止", 5);
  }
  if (step === "wait_stopped") {
    if (adapter.mode === "real" && inst.supabase_instance_id) {
      const data = await adapter.describeSupabase(inst.supabase_instance_id);
      if (data.status !== "Stopped") return scheduleTask(task, "wait_stopped", 75, "等待实例停止", 8);
    }
    const appName = detail.bound_app_name || inst.bound_app_id;
    const nextDetail = { ...detail, reserved: true, reserved_app_name: appName, reserved_user_id: inst.owner_user_id };
    await setInstance(inst.id, { status: "InCold", cloud_status: "Stopped", detail: JSON.stringify(nextDetail), error: null });
    await finishTask(task, { instance_id: inst.id, status: "InCold" });
  }
}

const DEFAULT_POOL_CONFIG = {
  target: 2, max: 4, batch_size: 1, batch_interval_sec: 6, poll_interval_sec: 8, create_timeout_sec: 900,
  auto_refill: false, refill_interval_sec: 30, release_policy: "return", stop_mode: "normal",
  single_pg_class: "pg.n2.2c.1m", single_pg_storage: 20, single_pg_category: "Basic",
  single_engine_version: "17.0", single_pg_security_ips: "127.0.0.1", public_endpoint_enabled: true,
  shared_pg_class: "pg.n2.2c.2m", shared_pg_storage: 20, shared_pg_category: "HighAvailability",
  shared_pg_engine_version: "18.0",
};

function poolConfig(value: unknown): Record<string, any> {
  return { ...DEFAULT_POOL_CONFIG, ...parseObject(value) };
}

async function regionView(regionId: string) {
  return (await regionsPayload()).find((region: any) => region.region_id === regionId) || null;
}

function sharedPgView(row: any) {
  return {
    pg_instance_id: row.pg_instance_id,
    pool_id: row.pool_id,
    name: row.name,
    region_id: row.region_id,
    status: row.status,
    instance_class: row.instance_class,
    engine_version: row.engine_version,
    storage_gb: row.storage_gb,
    vpc_id: row.vpc_id,
    vswitch_id: row.vswitch_id,
    zone_id: row.zone_id,
    enabled: !!row.enabled,
    weight: Number(row.weight || 1),
    reserved_slots: Number(row.reserved_slots || 0),
    tenant_count: Number(row.tenant_count || 0),
    capacity: parseObject(row.capacity),
    last_checked_at: row.last_checked_at,
    added_at: row.added_at,
  };
}

async function sharedPgRows(poolId?: string, regionId?: string) {
  const rows = poolId
    ? await sql`select * from shared_pgs where pool_id = ${poolId} order by added_at asc`
    : regionId
      ? await sql`select * from shared_pgs where region_id = ${regionId} order by added_at asc`
      : await sql`select * from shared_pgs order by added_at asc`;
  const counts = await sql`
    select pg_instance_id, count(*)::int as total from pool_instances
    where is_deleted = false and status != 'Failed' and pg_instance_id is not null
    group by pg_instance_id
  `;
  const byId = new Map(counts.map((item: any) => [item.pg_instance_id, Number(item.total)]));
  return rows.map((row: any) => sharedPgView({ ...row, tenant_count: byId.get(row.pg_instance_id) || 0 }));
}

function aggregateCapacity(rows: any[]) {
  if (!rows.length) return {};
  const sum = (key: string) => rows.reduce((total, row) => total + Number(row.capacity?.[key] || 0), 0);
  return {
    db_instance_name: `${rows.length} 个共享 PG`,
    active_ratio: rows.reduce((total, row) => total + Number(row.capacity?.active_ratio || 0), 0) / rows.length,
    estimated_max_active_tenants: sum("estimated_max_active_tenants"),
    estimated_max_total_tenants: sum("estimated_max_total_tenants"),
    current_active_tenants: rows.reduce((total, row) => total + Number(row.tenant_count || 0), 0),
    current_total_tenants: rows.reduce((total, row) => total + Number(row.tenant_count || 0), 0),
    shared_pg_count: rows.length,
  };
}

function capacityUnavailableMessage(err: unknown): string {
  const detail = (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/i, "").trim();
  if (/503|serviceunavailable|temporary failure/i.test(detail)) {
    return "RdsAi 容量接口在当前地域暂不可用（HTTP 503），请稍后重试；若持续失败，请联系阿里云确认容量灰度接口已在该地域开通。";
  }
  if (/invalidparameter|invalid parameter|provided parameter is invalid/i.test(detail)) {
    return "该 PG 或当前地域不支持容量接口，请确认 PG 为 HighAvailability 多租规格，并已开通容量灰度接口。";
  }
  return `容量接口调用失败：${detail || "未知错误"}`;
}

async function processAction(task: any, inst: any) {
  const payload = parseObject(task.payload);
  const adapter = cloudAdapter(payload.cloud_mode || CLOUD_MODE, inst.region_id);
  const action = String(payload.action || task.kind);
  const step = task.step || "run";
  if (step === "run") {
    if (action === "start") await adapter.startSupabase(inst.supabase_instance_id);
    else if (action === "stop") await adapter.stopSupabase(inst.supabase_instance_id, !!payload.force);
    else if (action === "restart") await adapter.restartSupabase(inst.supabase_instance_id);
    return scheduleTask(task, "wait", 50, `等待${action}完成`, 5);
  }
  if (step === "wait" && adapter.mode === "real") {
    const data = await adapter.describeSupabase(inst.supabase_instance_id);
    const expected = action === "stop" ? "Stopped" : "Running";
    if (data.status !== expected) return scheduleTask(task, "wait", 70, `等待${action}完成`, 8);
  }
  if (action === "stop") {
    await setInstance(inst.id, { status: inst.bound_app_id ? "InCold" : "InCold", cloud_status: "Stopped" });
  } else if (action === "start") {
    await setInstance(inst.id, { status: inst.bound_app_id ? "InUse" : "Available", cloud_status: "Running" });
  }
  await finishTask(task, { instance_id: inst.id, action });
}

async function enqueuePrewarm(pool: any, count: number): Promise<string[]> {
  const taskIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const instanceId = randomId();
    const appName = `pool-${pool.mode}-${randomToken(4)}`;
    const detail = { source: "edge-auto-prewarm", cloud_mode: CLOUD_MODE, pool_id: pool.id };
    await sql`
      insert into pool_instances (id, mode, pool_id, status, app_name, region_id, vpc_id, vswitch_id, instance_class, detail, is_deleted, created_at, updated_at)
      values (${instanceId}, ${pool.mode}, ${pool.id}, 'Creating', ${appName}, ${pool.region_id}, ${pool.vpc_id}, ${pool.vswitch_id},
              ${pool.mode === "shared" ? "rdsai.supabase.share.basic" : "rdsai.supabase.basic"},
              ${JSON.stringify(detail)}::json, false, now(), now())
    `;
    const taskId = randomId();
    await sql`
      insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
      values (${taskId}, 'prewarm', ${pool.mode}, ${pool.id}, ${instanceId}, ${`预热 ${appName}`}, 'pending', 0, '等待 worker',
              ${JSON.stringify({ instance_id: instanceId, cloud_mode: CLOUD_MODE, pool_id: pool.id })}::json, '{}'::json, 'prepare', 0, now())
    `;
    taskIds.push(taskId);
  }
  return taskIds;
}

async function maybeAutoRefill() {
  const rows = await sql`select * from pools where enabled = true`;
  for (const row of rows) {
    const config = parseObject(row.config);
    if (!config.auto_refill) continue;
    const pending = await sql`select count(*)::int as total from tasks where pool_id = ${row.id} and kind = 'prewarm' and status in ('pending','running')`;
    if (Number(pending[0].total) > 0) continue;
    if (row.mode === "shared") {
      const shared = await sql`select count(*)::int as total from shared_pgs where pool_id = ${row.id} and enabled = true and status = 'Running'`;
      if (Number(shared[0].total) === 0) continue;
    }
    const countRows = await sql`select count(*)::int as total from pool_instances where pool_id = ${row.id} and is_deleted = false`;
    const remaining = Math.min(Number(config.target || 2), Number(config.max || 4)) - Number(countRows[0].total);
    if (remaining > 0) await enqueuePrewarm(row, Math.min(remaining, 2));
  }
}

async function processSelfheal(task: any) {
  const stale = await sql`
    update pool_instances set status = 'Failed', error = '创建/释放超时，自愈巡检标记失败', updated_at = now()
    where is_deleted = false and status in ('Creating', 'Releasing')
      and updated_at < now() - interval '30 minutes'
    returning id
  `;
  await finishTask(task, { fixed: stale.length });
}

const CONTROL_ADMIN_DB_URL = (() => {
  const explicit = Deno.env.get("CONTROL_ADMIN_DB_URL") || "";
  if (explicit) return explicit;
  const raw = Deno.env.get("CONTROL_DB_URL") || "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.pathname = `/${Deno.env.get("CONTROL_ADMIN_DB_NAME") || "supabase_db"}`;
    return url.toString();
  } catch {
    return "";
  }
})();

async function adminDb() {
  if (!CONTROL_ADMIN_DB_URL) throw new Error("CONTROL_DB_URL 未配置");
  return postgres(CONTROL_ADMIN_DB_URL, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5 });
}

async function ensureSetupJobTable(admin: any) {
  await admin`
    create table if not exists setup_jobs (
      id varchar(40) primary key,
      kind varchar(40) not null default 'metadata_pg',
      status varchar(24) not null default 'running',
      progress integer not null default 0,
      message text,
      result json not null default '{}'::json,
      error text,
      payload json not null default '{}'::json,
      step varchar(40) not null default 'create_pg',
      attempts integer not null default 0,
      next_run_at timestamp,
      locked_at timestamp,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      finished_at timestamp
    )
  `;
}

function setupJobPayload(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: Number(row.progress || 0),
    message: row.message || "",
    result: parseObject(row.result),
    error: row.error || "",
    step: row.step,
    created_at: row.created_at,
    next_run_at: row.next_run_at,
    finished_at: row.finished_at,
  };
}

async function createSetupJob(payload: Record<string, any>) {
  const admin = await adminDb();
  try {
    await ensureSetupJobTable(admin);
    const id = randomId();
    const rows = await admin`
      insert into setup_jobs (id, kind, status, progress, message, payload, step, created_at, updated_at)
      values (${id}, 'metadata_pg', 'running', 0, '准备创建元数据 PG', ${JSON.stringify(payload)}::json, 'create_pg', now(), now())
      returning *
    `;
    return setupJobPayload(rows[0]);
  } finally {
    await admin.end({ timeout: 3 });
  }
}

async function getSetupJob(id: string) {
  const admin = await adminDb();
  try {
    await ensureSetupJobTable(admin);
    const rows = await admin`select * from setup_jobs where id = ${id} limit 1`;
    return rows[0] ? setupJobPayload(rows[0]) : null;
  } finally {
    await admin.end({ timeout: 3 });
  }
}

async function updateSetupJob(id: string, fields: Record<string, any>, delaySeconds?: number | null) {
  const allowed = new Set(["status", "progress", "message", "result", "error", "payload", "step", "attempts", "locked_at", "finished_at"]);
  const admin = await adminDb();
  try {
    await ensureSetupJobTable(admin);
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key) || value === undefined) continue;
      await admin.unsafe(`update setup_jobs set ${key} = $1, updated_at = now() where id = $2`, [value, id]);
    }
    if (delaySeconds !== undefined) {
      if (delaySeconds === null) {
        await admin`update setup_jobs set next_run_at = null, locked_at = null, updated_at = now() where id = ${id}`;
      } else {
        await admin`update setup_jobs set next_run_at = now() + make_interval(secs => ${delaySeconds}), locked_at = null, updated_at = now() where id = ${id}`;
      }
    }
  } finally {
    await admin.end({ timeout: 3 });
  }
}

async function processSetupJob(job: any) {
  const payload = parseObject(job.payload);
  const result = parseObject(job.result);
  const region = String(payload.region_id || defaultRegionId());
  const adapter = new RealAdapter(region);
  try {
    if (job.step === "create_pg") {
      const settings = (await configGet("settings")) || {};
      const poolRows = await sql`select * from pools where region_id = ${region} and mode = 'single' limit 1`;
      const pool: any = poolRows[0] || {};
      const config = poolConfig(pool.config);
      const vpcId = payload.vpc_id || settings.vpc_id || pool.vpc_id;
      const vswitchId = payload.vswitch_id || settings.vswitch_id || pool.vswitch_id;
      const zoneId = payload.zone_id || settings.zone_id || pool.zone_id || "";
      if (!vpcId || !vswitchId) throw new Error("请先在设置中选择 VPC 和 VSwitch");
      const ip = String(payload.ip || "");
      const pgId = await adapter.createPg({
        description: "pool-console-metadata",
        instance_class: "pg.n2.2c.1m",
        engine_version: "17.0",
        storage_gb: 20,
        category: "Basic",
        vpc_id: vpcId,
        vswitch_id: vswitchId,
        zone_id: zoneId,
        security_ip_list: ip || "127.0.0.1",
        client_token: `poolmeta-${job.id}`,
      });
      await updateSetupJob(job.id, {
        progress: 15,
        message: `PG 创建已受理：${pgId}，等待 Running`,
        result: JSON.stringify({ ...result, pg_id: pgId }),
        step: "wait_pg",
      }, 15);
      return;
    }
    const pgId = String(result.pg_id || "");
    if (!pgId) throw new Error("任务缺少 pg_id");
    if (job.step === "wait_pg") {
      const pg = await adapter.describePg(pgId);
      if (pg.status === "Running") {
        await updateSetupJob(job.id, { progress: 60, message: "创建高权限账号", step: "account" }, 0);
      } else if (["Creating", "Initializing", "Rebooting"].includes(String(pg.status || ""))) {
        await updateSetupJob(job.id, { progress: 30, message: `等待 PG Running（${pg.status}）` }, 15);
      } else {
        throw new Error(`PG 状态异常：${pg.status}`);
      }
      return;
    }
    if (job.step === "account") {
      let password = "";
      if (result.db_password) {
        try {
          password = await decryptConfig(String(result.db_password));
        } catch {
          password = "";
        }
      }
      if (!password) password = randomToken(24);
      try {
        await adapter.createPgAccount(pgId, "pool_admin", password);
      } catch (err) {
        if (!/exist/i.test(String(err))) throw err;
      }
      await updateSetupJob(job.id, {
        progress: 70,
        message: "申请公网连接地址",
        result: JSON.stringify({ ...result, db_password: await encryptConfig(password) }),
        step: "public",
      }, 2);
      return;
    }
    if (job.step === "public") {
      let net = await adapter.pgNet(pgId);
      if (!net.public_connection) {
        try {
          await adapter.allocatePgPublicConnection(pgId, `poolmeta-${pgId.slice(-8)}`, 5432);
        } catch {
          // re-read below
        }
        net = await adapter.pgNet(pgId);
      }
      if (!net.public_connection) throw new Error("公网连接地址申请失败");
      await updateSetupJob(job.id, {
        progress: 80,
        message: `追加 IP 白名单：${payload.ip || "自动检测"}`,
        result: JSON.stringify({ ...result, public_connection: `${net.public_connection}:${net.public_port}` }),
        step: "whitelist",
      }, 2);
      return;
    }
    if (job.step === "whitelist") {
      let ip = String(payload.ip || "");
      if (!ip) {
        const detected = await detectPublicIp();
        ip = detected.ip;
      }
      await adapter.appendPgWhitelist(pgId, ip);
      await updateSetupJob(job.id, { progress: 90, message: "创建元数据库并初始化表结构", step: "configure" }, 2);
      return;
    }
    if (job.step === "configure") {
      let password = "";
      if (result.db_password) password = await decryptConfig(String(result.db_password));
      const hostPort = String(result.public_connection || "").split(":");
      const configured = await configureMetadataTarget({
        host: hostPort[0],
        port: Number(hostPort[1] || 5432),
        database: "rds_pool_console",
        username: "pool_admin",
        password,
        sslmode: "require",
        pg_instance_id: pgId,
        source: "created",
        public_connection: result.public_connection,
      });
      await updateSetupJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: "元数据 PG 已就绪",
        result: JSON.stringify({ ...configured, pg_instance_id: pgId, public_connection: result.public_connection }),
        finished_at: new Date().toISOString(),
        step: "done",
      }, null);
      return;
    }
    throw new Error(`未知步骤：${job.step}`);
  } catch (err) {
    await updateSetupJob(job.id, {
      status: "failed",
      message: "创建失败",
      error: String(err),
      finished_at: new Date().toISOString(),
    }, null);
  }
}

async function processSetupJobsDue() {
  const admin = await adminDb();
  let job: any = null;
  try {
    await ensureSetupJobTable(admin);
    const rows = await admin`
      with picked as (
        select id from setup_jobs
        where status = 'running' and (next_run_at is null or next_run_at <= now())
          and (locked_at is null or locked_at < now() - interval '2 minutes')
        order by created_at limit 1 for update skip locked
      )
      update setup_jobs j set locked_at = now(), updated_at = now()
      from picked where j.id = picked.id returning j.*
    `;
    job = rows[0];
  } finally {
    await admin.end({ timeout: 3 });
  }
  if (job) await processSetupJob(job);
}

function startSetupJobRunner(jobId: string) {
  const run = (async () => {
    for (let index = 0; index < 120; index += 1) {
      const job = await getSetupJob(jobId);
      if (!job || job.status !== "running") return;
      const waitMs = Math.max(0, new Date(job.next_run_at || Date.now()).getTime() - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 15000)));
      await processSetupJobsDue();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })().catch((err) => console.error("setup job runner failed", String(err)));
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(run);
}

async function detectPublicIp() {
  const services: Array<[string, string]> = [
    ["https://api.ipify.org?format=json", "json"],
    ["https://ifconfig.me/ip", "text"],
    ["https://checkip.amazonaws.com", "text"],
  ];
  let lastError = "";
  for (const [serviceUrl, kind] of services) {
    try {
      const response = await fetch(serviceUrl, { signal: AbortSignal.timeout(4000) });
      const raw = (await response.text()).trim();
      const ip = kind === "json" ? String(JSON.parse(raw).ip || "") : raw.split(/\s+/)[0];
      if (ip) return { ip, source: serviceUrl };
    } catch (err) {
      lastError = String(err);
    }
  }
  throw new Error(`无法自动获取公网 IP，请手动填写。${lastError}`);
}

let lastAutoKick = 0;

function kickWorkerChain(force = false) {
  const now = Date.now();
  if (!force && now - lastAutoKick < 5000) return;
  lastAutoKick = now;
  const run = (async () => {
    await drainWorker(15000);
  })().catch((err) => console.error("auto worker failed", String(err)));
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(run);
}

function publicOriginFromRequest(req: Request, reqUrl: URL) {
  const forwardedHost = (req.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const hostHeader = (req.headers.get("host") || "").split(",")[0].trim();
  const host = forwardedHost || hostHeader;
  if (!host) return "";
  if (/e2b-api\.dbsandbox|localhost|127\.0\.0\.1|^kong(:|$)|^[0-9.]+(:|$)/i.test(host)) return "";
  const proto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim() || "https";
  return `${proto}://${host}`;
}

function schedulerCandidates(reqUrl: URL, req: Request, storedPublicUrl = "") {
  const prefix = reqUrl.pathname.split("/api/")[0];
  const sandboxSuffix = `${prefix}/api/internal/worker/tick`;
  const publicSuffix = "/functions/v1/pool-api/api/internal/worker/tick";
  const entries: Array<{ url: string; base: string; store: boolean }> = [];
  const add = (base: string, suffix: string, store: boolean) => {
    if (!base) return;
    const clean = base.replace(/\/$/, "");
    const url = `${clean}${suffix}`;
    if (!entries.some((entry) => entry.url === url)) entries.push({ url, base: clean, store });
  };
  add(Deno.env.get("SUPABASE_URL") || "", publicSuffix, false);
  add(publicOriginFromRequest(req, reqUrl), publicSuffix, true);
  add(storedPublicUrl, publicSuffix, false);
  add(Deno.env.get("SUPABASE_INTERNAL_URL") || "", publicSuffix, false);
  add(Deno.env.get("SUPABASE_PUBLIC_URL") || "", publicSuffix, false);
  add(reqUrl.origin, sandboxSuffix, false);
  add("http://localhost:8000", sandboxSuffix, false);
  add("http://kong:8000", sandboxSuffix, false);
  add("http://host.docker.internal:8000", sandboxSuffix, false);
  return entries;
}

async function workerTick() {
  await ensureWorkerSchema();
  const rows = await sql`
    with picked as (
      select id from tasks
      where status in ('pending', 'running')
        and (next_run_at is null or next_run_at <= now())
        and (locked_at is null or locked_at < now() - interval '2 minutes')
      order by created_at
      limit 1
      for update skip locked
    )
    update tasks t set status = 'running', locked_at = now(), started_at = coalesce(t.started_at, now())
    from picked where t.id = picked.id
    returning t.*
  `;
  const task: any = rows[0];
  if (!task) {
    await maybeAutoRefill();
    return { processed: 0 };
  }
  if (task.kind === "shared_pg_create") {
    try {
      await processSharedPgCreate(task);
      return { processed: 1, task_id: task.id, status: "ok" };
    } catch (err) {
      await failTask(task, String(err));
      return { processed: 1, task_id: task.id, status: "error", error: String(err) };
    }
  }
  if (!task.target_id) {
    if (task.kind === "selfheal") await processSelfheal(task);
    else await finishTask(task, {});
    return { processed: 1, task_id: task.id, status: "succeeded" };
  }
  const instances = await sql`select * from pool_instances where id = ${task.target_id} limit 1`;
  const inst: any = instances[0];
  if (!inst) {
    await failTask(task, "目标实例不存在");
    return { processed: 1, task_id: task.id, status: "failed" };
  }
  try {
    if (task.kind === "prewarm") await processPrewarm(task, inst);
    else if (task.kind === "allocate") await processAllocate(task, inst);
    else if (task.kind === "release") await processRelease(task, inst);
    else if (["start", "stop", "restart", "sync"].includes(task.kind)) await processAction(task, inst);
    else {
      await finishTask(task, { skipped: true });
    }
    return { processed: 1, task_id: task.id, status: "ok" };
  } catch (err) {
    await failTask(task, String(err));
    return { processed: 1, task_id: task.id, status: "error", error: String(err) };
  }
}

async function drainWorker(maxMs = 20000) {
  try {
    await processSetupJobsDue();
  } catch (err) {
    console.error("setup job tick failed", String(err));
  }
  const started = Date.now();
  let processed = 0;
  while (Date.now() - started < maxMs) {
    const result = await workerTick();
    if (!result?.processed) {
      const rows = await sql`
        select extract(epoch from (min(next_run_at) - now()))::float as wait_seconds
        from tasks where status in ('pending', 'running') and next_run_at is not null
      `;
      const waitSeconds = Number(rows[0]?.wait_seconds);
      const remaining = (maxMs - (Date.now() - started)) / 1000;
      if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > remaining) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(3000, Math.max(200, waitSeconds * 1000))));
      continue;
    }
    processed += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { processed };
}


async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const suffix = url.pathname.replace(/^.*\/functions\/v1\/[^/]+/, "") || "/";
  const path = suffix === "/" ? "/" : suffix;
  const method = req.method;
  try {
    try {
      await initControlPlane();
    } catch (initErr) {
      if (!(await maybeSelfWhitelistControlDb(initErr))) throw initErr;
      await initControlPlane(true);
    }
    if (!path.startsWith("/api/internal/")) kickWorkerChain();
    if (path === "/health" || path === "/api/health") {
      const rows = await sql`select count(*)::int as users from platform_users`;
      return json({
        status: "ok",
        cloud_mode: CLOUD_MODE,
        credentials: credentialInfo(),
        database: await metadataStatusPayload(),
        database_driver: "postgresql",
        users: rows[0].users,
      });
    }

    if (path === "/api/stream" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const regionId = url.searchParams.get("region_id") || "";
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          try {
            for (let index = 0; index < 20; index += 1) {
              const data = await overviewPayload(regionId);
              controller.enqueue(encoder.encode(`event: overview\ndata: ${JSON.stringify(data)}\n\n`));
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            controller.close();
          } catch (err) {
            try {
              controller.error(err);
            } catch {
              // client already disconnected
            }
          }
        },
      });
      return new Response(body, {
        headers: {
          ...CORS,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (path === "/api/auth/status" && method === "GET") {
      const users = await sql`select count(*)::int as total from platform_users`;
      const ctx = await authenticate(req);
      return json({
        configured: true,
        users_ready: users[0].total > 0,
        bootstrap_required: users[0].total === 0,
        authenticated: !!ctx,
        user: ctx?.user || null,
      });
    }

    if (path === "/api/auth/login" && method === "POST") {
      const body = await req.json();
      const rows = await sql`select * from platform_users where username = ${String(body.username || "").toLowerCase()} and enabled = true limit 1`;
      const user: any = rows[0];
      if (!user || !(await verifyPassword(String(body.password || ""), user.password_hash))) return error("用户名或密码错误，或账号已停用", 401);
      await sql`update platform_users set last_login_at = now() where id = ${user.id}`;
      const payload = await loginResponse(user);
      return json(payload, 200, {
        "Set-Cookie": `pool_console_token=${payload.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL}`,
      });
    }

    if (path === "/api/auth/bootstrap" && method === "POST") {
      const count = await sql`select count(*)::int as total from platform_users`;
      if (count[0].total > 0) return error("管理员账号已初始化，请直接登录");
      const body = await req.json();
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (username.length < 3 || password.length < 8) return error("用户名至少 3 位，密码至少 8 位");
      const rows = await sql`
        insert into platform_users (id, username, display_name, password_hash, role, enabled, token_version, created_at, updated_at, last_login_at)
        values (${crypto.randomUUID().replace(/-/g, "")}, ${username}, ${body.display_name || username}, ${await hashPassword(password)}, 'admin', true, 0, now(), now(), now())
        returning *
      `;
      const payload = await loginResponse(rows[0]);
      return json(payload, 200, {
        "Set-Cookie": `pool_console_token=${payload.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL}`,
      });
    }

    if (path === "/api/auth/me" && method === "GET") {
      const ctx = await authenticate(req);
      return ctx ? json(ctx.user) : error("请先登录", 401);
    }

    if (path === "/api/auth/password" && method === "POST") {
      const ctx = await authenticate(req);
      if (!ctx) return error("请先登录", 401);
      const body = await req.json();
      const rows = await sql`select * from platform_users where id = ${ctx.user.id} limit 1`;
      const user: any = rows[0];
      if (!user || !(await verifyPassword(String(body.old_password || ""), user.password_hash))) return error("原密码不正确");
      if (String(body.new_password || "").length < 8) return error("新密码至少 8 位");
      const updated = await sql`
        update platform_users
        set password_hash = ${await hashPassword(String(body.new_password))},
            token_version = coalesce(token_version, 0) + 1
        where id = ${ctx.user.id} returning *
      `;
      const payload = await loginResponse(updated[0]);
      return json(payload, 200, {
        "Set-Cookie": `pool_console_token=${payload.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL}`,
      });
    }

    if (path === "/api/auth/logout" && method === "POST") {
      return json({ logged_out: true }, 200, { "Set-Cookie": "pool_console_token=; Path=/; Max-Age=0" });
    }

    if (path === "/api/meta" && method === "GET") {
      return json({
        statuses: [
          { value: "Creating", label: "创建中" },
          { value: "Available", label: "可用" },
          { value: "InCold", label: "冷池空闲" },
          { value: "InUse", label: "使用中" },
          { value: "Releasing", label: "释放中" },
          { value: "Deleted", label: "已删除" },
          { value: "Failed", label: "失败" },
        ],
        modes: [
          { value: "single", label: "单租户池" },
          { value: "shared", label: "多租共享池" },
        ],
        cloud_modes: [
          { value: "real", label: "真实调用" },
          { value: "mock", label: "模拟模式" },
        ],
        release_policies: [
          { value: "return", label: "同应用复用" },
          { value: "destroy", label: "直接删除" },
        ],
        stop_modes: [
          { value: "normal", label: "普通停（保温）" },
          { value: "force", label: "Force 停（释放连接名额）" },
        ],
        task_kinds: [
          { value: "prewarm", label: "预热" },
          { value: "allocate", label: "分配" },
          { value: "release", label: "释放" },
          { value: "start", label: "启动" },
          { value: "stop", label: "停止" },
          { value: "restart", label: "重启" },
          { value: "sync", label: "同步" },
          { value: "selfheal", label: "自愈巡检" },
          { value: "shared_pg_create", label: "创建共享 PG" },
        ],
        cpu_options: [2, 4, 8],
      });
    }

    if ((path === "/api/v1/portal/tokens" || path === "/api/portal/tokens") && method === "GET") {
      const ctx = await authenticate(req);
      if (!ctx || ctx.scopes !== null) return error("需要使用浏览器登录态管理 Token", 403);
      const rows = await sql`select * from platform_tokens where user_id = ${ctx.user.id} order by created_at desc`;
      return json({ tokens: rows.map(tokenPublic), scopes: SCOPES });
    }

    if ((path === "/api/v1/portal/tokens" || path === "/api/portal/tokens") && method === "POST") {
      const ctx = await authenticate(req);
      if (!ctx || ctx.scopes !== null) return error("需要使用浏览器登录态管理 Token", 403);
      return json(await createPat(ctx.user, await req.json()));
    }

    if ((path.startsWith("/api/v1/portal/tokens/") || path.startsWith("/api/portal/tokens/")) && method === "DELETE") {
      const ctx = await authenticate(req);
      if (!ctx || ctx.scopes !== null) return error("需要使用浏览器登录态管理 Token", 403);
      const id = path.split("/").pop();
      await sql`update platform_tokens set revoked_at = now() where id = ${id} and user_id = ${ctx.user.id}`;
      return json({ revoked: true, id });
    }

    if ((path === "/api/v1/portal/overview" || path === "/api/portal/overview") && method === "GET") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "instances:read")) return error("API Token 缺少 instances:read 权限", 403);
      return json({
        user: ctx!.user,
        regions: await portalRegions(),
        instances: await portalInstances(ctx!.user.id),
        fetched_at: new Date().toISOString(),
      });
    }

    if ((path === "/api/v1/portal/instances" || path === "/api/portal/instances") && method === "GET") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "instances:read")) return error("API Token 缺少 instances:read 权限", 403);
      return json({ instances: await portalInstances(ctx!.user.id) });
    }

    if (/^\/api\/(v1\/)?portal\/instances\/[^/]+$/.test(path) && method === "GET") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "instances:read")) return error("API Token 缺少 instances:read 权限", 403);
      const id = path.split("/").pop();
      const rows = await sql`select * from pool_instances where id = ${id} and owner_user_id = ${ctx!.user.id} and is_deleted = false limit 1`;
      if (!rows[0]) return error("实例不存在或不属于当前用户", 404);
      return json((await portalInstances(ctx!.user.id)).find((item: any) => item.id === id) || {});
    }

    if (/^\/api\/(v1\/)?portal\/tasks\/[^/]+$/.test(path) && method === "GET") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "instances:read")) return error("API Token 缺少 instances:read 权限", 403);
      const id = path.split("/").pop();
      const rows = await sql`
        select t.* from tasks t join pool_instances i on i.id = t.target_id
        where t.id = ${id} and i.owner_user_id = ${ctx!.user.id}
        limit 1
      `;
      return rows[0] ? json(taskPayload(rows[0])) : error("任务不存在", 404);
    }

    if (path === "/api/internal/scheduler/diag" && method === "GET") {
      const expected = Deno.env.get("WORKER_TOKEN") || "";
      if (!expected) return error("WORKER_TOKEN 未配置", 503);
      if (req.headers.get("x-worker-token") !== expected) return error("worker token 无效", 401);
      const db = await adminDb();
      try {
        const extensions = await db`select extname, extversion from pg_extension where extname in ('pg_net', 'pg_cron') order by extname`;
        const functions = await db`
          select p.proname, pg_get_function_arguments(p.oid) as args
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'net' and p.proname = 'http_post'
        `;
        return json({ extensions, functions });
      } catch (err) {
        return error(`诊断失败: ${String(err)}`, 500);
      } finally {
        await db.end();
      }
    }

    if (path === "/api/internal/scheduler/setup" && method === "POST") {
      const expected = Deno.env.get("WORKER_TOKEN") || "";
      if (!expected) return error("WORKER_TOKEN 未配置", 503);
      if (req.headers.get("x-worker-token") !== expected) return error("worker token 无效", 401);
      const db = await adminDb();
      let stage = "extensions";
      try {
        const storedPublicUrl = (await configGet("public_url"))?.url || "";
        await db`create extension if not exists pg_net`;
        await db`create extension if not exists pg_cron`;
        stage = "unschedule";
        await db`select cron.unschedule(jobid) from cron.job where jobname = 'pool-worker-tick'`;
        const headers = JSON.stringify({ "Content-Type": "application/json", "X-Worker-Token": expected });
        const tests: any[] = [];
        stage = "egress-test";
        const escapeLiteral = (value: string) => value.replace(/'/g, "''");
        for (const target of schedulerCandidates(url, req, storedPublicUrl)) {
          const probeUrl = `${target.url}${target.url.includes("?") ? "&" : "?"}dry=1`;
          const query = `select net.http_post(url := '${escapeLiteral(probeUrl)}', headers := '${escapeLiteral(headers)}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 15000) as request_id`;
          const rows = await db.unsafe(query);
          tests.push({ url: target.url, base: target.base, store: target.store, probe_url: probeUrl, request_id: rows[0]?.request_id });
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
        for (let round = 0; round < 20; round += 1) {
          let answered = 0;
          for (const item of tests) {
            try {
              const rows = await db`select status_code, error_msg, timed_out from net._http_response where id = ${item.request_id} limit 1`;
              if (rows[0]) {
                item.response = rows[0];
                answered += 1;
              }
            } catch (err) {
              item.response = { error: String(err) };
            }
          }
          if (tests.some((item) => Number(item.response?.status_code) === 200)) break;
          if (answered === tests.length) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const working = tests.find((item) => Number(item.response?.status_code) === 200);
        const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
        const fallback = tests.find((item) => supabaseUrl && item.url.startsWith(supabaseUrl))
          || tests.find((item) => item.url.startsWith(url.origin))
          || tests[0];
        const tickUrl = working?.url || fallback?.url;
        if (working?.store) await configSet("public_url", { url: working.base });
        const escapedUrl = String(tickUrl).replace(/'/g, "''");
        const escapedHeaders = headers.replace(/'/g, "''");
        const command = `select net.http_post(url := '${escapedUrl}', headers := '${escapedHeaders}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 60000)`;
        await db`select cron.schedule('pool-worker-tick', '* * * * *', ${command})`;
        const jobs = await db`select jobid, jobname, schedule, active from cron.job where jobname = 'pool-worker-tick'`;
        return json({
          ok: !!working,
          tick_url: tickUrl,
          public_url: working?.store ? working.base : storedPublicUrl,
          request: {
            url: req.url,
            host: req.headers.get("host"),
            forwarded_host: req.headers.get("x-forwarded-host"),
            forwarded_proto: req.headers.get("x-forwarded-proto"),
            env_supabase_url: Deno.env.get("SUPABASE_URL") || "",
            env_internal_url: Deno.env.get("SUPABASE_INTERNAL_URL") || "",
            env_public_url: Deno.env.get("SUPABASE_PUBLIC_URL") || "",
          },
          egress_tests: tests,
          job: jobs[0] || null,
          message: working ? "worker 调度已启用" : "pg_cron 已配置，但 pg_net 出口测试未通过",
        });
      } catch (err) {
        return error(`调度初始化失败(${stage}): ${String(err)}`, 500);
      } finally {
        await db.end();
      }
    }

    if (path === "/api/internal/scheduler/status" && method === "GET") {
      const expected = Deno.env.get("WORKER_TOKEN") || "";
      if (!expected) return error("WORKER_TOKEN 未配置", 503);
      if (req.headers.get("x-worker-token") !== expected) return error("worker token 无效", 401);
      const db = await adminDb();
      try {
        const jobs = await db`select jobid, jobname, schedule, active from cron.job where jobname = 'pool-worker-tick'`;
        let runs: any[] = [];
        let responses: any[] = [];
        try {
          runs = await db`select jobid, runid, status, return_message, start_time, end_time from cron.job_run_details where jobid in (select jobid from cron.job where jobname = 'pool-worker-tick') order by start_time desc limit 8`;
        } catch (err) {
          runs = [{ error: String(err) }];
        }
        try {
          responses = await db`select id, status_code, error_msg, timed_out, created from net._http_response order by id desc limit 8`;
        } catch (err) {
          responses = [{ error: String(err) }];
        }
        return json({ jobs, runs, responses, pending: (await sql`select count(*)::int as total from tasks where status in ('pending', 'running')`)[0]?.total || 0, tasks: await sql`select id, kind, status, step, attempts, message, created_at, started_at, finished_at from tasks order by created_at desc limit 6` });
      } catch (err) {
        return error(`调度状态读取失败: ${String(err)}`, 500);
      } finally {
        await db.end();
      }
    }

    if (path === "/api/internal/worker/tick" && method === "POST") {
      const expected = Deno.env.get("WORKER_TOKEN") || "";
      if (!expected) return error("WORKER_TOKEN 未配置", 503);
      if (req.headers.get("x-worker-token") !== expected) return error("worker token 无效", 401);
      if (url.searchParams.get("dry") === "1") return json({ ok: true, dry: true });
      return json(await drainWorker(25000));
    }

    if (path === "/api/instances/prewarm" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      const poolId = String(body.pool_id || "");
      const mode = String(body.mode || "");
      let pool: any = null;
      if (poolId) {
        const rows = await sql`select * from pools where id = ${poolId} limit 1`;
        pool = rows[0];
      } else if (["single", "shared"].includes(mode)) {
        const stored = (await configGet("settings")) || {};
        const regionId = String(body.region_id || stored.region_id || (await regionsPayload())[0]?.region_id || "");
        const rows = await sql`select * from pools where region_id = ${regionId} and mode = ${mode} limit 1`;
        pool = rows[0];
      }
      if (!pool) return error("资源池不存在");
      const regionRows = await sql`select * from regions where region_id = ${pool.region_id} limit 1`;
      if (regionRows[0] && !regionRows[0].enabled) return error("该地域已停用，不能预热");
      if (!pool.enabled) return error("资源池已停用，不能预热");
      if (pool.mode === "shared") {
        const shared = await sql`select count(*)::int as total from shared_pgs where pool_id = ${pool.id} and enabled = true and status = 'Running'`;
        if (Number(shared[0].total) === 0) return error("该共享池没有可用的共享 PG，请先添加共享 PG");
      } else if (!pool.vswitch_id) {
        return error("该单租池未配置 VSwitch");
      }
      const config = poolConfig(pool.config);
      const totalRows = await sql`select count(*)::int as total from pool_instances where pool_id = ${pool.id} and is_deleted = false`;
      const remaining = Number(config.max) - Number(totalRows[0].total);
      if (remaining <= 0) return error(`${pool.name || pool.mode} 已达到最大实例数 ${config.max}`);
      const count = Math.max(1, Math.min(10, Number(body.count || 1), remaining));
      const taskIds: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const instanceId = randomId();
        const appName = `pool-${pool.mode}-${randomToken(4)}`;
        const detail = { source: "edge-prewarm", cloud_mode: CLOUD_MODE, pool_id: pool.id };
        await sql`
          insert into pool_instances (id, mode, pool_id, status, app_name, region_id, vpc_id, vswitch_id, instance_class, detail, is_deleted, created_at, updated_at)
          values (${instanceId}, ${pool.mode}, ${pool.id}, 'Creating', ${appName}, ${pool.region_id}, ${pool.vpc_id}, ${pool.vswitch_id},
                  ${pool.mode === "shared" ? "rdsai.supabase.share.basic" : "rdsai.supabase.basic"},
                  ${JSON.stringify(detail)}::json, false, now(), now())
        `;
        const taskId = randomId();
        await sql`
          insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
          values (${taskId}, 'prewarm', ${pool.mode}, ${pool.id}, ${instanceId}, ${`预热 ${appName}`}, 'pending', 0, '等待 worker',
                  ${JSON.stringify({ instance_id: instanceId, cloud_mode: CLOUD_MODE, pool_id: pool.id })}::json, '{}'::json, 'prepare', 0, now())
        `;
        taskIds.push(taskId);
      }
      return json({ task_ids: taskIds, count: taskIds.length, pool_id: pool.id });
    }

    if ((path === "/api/v1/portal/instances/apply" || path === "/api/portal/instances/apply") && method === "POST") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "instances:apply")) return error("API Token 缺少 instances:apply 权限", 403);
      const body = await req.json();
      const regionId = String(body.region_id || "");
      const mode = String(body.mode || "");
      const appName = String(body.app_name || "").trim();
      if (!appName || !["single", "shared"].includes(mode)) return error("region_id、mode、app_name 不能为空");
      const regionRows = await sql`select * from regions where region_id = ${regionId} and enabled = true and portal_enabled = true limit 1`;
      const region: any = regionRows[0];
      if (!region) return error("该地域未开放申请");
      const allowedModes = region.portal_pool_mode === "both" ? ["single", "shared"] : [region.portal_pool_mode];
      if (!allowedModes.includes(mode)) return error("该地域未开放所选池模式");
      const poolRows = await sql`select * from pools where region_id = ${regionId} and mode = ${mode} and enabled = true limit 1`;
      const pool: any = poolRows[0];
      if (!pool) return error("资源池不存在");
      const active = await sql`
        select * from pool_instances
        where owner_user_id = ${ctx!.user.id} and is_deleted = false
          and detail->>'bound_app_name' = ${appName}
          and status in ('Creating', 'Available', 'InUse')
        limit 1
      `;
      if (active[0]) return error("该应用已有运行中的实例，请先归还", 409);
      const candidates = await sql`
        select * from pool_instances
        where pool_id = ${pool.id} and is_deleted = false and status = 'InCold'
          and coalesce(detail->>'reserved', 'false') != 'true'
          and owner_user_id is null
        order by created_at asc limit 1
      `;
      const instance: any = candidates[0];
      if (!instance) return error("该地域冷池暂无可用实例，请联系管理员预热", 409);
      const detail = { ...parseObject(instance.detail), bound_app_name: appName };
      await setInstance(instance.id, {
        status: "InUse",
        owner_user_id: ctx!.user.id,
        bound_user: ctx!.user.username,
        bound_app_id: instance.bound_app_id || `app-${randomToken(6)}`,
        detail: JSON.stringify(detail),
        error: null,
      });
      const taskId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${taskId}, 'allocate', ${mode}, ${pool.id}, ${instance.id}, ${`分配 ${appName}`}, 'pending', 0, '等待 worker',
                ${JSON.stringify({ instance_id: instance.id, cloud_mode: detail.cloud_mode || CLOUD_MODE, app_name: appName })}::json, '{}'::json, 'start', 0, now())
      `;
      await writeAuditEvent(instance.id, "allocate", `分配给应用 ${appName}`, { app_name: appName, user: ctx!.user.username });
      return json({ task_id: taskId, instance_id: instance.id, app_name: appName, region_id: regionId });
    }

    if (/^\/api\/(v1\/)?portal\/instances\/[^/]+\/release$/.test(path) && method === "POST") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "instances:release")) return error("API Token 缺少 instances:release 权限", 403);
      const id = path.split("/").slice(-2)[0];
      const rows = await sql`select * from pool_instances where id = ${id} and owner_user_id = ${ctx!.user.id} and is_deleted = false limit 1`;
      const inst: any = rows[0];
      if (!inst) return error("实例不存在或不属于当前用户", 404);
      if (inst.status !== "InUse") return error("只有使用中的实例可以归还", 400);
      await setInstance(inst.id, { status: "Releasing" });
      const taskId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${taskId}, 'release', ${inst.mode}, ${inst.pool_id}, ${inst.id}, ${`归还 ${inst.app_name}`}, 'pending', 0, '等待 worker',
                ${JSON.stringify({ instance_id: inst.id, cloud_mode: parseObject(inst.detail).cloud_mode || CLOUD_MODE, destroy: false })}::json, '{}'::json, 'stop', 0, now())
      `;
      await writeAuditEvent(inst.id, "release", "使用者归还实例", { destroy: false, user: ctx!.user.username });
      return json({ task_id: taskId, destroy: false });
    }

    if (/^\/api\/regions\/[^/]+$/.test(path) && method === "PATCH") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const regionId = path.split("/").pop();
      const body = await req.json();
      if (body.portal_pool_mode && !["single", "shared", "both"].includes(body.portal_pool_mode)) return error("portal_pool_mode 无效");
      if (body.name !== undefined) await sql`update regions set name = ${body.name} where region_id = ${regionId}`;
      if (body.enabled !== undefined) await sql`update regions set enabled = ${!!body.enabled} where region_id = ${regionId}`;
      if (body.portal_enabled !== undefined) await sql`update regions set portal_enabled = ${!!body.portal_enabled} where region_id = ${regionId}`;
      if (body.portal_pool_mode !== undefined) await sql`update regions set portal_pool_mode = ${body.portal_pool_mode} where region_id = ${regionId}`;
      return json({ region_id: regionId, updated: true });
    }

    if (path === "/api/regions" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      return json({ regions: await regionsPayload() });
    }

    if (/^\/api\/regions\/[^/]+$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const region = await regionView(path.split("/").pop()!);
      return region ? json(region) : error("地域不存在", 404);
    }

    if (path === "/api/regions" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      const regionId = String(body.region_id || "").trim();
      if (!/^[a-z]{2}-[a-z0-9-]+$/.test(regionId)) return error("地域 ID 格式不正确，例如 cn-chengdu");
      const existing = await sql`select region_id from regions where region_id = ${regionId} limit 1`;
      if (existing[0]) return error("地域已存在");
      const adapter = cloudAdapter(CLOUD_MODE, regionId);
      const vpcs = await adapter.listVpcs();
      if (!vpcs.some((item: any) => item.vpc_id === body.vpc_id)) return error("VPC 不属于该地域或不可访问");
      const switches = await adapter.listVSwitches(String(body.vpc_id || ""));
      const matched = switches.find((item: any) => item.vswitch_id === body.vswitch_id);
      if (!matched) return error("VSwitch 不属于该 VPC");
      const zoneId = body.zone_id || matched.zone_id || "";
      const config = { ...DEFAULT_POOL_CONFIG };
      const name = String(body.name || regionId).trim() || regionId;
      await sql`
        insert into regions (region_id, name, enabled, portal_enabled, portal_pool_mode, created_at)
        values (${regionId}, ${name}, true, true, 'shared', now())
      `;
      for (const mode of ["single", "shared"]) {
        await sql`
          insert into pools (id, region_id, mode, name, enabled, vpc_id, vswitch_id, zone_id, config, created_at, updated_at)
          values (${randomId()}, ${regionId}, ${mode}, ${`${name} · ${mode === "single" ? "单租户池" : "多租共享池"}`}, true,
                  ${body.vpc_id}, ${body.vswitch_id}, ${zoneId}, ${JSON.stringify(config)}::json, now(), now())
        `;
      }
      return json(await regionView(regionId));
    }

    if (path === "/api/pools" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const regionId = url.searchParams.get("region_id");
      const regions = await regionsPayload();
      const pools = regions.flatMap((region: any) => region.pools);
      return json({ pools: regionId ? pools.filter((pool: any) => pool.region_id === regionId) : pools });
    }

    if (/^\/api\/pools\/[^/]+$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").pop();
      const regions = await regionsPayload();
      const pool = regions.flatMap((region: any) => region.pools).find((item: any) => item.id === id);
      return pool ? json(pool) : error("资源池不存在", 404);
    }

    if (/^\/api\/pools\/[^/]+$/.test(path) && method === "PATCH") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").pop();
      const body = await req.json();
      const rows = await sql`select * from pools where id = ${id} limit 1`;
      const pool: any = rows[0];
      if (!pool) return error("资源池不存在", 404);
      const nextConfig = poolConfig(body.config !== undefined ? body.config : pool.config);
      if (Number(nextConfig.target) > Number(nextConfig.max)) return error("目标水位不能大于最大实例数");
      await sql`
        update pools set
          name = ${body.name ?? pool.name},
          enabled = ${body.enabled !== undefined ? !!body.enabled : pool.enabled},
          vpc_id = ${body.vpc_id ?? pool.vpc_id},
          vswitch_id = ${body.vswitch_id ?? pool.vswitch_id},
          zone_id = ${body.zone_id ?? pool.zone_id},
          config = ${JSON.stringify(nextConfig)}::json,
          updated_at = now()
        where id = ${id}
      `;
      return json((await regionsPayload()).flatMap((region: any) => region.pools).find((item: any) => item.id === id));
    }

    if (/^\/api\/pools\/[^/]+\/shared-pgs$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const poolId = path.split("/").slice(-2)[0];
      return json({ shared_pgs: await sharedPgRows(poolId) });
    }

    if (path === "/api/shared-pgs" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      return json({ shared_pgs: await sharedPgRows(undefined, url.searchParams.get("region_id") || undefined) });
    }

    if (/^\/api\/pools\/[^/]+\/shared-pgs\/create$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const poolId = path.split("/").slice(-3)[0];
      const body = await req.json();
      const poolRows = await sql`select * from pools where id = ${poolId} limit 1`;
      const pool: any = poolRows[0];
      if (!pool || pool.mode !== "shared") return error("共享池不存在", 404);
      if (!pool.vpc_id || !pool.vswitch_id) return error("共享池未配置 VPC / VSwitch");
      const config = poolConfig(pool.config);
      const name = String(body.name || "").trim() || `共享 PG ${randomToken(4)}`;
      const taskId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${taskId}, 'shared_pg_create', 'shared', ${pool.id}, ${pool.id}, ${`创建共享 PG ${name}`}, 'pending', 0, '等待 worker',
                ${JSON.stringify({
                  pool_id: pool.id,
                  cloud_mode: CLOUD_MODE,
                  name,
                  instance_class: String(body.instance_class || config.shared_pg_class),
                  engine_version: String(body.engine_version || config.shared_pg_engine_version),
                  storage_gb: Number(body.storage_gb || config.shared_pg_storage),
                  zone_id: String(body.zone_id || pool.zone_id || ""),
                })}::json, '{}'::json, 'create_pg', 0, now())
      `;
      return json({ task_id: taskId, pool_id: pool.id, name });
    }

    if (/^\/api\/pools\/[^/]+\/shared-pgs$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const poolId = path.split("/").slice(-2)[0];
      const body = await req.json();
      const poolRows = await sql`select * from pools where id = ${poolId} limit 1`;
      const pool: any = poolRows[0];
      if (!pool || pool.mode !== "shared") return error("共享池不存在", 404);
      const adapter = cloudAdapter(CLOUD_MODE, pool.region_id);
      const pgId = String(body.pg_instance_id || "").trim();
      if (!pgId) return error("请选择 PG");
      const pg = await adapter.describePg(pgId);
      if (String(pg.status || "").toLowerCase() !== "running") return error("只有 Running 的 PG 可以加入共享池");
      let capacity: Record<string, any> = {};
      try {
        capacity = await adapter.getCapacity(pgId);
      } catch {
        capacity = {};
      }
      await sql`
        insert into shared_pgs (pg_instance_id, pool_id, name, region_id, status, instance_class, engine_version, storage_gb,
                                vpc_id, vswitch_id, zone_id, enabled, weight, reserved_slots, capacity, added_at, updated_at, last_checked_at)
        values (${pgId}, ${poolId}, ${body.name || pgId}, ${pool.region_id}, ${pg.status}, '', '', null,
                ${pg.vpc_id || null}, ${pg.vswitch_id || null}, ${pg.zone_id || null}, true, 1, 0,
                ${JSON.stringify(capacity)}::json, now(), now(), now())
        on conflict (pg_instance_id) do update set pool_id = excluded.pool_id, name = excluded.name,
          region_id = excluded.region_id, status = excluded.status, vpc_id = excluded.vpc_id,
          vswitch_id = excluded.vswitch_id, zone_id = excluded.zone_id, capacity = excluded.capacity,
          enabled = true, updated_at = now(), last_checked_at = now()
      `;
      return json((await sharedPgRows(poolId)).find((item: any) => item.pg_instance_id === pgId));
    }

    if (/^\/api\/shared-pgs\/[^/]+$/.test(path) && (method === "PATCH" || method === "DELETE")) {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const pgId = path.split("/").pop()!;
      if (method === "DELETE") {
        const deleteCloud = url.searchParams.get("delete_cloud") === "1";
        const rows = await sql`select * from shared_pgs where pg_instance_id = ${pgId} limit 1`;
        const row: any = rows[0];
        if (!row && !deleteCloud) return error("共享 PG 不存在", 404);
        const tenants = await sql`select count(*)::int as total from pool_instances where pg_instance_id = ${pgId} and is_deleted = false`;
        if (Number(tenants[0].total) > 0) return error("该 PG 上还有租户，只能停用，不能移除");
        if (deleteCloud) {
          const adapter = cloudAdapter(CLOUD_MODE, row?.region_id || url.searchParams.get("region_id") || defaultRegionId());
          await adapter.deletePg(pgId);
        }
        await sql`delete from shared_pgs where pg_instance_id = ${pgId}`;
        return json({ removed: true, pg_instance_id: pgId, cloud_deleted: deleteCloud });
      }
      const body = await req.json();
      const rows = await sql`select * from shared_pgs where pg_instance_id = ${pgId} limit 1`;
      const row: any = rows[0];
      if (!row) return error("共享 PG 不存在", 404);
      await sql`
        update shared_pgs set name = ${body.name ?? row.name}, enabled = ${body.enabled !== undefined ? !!body.enabled : row.enabled},
          weight = ${body.weight ?? row.weight}, updated_at = now()
        where pg_instance_id = ${pgId}
      `;
      return json((await sharedPgRows(row.pool_id)).find((item: any) => item.pg_instance_id === pgId));
    }

    if (/^\/api\/shared-pgs\/[^/]+\/sync$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const pgId = path.split("/").slice(-2)[0];
      const rows = await sql`select * from shared_pgs where pg_instance_id = ${pgId} limit 1`;
      const row: any = rows[0];
      if (!row) return error("共享 PG 不存在", 404);
      const adapter = cloudAdapter(CLOUD_MODE, row.region_id);
      const pg = await adapter.describePg(pgId);
      let capacity: any = null;
      try {
        capacity = await adapter.getCapacity(pgId);
      } catch {
        capacity = row.capacity || {};
      }
      await sql`
        update shared_pgs set status = ${pg.status}, vpc_id = ${pg.vpc_id || row.vpc_id},
          vswitch_id = ${pg.vswitch_id || row.vswitch_id}, zone_id = ${pg.zone_id || row.zone_id},
          capacity = ${JSON.stringify(capacity)}::json, last_checked_at = now(), updated_at = now()
        where pg_instance_id = ${pgId}
      `;
      return json((await sharedPgRows(row.pool_id)).find((item: any) => item.pg_instance_id === pgId));
    }

    if (path === "/api/resources/vpcs" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const region = url.searchParams.get("region_id") || (await regionsPayload())[0]?.region_id || defaultRegionId();
      const adapter = cloudAdapter(CLOUD_MODE, region);
      return json({ mode: adapter.mode, region_id: region, vpcs: await adapter.listVpcs() });
    }

    if (path === "/api/resources/vswitches" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const region = url.searchParams.get("region_id") || (await regionsPayload())[0]?.region_id || defaultRegionId();
      const vpcId = url.searchParams.get("vpc_id") || "";
      const adapter = cloudAdapter(CLOUD_MODE, region);
      return json({ mode: adapter.mode, vswitches: await adapter.listVSwitches(vpcId) });
    }

    if (path === "/api/resources/pgs" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const region = url.searchParams.get("region_id") || (await regionsPayload())[0]?.region_id || defaultRegionId();
      const adapter = cloudAdapter(CLOUD_MODE, region);
      return json({ mode: adapter.mode, pgs: await adapter.listPgs() });
    }

    if (/^\/api\/resources\/pgs\/[^/]+\/net$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const pgId = path.split("/").slice(-2)[0];
      const region = url.searchParams.get("region_id") || (await regionsPayload())[0]?.region_id || defaultRegionId();
      const adapter = cloudAdapter(CLOUD_MODE, region);
      return json({ mode: adapter.mode, ...(await adapter.pgNet(pgId)) });
    }

    if (path === "/api/metadata/status" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      return json(await metadataStatusPayload());
    }

    if (path === "/api/network/my-ip" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      let ip = "";
      let source = "";
      try {
        const response = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) });
        const data = await response.json();
        ip = String(data.ip || "");
        source = "ipify";
      } catch {
        // try secondary service
      }
      if (!ip) {
        try {
          const response = await fetch("https://ifconfig.me/ip", { signal: AbortSignal.timeout(4000) });
          ip = (await response.text()).trim();
          source = "ifconfig.me";
        } catch {
          // fall back to request headers
        }
      }
      if (!ip) {
        ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
        source = "request-header";
      }
      return ip ? json({ ip, source }) : error("无法探测公网 IP", 502);
    }

    if (path === "/api/metadata/discover" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const region = url.searchParams.get("region_id") || (await regionsPayload())[0]?.region_id || defaultRegionId();
      const adapter = cloudAdapter(CLOUD_MODE, region);
      return json({ mode: adapter.mode, pgs: await adapter.listPgs() });
    }

    if (path === "/api/metadata/test" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      try {
        return json(await testPgConnection(body));
      } catch (err) {
        return error(`连接失败：${String(err)}`, 400);
      }
    }

    if (path === "/api/metadata/configure" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      const stored = (await configGet("settings")) || {};
      const region = String(body.region_id || stored.region_id || defaultRegionId());
      try {
        if (body.pg_instance_id) {
          if (CLOUD_MODE === "mock") return error("Mock 模式下发现的是模拟 PG，无法作为元数据库；请切换真实模式或手动填写连接信息");
          const adapter = new RealAdapter(region);
          let ip = String(body.ip || "");
          if (!ip) {
            try {
              ip = (await detectPublicIp()).ip;
            } catch {
              ip = "";
            }
          }
          const result = await configureExistingPg(adapter, {
            pg_instance_id: String(body.pg_instance_id),
            database: String(body.database || "rds_pool_console"),
            username: String(body.username || ""),
            password: String(body.password || ""),
            ip,
            sslmode: String(body.sslmode || "require"),
            ensure_public: body.ensure_public !== false,
          });
          return json(result);
        }
        if (!body.host) return error("请提供 host 或选择已有 PG");
        const result = await configureMetadataTarget({
          host: String(body.host),
          port: Number(body.port || 5432),
          database: String(body.database || "rds_pool_console"),
          username: String(body.username || ""),
          password: String(body.password || ""),
          sslmode: String(body.sslmode || "require"),
          pg_instance_id: String(body.pg_instance_id || ""),
          source: "manual",
        });
        return json(result);
      } catch (err) {
        return error(String(err), 400);
      }
    }

    if (path === "/api/metadata/auto-create" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      if (CLOUD_MODE !== "real") return error("自动创建元数据 PG 需要真实模式与 AK/SK");
      if (!credentialInfo().has_credentials) return error("未配置 AK/SK");
      const body = await req.json();
      const stored = (await configGet("settings")) || {};
      if (!stored.vpc_id || !stored.vswitch_id) return error("请先选择 VPC 和 VSwitch");
      const job = await createSetupJob({
        ip: String(body.ip || ""),
        region_id: String(body.region_id || stored.region_id || defaultRegionId()),
        vpc_id: stored.vpc_id,
        vswitch_id: stored.vswitch_id,
        zone_id: stored.zone_id || "",
      });
      startSetupJobRunner(job.id);
      return json(job);
    }

    if (/^\/api\/metadata\/jobs\/[^/]+$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const job = await getSetupJob(path.split("/").pop()!);
      return job ? json(job) : error("任务不存在", 404);
    }

    if (path === "/api/capacity" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const pgId = url.searchParams.get("pg_id");
      if (!pgId) {
        const regionId = url.searchParams.get("region_id") || "";
        const pgs = await sharedPgRows(undefined, regionId || undefined);
        return json({ region_id: regionId, pool_id: pgs[0]?.pool_id || null, shared_pgs: pgs, aggregate: aggregateCapacity(pgs) });
      }
      const rows = await sql`select * from shared_pgs where pg_instance_id = ${pgId} limit 1`;
      const row: any = rows[0];
      const adapter = cloudAdapter(CLOUD_MODE, row?.region_id || url.searchParams.get("region_id") || defaultRegionId());
      try {
        const capacity = await adapter.getCapacity(pgId);
        if (row) {
          await sql`update shared_pgs set capacity = ${JSON.stringify(capacity)}::json, last_checked_at = now() where pg_instance_id = ${pgId}`;
        }
        return json({ pg_id: pgId, region_id: row?.region_id || "", pool_id: row?.pool_id || null, mode: adapter.mode, capacity, capacity_error: null, stale: false });
      } catch (err) {
        const cached = parseObject(row?.capacity);
        const capacity = Object.keys(cached).length ? cached : null;
        return json({
          pg_id: pgId,
          region_id: row?.region_id || "",
          pool_id: row?.pool_id || null,
          mode: adapter.mode,
          capacity,
          capacity_error: capacityUnavailableMessage(err),
          stale: !!capacity,
        });
      }
    }

    if (path === "/api/capacity" && method === "PUT") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      const pgId = String(body.pg_id || "");
      const ratio = Number(body.active_ratio);
      if (!pgId || !(ratio >= 0.1 && ratio <= 1)) return error("pg_id 和 active_ratio[0.1,1] 必填");
      const rows = await sql`select * from shared_pgs where pg_instance_id = ${pgId} limit 1`;
      const row: any = rows[0];
      const adapter = cloudAdapter(CLOUD_MODE, row?.region_id || url.searchParams.get("region_id") || defaultRegionId());
      try {
        const capacity = await adapter.modifyCapacity(pgId, ratio);
        if (row) {
          await sql`update shared_pgs set capacity = ${JSON.stringify(capacity)}::json, last_checked_at = now() where pg_instance_id = ${pgId}`;
        }
        return json({ pg_id: pgId, mode: adapter.mode, capacity, message: capacity.message || "" });
      } catch (err) {
        return error(capacityUnavailableMessage(err), 422);
      }
    }

    if (path === "/api/settings" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const regions = await regionsPayload();
      const firstRegion = regions[0];
      const firstPool = firstRegion?.pools?.[0];
      const stored = (await configGet("settings")) || {};
      const metadata = await metadataStatusPayload();
      const settings = {
        region_id: stored.region_id || firstRegion?.region_id || "",
        vpc_id: stored.vpc_id || firstRegion?.pools?.[0]?.vpc_id || "",
        vswitch_id: stored.vswitch_id || firstRegion?.pools?.[0]?.vswitch_id || "",
        zone_id: stored.zone_id || firstRegion?.pools?.[0]?.zone_id || "",
        shared_pg_id: stored.shared_pg_id || (await sharedPgRows(undefined, firstRegion?.region_id))[0]?.pg_instance_id || "",
        mode: CLOUD_MODE,
        pool: stored.pool || firstPool?.config || DEFAULT_POOL_CONFIG,
        metadata_pg: {
          host: metadata.host,
          port: metadata.port,
          database: metadata.database,
          username: metadata.username,
          sslmode: stored.metadata_pg?.sslmode || "require",
          source: metadata.source,
        },
      };
      return json({
        settings,
        credentials: credentialInfo(),
        mode: CLOUD_MODE,
        metadata,
        database: { configured: true },
      });
    }

    if (path === "/api/settings/mode" && method === "PUT") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      const mode = String(body.mode || "");
      if (!["real", "mock"].includes(mode)) return error("mode 仅支持 real / mock");
      if (mode === "real" && !credentialInfo().has_credentials) return error("切换到真实模式前请先配置 AK/SK");
      await configSet("cloud_mode", { mode });
      CLOUD_MODE = mode;
      return json({ mode: CLOUD_MODE });
    }

    if (path === "/api/preflight" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      return json(await preflightPayload());
    }

    if (path === "/api/settings" && method === "PUT") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      if (body.mode !== undefined) {
        const mode = String(body.mode || "");
        if (!["real", "mock"].includes(mode)) return error("mode 仅支持 real / mock");
        if (mode === "real" && !credentialInfo().has_credentials) return error("切换到真实模式前请先配置 AK/SK");
        await configSet("cloud_mode", { mode });
        CLOUD_MODE = mode;
      }
      const stored = (await configGet("settings")) || {};
      const next = { ...stored };
      for (const key of ["region_id", "vpc_id", "vswitch_id", "zone_id", "shared_pg_id", "metadata_pg", "pool"]) {
        if (body[key] !== undefined) next[key] = body[key];
      }
      await configSet("settings", next);
      if (body.metadata_pg !== undefined) await configSet("metadata_pg", body.metadata_pg);
      const regions = await regionsPayload();
      const regionId = body.region_id || stored.region_id || regions[0]?.region_id;
      if (regionId) {
        if (body.vpc_id !== undefined || body.vswitch_id !== undefined || body.zone_id !== undefined) {
          await sql`update pools set vpc_id = coalesce(${body.vpc_id ?? null}, vpc_id), vswitch_id = coalesce(${body.vswitch_id ?? null}, vswitch_id), zone_id = coalesce(${body.zone_id ?? null}, zone_id), updated_at = now() where region_id = ${regionId}`;
        }
        if (body.pool) {
          const config = poolConfig(body.pool);
          await sql`update pools set config = ${JSON.stringify(config)}::json, updated_at = now() where region_id = ${regionId}`;
        }
      }
      return json({ settings: next, mode: CLOUD_MODE });
    }

    if (path === "/api/billing/pool-cost" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
      const regionId = url.searchParams.get("region_id") || "";
      const single = regionId
        ? await sql`select pg_instance_id, app_name, pool_id from pool_instances where is_deleted = false and region_id = ${regionId} and mode = 'single'`
        : await sql`select pg_instance_id, app_name, pool_id from pool_instances where is_deleted = false and mode = 'single'`;
      const shared = await sharedPgRows(undefined, regionId || undefined);
      const entries = new Map<string, any>();
      for (const row of single) {
        if (row.pg_instance_id) entries.set(row.pg_instance_id, { pg_instance_id: row.pg_instance_id, role: "单租 PG", label: `单租池 / ${row.app_name}`, region_id: regionId, pool_id: row.pool_id, deleted: false });
      }
      for (const row of shared) {
        entries.set(row.pg_instance_id, { pg_instance_id: row.pg_instance_id, role: "共享 PG", label: `共享池 / ${row.name || row.pg_instance_id}`, region_id: row.region_id, pool_id: row.pool_id, deleted: false });
      }
      if (CLOUD_MODE !== "real") {
        return json({ available: true, month, region_id: regionId, currency: "CNY", total_pretax: 0, total_payment: 0, payg_total: 0, subscription_total: 0, pg_count: entries.size, items: [...entries.values()].map((item) => ({ ...item, pretax_amount: 0, payment_amount: 0, payg_amount: 0, subscription_amount: 0, storage_amount: 0, compute_amount: 0, other_amount: 0, billing_type: "none", found: false, currency: "CNY", spec: "", region: "" })), errors: [], fetched_at: new Date().toISOString() });
      }
      try {
        const adapter = new RealAdapter(regionId || (await regionsPayload())[0]?.region_id || "cn-chengdu");
        const billItems: any[] = [];
        let token = "";
        for (let page = 0; page < 5; page += 1) {
          const body: Record<string, any> = { BillingCycle: month, Granularity: "MONTHLY", ProductCode: "rds", IsBillingItem: true, MaxResults: 300 };
          if (token) body.NextToken = token;
          const data = await adapter.rpc("business.aliyuncs.com", "DescribeInstanceBill", "2017-12-14", body);
          billItems.push(...(data.Data?.Items?.Item || data.Data?.Items || []));
          token = data.Data?.NextToken || "";
          if (!token) break;
        }
        const grouped = new Map<string, any>();
        for (const item of billItems) {
          const pgId = String(item.InstanceID || "").split(";")[0];
          if (!entries.has(pgId)) continue;
          const entry = grouped.get(pgId) || { pretax: 0, payment: 0, payg: 0, subscription: 0, storage: 0, compute: 0, other: 0, types: new Set(), spec: "", region: "" };
          const amount = Number(item.PretaxAmount || 0);
          entry.pretax += amount;
          entry.payment += Number(item.PaymentAmount || 0);
          const subscription = item.SubscriptionType === "Subscription" || String(item.Item || "").includes("SubscriptionOrder");
          const payg = item.SubscriptionType === "PayAsYouGo" || String(item.Item || "").includes("PayAsYouGo");
          if (subscription) entry.subscription += amount;
          if (payg) entry.payg += amount;
          if (subscription || payg) entry.types.add(subscription ? "subscription" : "payg");
          const billingItem = String(item.BillingItem || item.BillingItemCode || "").toLowerCase();
          if (billingItem.includes("存储") || billingItem.includes("storage")) entry.storage += amount;
          else if (billingItem.includes("规格") || billingItem.includes("compute")) entry.compute += amount;
          else entry.other += amount;
          entry.spec = entry.spec || item.InstanceSpec || "";
          entry.region = entry.region || item.Region || "";
          grouped.set(pgId, entry);
        }
        const items = [...entries.values()].map((base) => {
          const b = grouped.get(base.pg_instance_id);
          return {
            ...base, spec: b?.spec || "", region: b?.region || "", currency: "CNY",
            pretax_amount: b?.pretax || 0, payment_amount: b?.payment || 0, payg_amount: b?.payg || 0,
            subscription_amount: b?.subscription || 0, storage_amount: b?.storage || 0,
            compute_amount: b?.compute || 0, other_amount: b?.other || 0,
            billing_type: b ? (b.types.has("payg") && b.types.has("subscription") ? "mixed" : b.types.has("subscription") ? "subscription" : b.types.has("payg") ? "payg" : "unknown") : "none",
            found: !!b,
          };
        });
        return json({
          available: true, month, region_id: regionId, currency: "CNY",
          total_pretax: items.reduce((sum, item) => sum + item.pretax_amount, 0),
          total_payment: items.reduce((sum, item) => sum + item.payment_amount, 0),
          payg_total: items.reduce((sum, item) => sum + item.payg_amount, 0),
          subscription_total: items.reduce((sum, item) => sum + item.subscription_amount, 0),
          pg_count: items.length, items, errors: [], fetched_at: new Date().toISOString(),
        });
      } catch (err) {
        return json({ available: false, reason: "UNAVAILABLE", message: "PG 账单数据暂不可用", month, region_id: regionId, errors: [String(err)] });
      }
    }

    if (path === "/api/overview/global" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const regions = await regionsPayload();
      const summaries: any[] = [];
      const totals = {
        region_count: regions.length,
        instance_total: 0,
        cold: 0,
        in_use: 0,
        failed: 0,
        shared_pg_count: 0,
        estimated_max_active_tenants: 0,
        estimated_max_total_tenants: 0,
        current_active_tenants: 0,
        current_total_tenants: 0,
      };
      for (const item of regions) {
        const view = await overviewPayload(item.region_id);
        const capacity = view.capacity_cached || {};
        summaries.push({
          region_id: item.region_id,
          name: item.name,
          enabled: item.enabled,
          pools: view.pools,
          shared_pgs: view.shared_pgs,
          capacity,
          instance_total: view.instance_total,
          alerts: view.alerts,
        });
        totals.instance_total += Number(view.instance_total || 0);
        for (const mode of ["single", "shared"]) {
          const pool: any = (view.pools || {})[mode] || {};
          totals.cold += Number(pool.cold || 0);
          totals.in_use += Number(pool.in_use || 0);
          totals.failed += Number(pool.failed || 0);
        }
        totals.shared_pg_count += (view.shared_pgs || []).length;
        totals.estimated_max_active_tenants += Number(capacity.estimated_max_active_tenants || 0);
        totals.estimated_max_total_tenants += Number(capacity.estimated_max_total_tenants || 0);
        totals.current_active_tenants += Number(capacity.current_active_tenants || 0);
        totals.current_total_tenants += Number(capacity.current_total_tenants || 0);
      }
      return json({ regions: summaries, totals, fetched_at: new Date().toISOString() });
    }


    if (path === "/api/overview" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      return json(await overviewPayload(url.searchParams.get("region_id") || ""));
    }

    if (/^\/api\/instances\/[^/]+$/.test(path) && method === "DELETE") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").pop();
      const rows = await sql`select * from pool_instances where id = ${id} and is_deleted = false limit 1`;
      const inst: any = rows[0];
      if (!inst) return error("实例不存在", 404);
      await setInstance(id, { status: "Releasing" });
      const taskId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${taskId}, 'release', ${inst.mode}, ${inst.pool_id}, ${inst.id}, ${`删除 ${inst.app_name}`}, 'pending', 0, '等待 worker',
                ${JSON.stringify({ instance_id: inst.id, cloud_mode: parseObject(inst.detail).cloud_mode || CLOUD_MODE, destroy: true })}::json, '{}'::json, 'delete_supabase', 0, now())
      `;
      await writeAuditEvent(inst.id, "delete", "管理员删除实例", { destroy: true });
      return json({ task_id: taskId, destroy: true });
    }

    if (path === "/api/instances" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const conditions: string[] = ["1 = 1"];
      const params: any[] = [];
      if (url.searchParams.get("include_deleted") !== "true") conditions.push("is_deleted = false");
      for (const key of ["mode", "status", "pool_id", "region_id"]) {
        const value = url.searchParams.get(key);
        if (value) {
          params.push(value);
          conditions.push(`${key} = $${params.length}`);
        }
      }
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 300)));
      params.push(limit);
      const rows = await sql.unsafe(
        `select * from pool_instances where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
        params,
      );
      return json({ instances: rows });
    }

    if (path === "/api/tasks" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const conditions: string[] = ["1 = 1"];
      const params: any[] = [];
      for (const key of ["status", "kind", "pool_id"]) {
        const value = url.searchParams.get(key);
        if (value) {
          params.push(value);
          conditions.push(`${key} = $${params.length}`);
        }
      }
      const regionId = url.searchParams.get("region_id");
      if (regionId && !url.searchParams.get("pool_id")) {
        params.push(regionId);
        conditions.push(`pool_id in (select id from pools where region_id = $${params.length})`);
      }
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
      params.push(limit);
      const rows = await sql.unsafe(
        `select * from tasks where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
        params,
      );
      return json({ tasks: rows.map(taskPayload) });
    }

    if (path === "/api/logs" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
      const regionId = url.searchParams.get("region_id");
      const rows = regionId
        ? await sql`select * from api_call_logs where region = ${regionId} order by created_at desc limit ${limit}`
        : await sql`select * from api_call_logs order by created_at desc limit ${limit}`;
      return json({
        logs: rows.map((row: any) => ({
          id: row.id,
          action: row.action,
          product: row.product,
          region: row.region,
          request_id: row.request_id,
          success: !!row.success,
          error_code: row.error_code,
          error_message: row.error_message,
          duration_ms: row.duration_ms,
          params: parseObject(row.params),
          created_at: row.created_at,
        })),
      });
    }

    if (path === "/api/admin/users" && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const rows = await sql`select id, username, display_name, role, enabled, created_at, last_login_at from platform_users order by created_at`;
      return json({ users: rows.map(publicUser) });
    }

    if (path === "/api/admin/users" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const body = await req.json();
      const username = String(body.username || "").trim().toLowerCase();
      if (username.length < 3 || username.length > 40) return error("用户名长度需为 3~40 个字符");
      if (String(body.password || "").length < 8) return error("密码至少 8 位");
      const role = ["admin", "user"].includes(body.role) ? body.role : "user";
      const rows = await sql`
        insert into platform_users (id, username, display_name, password_hash, role, enabled, token_version, created_at, updated_at)
        values (${randomId()}, ${username}, ${body.display_name || username}, ${await hashPassword(String(body.password))}, ${role}, true, 0, now(), now())
        returning id, username, display_name, role, enabled, created_at, last_login_at
      `;
      return json(publicUser(rows[0]));
    }

    if (/^\/api\/admin\/users\/[^/]+$/.test(path) && method === "PATCH") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").pop();
      const body = await req.json();
      const rows = await sql`select * from platform_users where id = ${id} limit 1`;
      const target: any = rows[0];
      if (!target) return error("用户不存在", 404);
      const nextRole = body.role ?? target.role;
      const nextEnabled = body.enabled ?? target.enabled;
      if (target.role === "admin" && (nextRole !== "admin" || !nextEnabled)) {
        const admins = await sql`select count(*)::int as total from platform_users where role = 'admin' and enabled = true and id != ${id}`;
        if (Number(admins[0].total) === 0) return error("不能停用或降级最后一个管理员");
      }
      const updated = await sql`
        update platform_users set
          display_name = ${body.display_name ?? target.display_name},
          role = ${nextRole},
          enabled = ${nextEnabled},
          password_hash = ${body.password ? await hashPassword(String(body.password)) : target.password_hash},
          token_version = ${body.password || body.role !== undefined || body.enabled !== undefined ? Number(target.token_version || 0) + 1 : Number(target.token_version || 0)},
          updated_at = now()
        where id = ${id}
        returning id, username, display_name, role, enabled, created_at, last_login_at
      `;
      return json(publicUser(updated[0]));
    }

    if (/^\/api\/instances\/[^/]+$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").pop();
      const rows = await sql`select * from pool_instances where id = ${id} limit 1`;
      return rows[0] ? json({ ...rows[0], detail: parseObject(rows[0].detail) }) : error("实例不存在", 404);
    }

    if (/^\/api\/instances\/[^/]+\/events$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const rows = await sql`select * from audit_events where instance_id = ${id} order by created_at desc limit 100`;
      return json({ events: rows });
    }

    if (/^\/api\/instances\/[^/]+\/actions$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const body = await req.json();
      const action = String(body.action || "");
      if (!["start", "stop", "restart", "sync"].includes(action)) return error("不支持的操作");
      const rows = await sql`select * from pool_instances where id = ${id} and is_deleted = false limit 1`;
      const inst: any = rows[0];
      if (!inst) return error("实例不存在", 404);
      const taskId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${taskId}, ${action}, ${inst.mode}, ${inst.pool_id}, ${inst.id}, ${`${action} ${inst.app_name}`}, 'pending', 0, '等待 worker',
                ${JSON.stringify({ instance_id: inst.id, cloud_mode: parseObject(inst.detail).cloud_mode || CLOUD_MODE, action, force: !!body.force })}::json, '{}'::json, 'run', 0, now())
      `;
      await writeAuditEvent(inst.id, action, `手动${action}`, { previous_status: inst.status, force: !!body.force });
      return json({ task_id: taskId, action });
    }

    if (/^\/api\/instances\/[^/]+\/endpoints$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const { inst, adapter } = await instanceCloud(id);
      if (!inst?.supabase_instance_id) return error("实例尚未创建 Supabase 资源");
      return json(await adapter!.supabaseEndpoints(inst.supabase_instance_id));
    }

    if (/^\/api\/instances\/[^/]+\/auth-info$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const { inst, adapter } = await instanceCloud(id);
      if (!inst?.supabase_instance_id) return error("实例尚未创建 Supabase 资源");
      return json(maskAuthInfo(await adapter!.supabaseAuthInfo(inst.supabase_instance_id)));
    }

    if (/^\/api\/instances\/[^/]+\/resource$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const { inst, adapter } = await instanceCloud(id);
      if (!inst) return error("实例不存在", 404);
      if (!inst.supabase_instance_id) return error("实例尚未创建 Supabase 资源");
      return json(await adapter!.supabaseResource(inst.supabase_instance_id));
    }

    if (/^\/api\/instances\/[^/]+\/resource$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const body = await req.json();
      const { inst, adapter } = await instanceCloud(id);
      if (!inst) return error("实例不存在", 404);
      if (!inst.supabase_instance_id) return error("实例尚未创建 Supabase 资源");
      const keys = ["cpu_cores", "memory_size_gb", "authenticator_conn_limit", "auth_admin_conn_limit", "realtime_conn_limit", "admin_conn_limit"];
      const fields: Record<string, any> = {};
      for (const key of keys) if (body[key] !== undefined && body[key] !== null) fields[key] = Number(body[key]);
      if (!Object.keys(fields).length) return error("至少需要传入 CPU 或任一连接数参数");
      if (body.memory_size_gb != null && body.cpu_cores == null) return error("MemorySizeGB 必须和 CpuCores 一起传");
      if (fields.cpu_cores !== undefined) {
        if (![2, 4, 8].includes(fields.cpu_cores)) return error("CpuCores 仅支持 2 / 4 / 8");
        if (fields.memory_size_gb !== undefined && !(fields.cpu_cores <= fields.memory_size_gb && fields.memory_size_gb <= fields.cpu_cores * 4)) {
          return error("MemorySizeGB 必须满足 CPU <= Memory <= CPU × 4");
        }
      }
      for (const key of ["authenticator_conn_limit", "auth_admin_conn_limit", "realtime_conn_limit", "admin_conn_limit"]) {
        if (fields[key] === undefined) continue;
        const low = key === "admin_conn_limit" ? 5 : 2;
        if (!(low <= fields[key] && fields[key] <= 16)) return error(`${key} 取值范围为 ${low}~16`);
      }
      try {
        return json(await adapter!.modifySupabaseResource(inst.supabase_instance_id, fields));
      } catch (err) {
        return error(String(err), 502);
      }
    }

    if (/^\/api\/instances\/[^/]+\/database-size$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const { inst, adapter } = await instanceCloud(id);
      if (!inst) return error("实例不存在", 404);
      if (!inst.supabase_instance_id) return error("实例尚未创建 Supabase 资源");
      return json(await adapter!.supabaseDatabaseSize(inst.supabase_instance_id));
    }

    if (/^\/api\/instances\/[^/]+\/allocate$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const body = await req.json();
      const appName = String(body.app_name || "").trim();
      if (!appName) return error("请填写应用名称");
      const { inst, detail } = await instanceCloud(id);
      if (!inst) return error("实例不存在或已删除", 404);
      if (!["Available", "InCold"].includes(inst.status)) return error(`实例当前状态为 ${inst.status}，不可分配`);
      const reservedApp = String(detail.reserved_app_name || "");
      if (reservedApp && reservedApp !== appName) return error(`该实例保留给应用 ${reservedApp}，不能分配给其他应用`);
      const nextDetail = { ...detail, bound_app_name: appName };
      delete nextDetail.reserved;
      delete nextDetail.reserved_app_name;
      delete nextDetail.reserved_user_id;
      const boundAppId = inst.bound_app_id || `app-${randomToken(6)}`;
      await setInstance(inst.id, {
        status: "InUse",
        bound_app_id: boundAppId,
        bound_user: String(body.user || "").trim() || inst.bound_user || "demo-user",
        detail: JSON.stringify(nextDetail),
        error: null,
      });
      const taskId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${taskId}, 'allocate', ${inst.mode}, ${inst.pool_id}, ${inst.id}, ${`分配 ${inst.app_name} → ${appName}`}, 'pending', 0, '等待 worker',
                ${JSON.stringify({ instance_id: inst.id, cloud_mode: detail.cloud_mode || CLOUD_MODE, app_name: appName, need_start: inst.status === "InCold" })}::json, '{}'::json, 'start', 0, now())
      `;
      await writeAuditEvent(inst.id, "allocate", `分配给应用 ${appName}`, { app_name: appName, user: String(body.user || "").trim() });
      return json({ task_id: taskId, instance_id: inst.id, bound_app_id: boundAppId, app_name: appName });
    }

    if (/^\/api\/instances\/[^/]+\/release$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const body = await req.json();
      const { inst, detail } = await instanceCloud(id);
      if (!inst) return error("实例不存在或已删除", 404);
      let destroy = body.destroy;
      if (destroy === undefined || destroy === null) {
        let policy = "return";
        if (inst.pool_id) {
          const rows = await sql`select config from pools where id = ${inst.pool_id} limit 1`;
          policy = String(poolConfig(rows[0]?.config).release_policy || "return");
        }
        destroy = policy === "destroy";
      }
      destroy = !!destroy;
      if (!["InUse", "Available", "InCold", "Failed"].includes(inst.status)) return error(`实例当前状态为 ${inst.status}，不可释放`);
      if (!destroy && inst.status !== "InUse") return error("只有使用中的实例可以保留给原应用复用；请选择直接删除");
      await setInstance(inst.id, { status: "Releasing", error: null });
      const taskId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${taskId}, 'release', ${inst.mode}, ${inst.pool_id}, ${inst.id}, ${`${destroy ? "删除" : "保留"} ${inst.app_name}`}, 'pending', 0, '等待 worker',
                ${JSON.stringify({ instance_id: inst.id, cloud_mode: detail.cloud_mode || CLOUD_MODE, destroy })}::json, '{}'::json, ${destroy ? "delete_supabase" : "stop"}, 0, now())
      `;
      await writeAuditEvent(inst.id, "release", destroy ? "删除实例资源" : "保留给原应用复用", { destroy });
      return json({ task_id: taskId, destroy });
    }

    if (/^\/api\/(v1\/)?portal\/instances\/[^/]+\/endpoints$/.test(path) && method === "GET") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "credentials:read")) return error("API Token 缺少 credentials:read 权限", 403);
      const id = path.split("/").slice(-2)[0];
      const rows = await sql`select * from pool_instances where id = ${id} and owner_user_id = ${ctx!.user.id} and is_deleted = false limit 1`;
      const inst: any = rows[0];
      if (!inst?.supabase_instance_id) return error("实例不存在或尚未创建 Supabase 资源", 404);
      const detail = parseObject(inst.detail);
      const adapter = cloudAdapter(detail.cloud_mode || CLOUD_MODE, inst.region_id);
      return json(await adapter.supabaseEndpoints(inst.supabase_instance_id));
    }

    if (/^\/api\/(v1\/)?portal\/instances\/[^/]+\/auth-info$/.test(path) && method === "GET") {
      const ctx = await authenticate(req);
      if (!hasScope(ctx, "credentials:read")) return error("API Token 缺少 credentials:read 权限", 403);
      const id = path.split("/").slice(-2)[0];
      const rows = await sql`select * from pool_instances where id = ${id} and owner_user_id = ${ctx!.user.id} and is_deleted = false limit 1`;
      const inst: any = rows[0];
      if (!inst?.supabase_instance_id) return error("实例不存在或尚未创建 Supabase 资源", 404);
      const detail = parseObject(inst.detail);
      const adapter = cloudAdapter(detail.cloud_mode || CLOUD_MODE, inst.region_id);
      return json(await adapter.supabaseAuthInfo(inst.supabase_instance_id));
    }

    if (/^\/api\/tasks\/[^/]+$/.test(path) && method === "GET") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").pop();
      const rows = await sql`select * from tasks where id = ${id} limit 1`;
      return rows[0] ? json(taskPayload(rows[0])) : error("任务不存在", 404);
    }

    if (/^\/api\/tasks\/[^/]+\/retry$/.test(path) && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const id = path.split("/").slice(-2)[0];
      const rows = await sql`select * from tasks where id = ${id} limit 1`;
      const task: any = rows[0];
      if (!task || task.status !== "failed") return error("只有失败任务可以重试");
      if (task.target_id && task.kind !== "selfheal") {
        const nextStatus = task.kind === "prewarm" ? "Creating" : task.kind === "release" ? "Releasing" : task.kind === "allocate" ? "InUse" : "";
        if (nextStatus) await setInstance(task.target_id, { status: nextStatus, error: null });
        else await setInstance(task.target_id, { error: null });
      }
      const nextId = randomId();
      await sql`
        insert into tasks (id, kind, mode, pool_id, target_id, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${nextId}, ${task.kind}, ${task.mode}, ${task.pool_id}, ${task.target_id}, ${`重试：${task.title}`}, 'pending', 0, '等待 worker',
                ${task.payload || "{}"}, '{}'::json, ${task.step || "prepare"}, 0, now())
      `;
      return json({ task_id: nextId });
    }

    if (path === "/api/tasks/selfheal" && method === "POST") {
      if (!(await requireAdmin(req))) return error("需要管理员权限", 403);
      const existing = await sql`select id from tasks where kind = 'selfheal' and status in ('pending', 'running') limit 1`;
      if (existing[0]) return json({ task_id: existing[0].id, skipped: true });
      const id = randomId();
      await sql`
        insert into tasks (id, kind, mode, title, status, progress, message, payload, result, step, attempts, created_at)
        values (${id}, 'selfheal', 'single', '自愈巡检', 'pending', 0, '等待 worker', ${JSON.stringify({ cloud_mode: CLOUD_MODE })}::json, '{}'::json, 'prepare', 0, now())
      `;
      return json({ task_id: id, skipped: false });
    }

    return error("Not found", 404);
  } catch (err) {
    console.error(err);
    return error(String(err), 500);
  }
}

Deno.serve({ port: Number(Deno.env.get("PORT") || 8000) }, handler);

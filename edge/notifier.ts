// @ts-nocheck
import postgres from "npm:postgres@3.4.5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-worker-token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function adminDbUrl() {
  const raw = Deno.env.get("CONTROL_DB_URL") || Deno.env.get("SUPABASE_DB_URL") || "";
  if (!raw) throw new Error("CONTROL_DB_URL 未配置");
  const url = new URL(raw);
  url.pathname = `/${Deno.env.get("CONTROL_ADMIN_DB_NAME") || "supabase_db"}`;
  return url.toString();
}

function pgOptions(urlText: string) {
  const url = new URL(urlText);
  const sslmode = url.searchParams.get("sslmode") || "require";
  return {
    max: 1,
    prepare: false,
    connect_timeout: 8,
    ssl: sslmode === "disable" || sslmode === "" ? false : sslmode,
  };
}

function componentInfo(component: string) {
  if (component === "pool-api") {
    return {
      label: "控制台 API 服务",
      impact: "管理台、使用者门户和 API 可能无法正常访问。",
      action: "如持续异常，有部署权限时可重新部署服务；若部署后仍未恢复，请联系平台管理员。",
    };
  }
  if (component === "pool-worker") {
    return {
      label: "后台任务服务",
      impact: "自动补货、预热、分配/归还等后台任务可能暂停推进。",
      action: "如持续异常，有部署权限时可重新部署服务以重挂调度；若仍未恢复，请联系平台管理员。",
    };
  }
  return {
    label: component,
    impact: "相关服务可能不可用。",
    action: "请联系平台管理员检查服务状态。",
  };
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

function formatAlert(row: any) {
  const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
  const info = componentInfo(row.component);
  const isRecovered = row.status === "recovered";
  const lines = [
    `[RDS Supabase Pool] ${isRecovered ? "恢复" : "告警"}：${info.label}`,
    isRecovered ? "当前状态：服务已恢复，后台任务可继续处理。" : `业务影响：${info.impact}`,
    isRecovered ? "" : `处理建议：${info.action}`,
    `时间：${formatTime(row.created_at)}`,
    `技术标识：${row.component}${detail.last_seen_at ? ` / 最近心跳 ${formatTime(detail.last_seen_at)}` : ""}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function webhookUrl(base: string, secret: string) {
  if (!secret) return base;
  const timestamp = String(Date.now());
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}\n${secret}`),
  );
  const sign = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const url = new URL(base);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  return url.toString();
}

Deno.serve({ port: Number(Deno.env.get("PORT") || 8000) }, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("WORKER_TOKEN") || "";
  if (!expected) return json({ error: "WORKER_TOKEN 未配置" }, 503);
  if (req.headers.get("x-worker-token") !== expected) return json({ error: "worker token 无效" }, 401);

  const webhook = Deno.env.get("DINGTALK_WEBHOOK") || "";
  const secret = Deno.env.get("DINGTALK_SECRET") || "";
  if (!webhook) {
    return json({ ok: true, skipped: true, reason: "DINGTALK_WEBHOOK 未配置" });
  }
  const target = await webhookUrl(webhook, secret);

  let db: any;
  try {
    db = postgres(adminDbUrl(), pgOptions(adminDbUrl()));
    const rows = await db`
      select id, component, status, message, detail, attempts, created_at
      from public.alert_outbox
      where sent_at is null
      order by id
      limit 20
    `;
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const response = await fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msgtype: "text", text: { content: formatAlert(row) } }),
          signal: AbortSignal.timeout(10000),
        });
        const result: any = await response.json().catch(() => ({}));
        if (!response.ok || (typeof result.errcode === "number" && result.errcode !== 0)) {
          throw new Error(`DingTalk HTTP ${response.status} errcode=${result.errcode ?? "?"} ${result.errmsg || ""}`.trim());
        }
        await db`update public.alert_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = ${row.id}`;
        sent += 1;
      } catch (err) {
        failed += 1;
        await db`update public.alert_outbox set attempts = attempts + 1, last_error = ${String(err)} where id = ${row.id}`;
      }
    }
    return json({ ok: failed === 0, sent, failed, pending: rows.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  } finally {
    if (db) {
      try {
        await db.end({ timeout: 3 });
      } catch {
        // ignore shutdown errors
      }
    }
  }
});

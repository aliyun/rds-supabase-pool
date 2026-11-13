import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LockKeyhole, RefreshCw, Server, Wallet } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useAppData } from "../lib/store";
import type { PoolCostItem, PoolCostOverview } from "../lib/types";
import { Badge, Button, Card, Select, Spinner } from "../components/ui";

function monthOptions(): string[] {
  const now = new Date();
  return Array.from({ length: 4 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function money(value?: number, currency = "CNY"): string {
  const amount = Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "CNY" ? `¥ ${amount}` : `${amount} ${currency}`;
}

export function BillingPage() {
  const { region, regionId } = useAppData();
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState<PoolCostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.poolCost(month, regionId || undefined);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [month, regionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const currency = data?.currency || "CNY";
  const billed = items.filter((item) => item.found).length;
  const pending = items.length - billed;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label-eyebrow">COST / PG SPEND</div>
          <h1 className="display-title mt-1 text-2xl font-semibold text-white">
            冷热池成本
            <span className="ml-2 align-middle text-sm font-normal text-cyan-300">
              {region?.name || regionId || "未选择地域"}
            </span>
          </h1>
          <p className="mt-1 text-xs text-slate-400">只看当前地域冷热池消耗的 PG 费用，按月汇总。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={month} onChange={(event) => setMonth(event.target.value)} className="h-9 w-32 text-xs">
            {months.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
            onClick={() => void load()}
          >
            刷新
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/[0.07] px-3 py-2.5 text-[11px] text-rose">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex justify-center py-24">
          <Spinner size={24} />
        </div>
      ) : data && !data.available ? (
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber/30 bg-amber/[0.08] text-amber">
              <LockKeyhole size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="display-title text-sm text-white">
                {data.reason === "NO_PERMISSION" ? "暂无 PG 费用数据" : "PG 费用暂不可用"}
              </div>
              <p className="mt-2 text-[11px] leading-6 text-slate-400">{data.message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge className="border-amber/25 bg-amber/[0.07] text-amber">AliyunBSSReadOnlyAccess</Badge>
                <Badge className="border-edge bg-white/[0.03] text-slate-400">
                  账号 <span className="mono">{data.account_id || "—"}</span>
                </Badge>
              </div>
              {data.errors?.[0] ? <div className="mt-2 text-[10px] text-slate-500">{data.errors[0]}</div> : null}
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="primary" icon={<RefreshCw size={13} />} onClick={() => void load()}>
                  重新检查
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : data ? (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2" glow="cyan">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="label-eyebrow">{month} PG SPEND</div>
                  <div className="display-title mt-2 text-4xl font-semibold text-white">
                    {money(data.total_pretax, currency)}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    共 <span className="mono text-slate-200">{data.pg_count ?? 0}</span> 个 PG · 已出账{" "}
                    <span className="mono text-acid">{billed}</span> 个 · 待出账{" "}
                    <span className="mono text-slate-300">{pending}</span> 个
                  </div>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan/25 bg-cyan/[0.07] text-cyan-300">
                  <Wallet size={20} />
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[10px] text-slate-500">按量费用</div>
                  <div className="mono mt-1 text-sm text-cyan-300">{money(data.payg_total, currency)}</div>
                </div>
                <div className="rounded-lg border border-edge bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[10px] text-slate-500">包月费用</div>
                  <div className="mono mt-1 text-sm text-violet">{money(data.subscription_total, currency)}</div>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Server size={15} className="text-acid" />
                <span className="display-title text-sm text-slate-200">统计口径</span>
              </div>
              <ul className="mt-3 space-y-2 text-[11px] leading-6 text-slate-400">
                <li>· 单租 PG 与共享 PG 按地域计入，控制面元数据 PG 不参与地域成本</li>
                <li>· 按量与包月分开汇总：包月为账单期订阅应付，不是按天摊销</li>
                <li>· 费用构成拆分计算/存储；停止的 PG 只收存储费</li>
                <li>· Supabase 模块费用不单独统计</li>
                <li>· 账单通常 T+1，当前月可能不完整</li>
                <li>· 已删除但本月产生过费用的 PG 仍会计入</li>
              </ul>
              <div className="mt-3 text-[10px] text-slate-500">
                {data.fetched_at ? `更新于 ${relativeTime(data.fetched_at)}` : ""}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Server size={15} className="text-cyan-400" />
                <span className="display-title text-sm text-slate-200">PG 费用明细</span>
              </div>
              <span className="text-[10px] text-slate-500">
                账号 <span className="mono">{data.account_id || "—"}</span>
              </span>
            </div>
            {items.length ? (
              <div className="mt-3 overflow-x-auto rounded-lg border border-edge">
                <table className="w-full min-w-[940px] text-left text-[11px]">
                  <thead className="bg-white/[0.03] text-[10px] text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 font-normal">角色</th>
                      <th className="px-3 py-2.5 font-normal">计费方式</th>
                      <th className="px-3 py-2.5 font-normal">PG 实例</th>
                      <th className="px-3 py-2.5 font-normal">规格 / 地域</th>
                      <th className="px-3 py-2.5 text-right font-normal">应付</th>
                      <th className="px-3 py-2.5 text-right font-normal">账单</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <CostRow key={item.pg_instance_id} item={item} currency={currency} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-[11px] text-slate-500">
                <Server size={18} className="text-slate-600" />
                池内暂无 PG 资源
              </div>
            )}
            <div className="mt-3 text-[10px] text-slate-500">{data.notes}</div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function CostRow({ item, currency }: { item: PoolCostItem; currency: string }) {
  return (
    <tr className="border-t border-edge/60">
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-300">{item.role}</span>
          {item.deleted ? (
            <Badge className="border-slate-500/25 bg-slate-500/[0.08] text-slate-400">已删除</Badge>
          ) : null}
        </div>
        <div className="mt-0.5 text-[10px] text-slate-500">{item.label}</div>
      </td>
      <td className="px-3 py-2.5">
        <BillingTypeBadge type={item.billing_type} />
      </td>
      <td className="mono px-3 py-2.5 text-[10px] text-slate-300">{item.pg_instance_id}</td>
      <td className="px-3 py-2.5 text-slate-500">
        {item.spec || "—"}
        {item.region ? ` · ${item.region}` : ""}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="mono text-slate-200">{money(item.pretax_amount, item.currency || currency)}</div>
        {item.found ? <CostComponents item={item} currency={currency} /> : null}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className={item.found ? "text-acid" : "text-slate-500"}>{item.found ? "已出账" : "暂无数据"}</span>
      </td>
    </tr>
  );
}

function CostComponents({ item, currency }: { item: PoolCostItem; currency: string }) {
  const parts: string[] = [];
  if (item.compute_amount) parts.push(`计算 ${money(item.compute_amount, item.currency || currency)}`);
  if (item.storage_amount) parts.push(`存储 ${money(item.storage_amount, item.currency || currency)}`);
  if (item.other_amount) parts.push(`其他 ${money(item.other_amount, item.currency || currency)}`);
  if (!parts.length) return null;
  return <div className="mt-0.5 text-[9px] text-slate-500">{parts.join(" · ")}</div>;
}

function BillingTypeBadge({ type }: { type: PoolCostItem["billing_type"] }) {
  if (type === "subscription") {
    return <Badge className="border-violet/25 bg-violet/[0.08] text-violet">包月</Badge>;
  }
  if (type === "payg") {
    return <Badge className="border-cyan/25 bg-cyan/[0.08] text-cyan-300">按量</Badge>;
  }
  if (type === "mixed") {
    return <Badge className="border-amber/25 bg-amber/[0.08] text-amber">混合</Badge>;
  }
  if (type === "unknown") {
    return <Badge className="border-edge bg-white/[0.03] text-slate-400">未知</Badge>;
  }
  return <span className="text-slate-500">—</span>;
}

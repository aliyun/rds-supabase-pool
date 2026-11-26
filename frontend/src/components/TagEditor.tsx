import { Plus, Trash2 } from "lucide-react";
import type { PgTag } from "../lib/types";
import { Button, Input } from "./ui";

export function TagEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: PgTag[];
  onChange: (tags: PgTag[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<PgTag>) => {
    onChange(value.map((tag, current) => (current === index ? { ...tag, ...patch } : tag)));
  };

  return (
    <div className="space-y-2">
      {value.length ? (
        value.map((tag, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={tag.key}
              disabled={disabled}
              placeholder="标签键，例如 env"
              onChange={(event) => update(index, { key: event.target.value })}
            />
            <Input
              value={tag.value}
              disabled={disabled}
              placeholder="标签值，可为空"
              onChange={(event) => update(index, { value: event.target.value })}
            />
            <button
              type="button"
              title="删除标签"
              disabled={disabled}
              onClick={() => onChange(value.filter((_, current) => current !== index))}
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-rose/[0.08] hover:text-rose disabled:opacity-40"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      ) : (
        <div className="rounded-lg border border-dashed border-edge bg-white/[0.01] px-3 py-2 text-[10px] text-slate-500">
          暂无标签
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        icon={<Plus size={12} />}
        disabled={disabled || value.length >= 20}
        onClick={() => onChange([...value, { key: "", value: "" }])}
      >
        添加标签
      </Button>
      <div className="text-[10px] text-slate-600">最多 20 个；标签键不能为空且必须唯一，标签值可以为空。</div>
    </div>
  );
}

import { DETEKSI_META, PRIORITY_META, REVIEW_META, stageMeta } from "@/lib/meta";

export function DeteksiBadge({ value, className = "" }) {
  const m = DETEKSI_META[value];
  if (!m) return null;
  return (
    <span
      data-testid={`deteksi-badge-${value}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.badge} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export function PriorityBadge({ value, score, className = "" }) {
  const m = PRIORITY_META[value];
  if (!m) return null;
  return (
    <span
      data-testid={`priority-badge-${value}`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${m.badge} ${className}`}
    >
      {value}
      {score !== undefined && <span className="ml-1 font-mono font-medium opacity-80">{score}</span>}
    </span>
  );
}

export function ReviewBadge({ value }) {
  const m = REVIEW_META[value || "BELUM_REVIEW"];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.badge}`}>
      {m.label}
    </span>
  );
}

export function StageBadge({ value }) {
  if (!value) return <span className="text-xs text-slate-400">-</span>;
  const m = stageMeta(value);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
      style={{ background: m.color }}
    >
      {m.label}
    </span>
  );
}

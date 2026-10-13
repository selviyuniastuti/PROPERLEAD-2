export default function PageHeader({ title, subtitle, children, testid }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6" data-testid={testid}>
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = "emerald", onClick, testid }) {
  const tones = {
    emerald: "bg-[#ECFDF5] text-[#065F46]",
    amber: "bg-[#FFFBEB] text-[#B45309]",
    orange: "bg-[#FFF7ED] text-[#C2410C]",
    blue: "bg-[#EFF6FF] text-[#1D4ED8]",
    slate: "bg-slate-100 text-slate-700",
    red: "bg-[#FEF2F2] text-[#B91C1C]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`text-left rounded-2xl border border-slate-200 bg-white p-5 transition-all ${
        onClick ? "hover:shadow-md hover:-translate-y-0.5 cursor-pointer" : "cursor-default"
      }`}
    >
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
        {Icon && <Icon className="h-5 w-5" />}
      </div>
      <p className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">{value}</p>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </button>
  );
}

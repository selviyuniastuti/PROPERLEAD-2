import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlarmClock } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { PriorityBadge } from "@/components/Badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CRM_STAGES, fmtDate, titleCase } from "@/lib/meta";

export default function CRMBoard() {
  const [board, setBoard] = useState(null);
  const [fu, setFu] = useState([]);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [b, f] = await Promise.all([api.get("/crm/board"), api.get("/followups")]);
      setBoard(b.data);
      setFu(f.data);
    } catch (e) {
      toast.error(apiErr(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const move = async (id, stage) => {
    try {
      await api.put(`/perumahan/${encodeURIComponent(id)}/crm`, { crm_status: stage });
      toast.success("Tahap CRM diperbarui");
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  if (!board) return <p className="text-slate-400">Memuat…</p>;
  const due = fu.filter((x) => x.status !== "mendatang");

  return (
    <div className="fade-up" data-testid="crm-page">
      <PageHeader title="CRM & Follow-up" subtitle="Kontak, komunikasi, meeting, proposal, hingga kerja sama dengan developer" />

      {due.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 mb-6" data-testid="followup-due">
          <p className="font-bold text-red-800 flex items-center gap-2 mb-2"><AlarmClock className="h-4 w-4" /> Follow-up jatuh tempo ({due.length})</p>
          <div className="flex flex-wrap gap-2">
            {due.map((x) => (
              <button key={x.id} onClick={() => navigate(`/perumahan/${encodeURIComponent(x.id)}?tab=crm`)} className="rounded-lg bg-white border border-red-200 px-3 py-1.5 text-xs text-left hover:shadow">
                <span className="font-semibold text-slate-900">{x.nama}</span>
                <span className={`ml-2 ${x.status === "terlambat" ? "text-red-600" : "text-amber-700"}`}>{x.status === "terlambat" ? "Terlambat" : "Hari ini"} · {fmtDate(x.next_followup)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4 brand-scroll">
        {CRM_STAGES.map((s) => {
          const items = board.columns[s.key] || [];
          return (
            <div key={s.key} className="w-72 shrink-0 rounded-2xl bg-slate-100/70 p-3" data-testid={`crm-col-${s.key}`}>
              <div className="flex items-center justify-between px-1 mb-3">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /> {s.label}
                </span>
                <span className="text-xs font-bold text-slate-500">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 && <p className="text-xs text-slate-400 px-1">Kosong</p>}
                {items.map((it) => (
                  <div key={it.id} className="rounded-xl bg-white border border-slate-200 p-3 shadow-sm" data-testid={`crm-card-${it.id}`}>
                    <button onClick={() => navigate(`/perumahan/${encodeURIComponent(it.id)}?tab=crm`)} className="text-left w-full">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 leading-snug">{it.nama}</p>
                        <PriorityBadge value={it.prioritas} />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{it.pengembang?.nama}</p>
                      <p className="text-[11px] text-slate-400">{titleCase(it.wilayah?.kabupaten)} · {it.jumlah_unit} unit</p>
                      {it.next_followup && <p className="text-[11px] text-amber-700 mt-1">Follow-up {fmtDate(it.next_followup)}</p>}
                    </button>
                    <Select value={it.crm_status} onValueChange={(v) => move(it.id, v)}>
                      <SelectTrigger className="h-7 mt-2 text-xs" data-testid={`crm-move-${it.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{CRM_STAGES.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400 mt-2">Lead masuk CRM setelah direview “Layak Dihubungi” atau tahapnya diatur di halaman detail perumahan.</p>
    </div>
  );
}

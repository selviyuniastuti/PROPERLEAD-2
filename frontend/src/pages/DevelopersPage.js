import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate, titleCase } from "@/lib/meta";

export default function DevelopersPage() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [sort, setSort] = useState("unit");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => { setDq(q); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api.get("/developers", { params: { q: dq || undefined, sort, page, limit: 30 } })
      .then(({ data }) => setData(data))
      .catch((e) => toast.error(apiErr(e)));
  }, [dq, sort, page]);

  return (
    <div className="fade-up" data-testid="developers-page">
      <PageHeader title="Profil Developer" subtitle={`${data.total.toLocaleString("id-ID")} pengembang terdaftar di Sikumbang Kalimantan Selatan`} />
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama pengembang…" className="pl-9" data-testid="developer-search" />
        </div>
        <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1); }}>
          <SelectTrigger className="w-[210px]" data-testid="developer-sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unit">Urut: total unit</SelectItem>
            <SelectItem value="proyek">Urut: jumlah proyek</SelectItem>
            <SelectItem value="terbaru">Urut: proyek terbaru</SelectItem>
            <SelectItem value="nama">Urut: nama A-Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.items.map((d) => (
          <button
            key={d.nama}
            onClick={() => navigate(`/developer/detail?nama=${encodeURIComponent(d.nama)}`)}
            className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
            data-testid="developer-card"
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-[#ECFDF5] text-[#065F46] flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 leading-snug">{d.nama}</p>
                <p className="text-xs text-slate-500">{d.asosiasi || "-"} · proyek terbaru {fmtDate(d.terbaru)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <div className="rounded-lg bg-slate-50 py-2"><p className="font-extrabold text-slate-900">{d.jumlah_proyek}</p><p className="text-[10px] text-slate-500">Proyek</p></div>
              <div className="rounded-lg bg-slate-50 py-2"><p className="font-extrabold text-slate-900">{d.total_unit.toLocaleString("id-ID")}</p><p className="text-[10px] text-slate-500">Unit</p></div>
              <div className="rounded-lg bg-slate-50 py-2"><p className="font-extrabold text-slate-900">{d.di_crm}</p><p className="text-[10px] text-slate-500">Di CRM</p></div>
            </div>
            <p className="text-[11px] text-slate-500 mt-3 truncate">{d.kabupaten.map(titleCase).join(", ")}</p>
            {d.baru > 0 && <p className="text-[11px] font-semibold text-[#15803D] mt-1">{d.baru} listing baru terdeteksi</p>}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 mt-4 text-sm">
        <span className="text-slate-500 mr-2">Halaman {page} dari {data.pages}</span>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)} data-testid="developer-next"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

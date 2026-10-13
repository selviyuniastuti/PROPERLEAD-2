import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator, Search } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmtDateTime, rupiahShort, titleCase } from "@/lib/meta";

export default function FinancePage() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/finance").then(({ data }) => setItems(data)).catch((e) => toast.error(apiErr(e)));
  }, []);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => api.get("/perumahan", { params: { q, limit: 8 } }).then(({ data }) => setResults(data.items)), 350);
    return () => clearTimeout(t);
  }, [q]);

  const open = (id) => navigate(`/perumahan/${encodeURIComponent(id)}?tab=finance`);
  const tot = items.reduce((a, f) => ({ p: a.p + f.result.potensi_penjualan, k: a.k + f.result.kebutuhan_pembiayaan }), { p: 0, k: 0 });

  return (
    <div className="fade-up" data-testid="finance-page">
      <PageHeader title="Project Finance" subtitle="Estimasi biaya, pendapatan, cash flow, margin, dan kebutuhan pembiayaan per proyek (simulasi)" />
      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-1">
          <p className="font-bold text-slate-900 mb-2">Buat simulasi baru</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari perumahan…" className="pl-9" data-testid="finance-search" />
          </div>
          <div className="mt-2">
            {results.map((p) => (
              <button key={p.id} onClick={() => open(p.id)} className="w-full text-left py-2 border-b last:border-0 hover:bg-slate-50 px-1" data-testid={`finance-pick-${p.id}`}>
                <p className="text-sm font-semibold text-slate-800">{p.nama}</p>
                <p className="text-[11px] text-slate-500">{p.jumlah_unit} unit · {rupiahShort(p.harga_min)} · {titleCase(p.wilayah?.kabupaten)}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total potensi penjualan (tersimpan)</p>
          <p className="text-3xl font-extrabold text-slate-900 mt-2">{rupiahShort(tot.p)}</p>
          <p className="text-xs text-slate-400">{items.length} simulasi</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Total estimasi kebutuhan pembiayaan</p>
          <p className="text-3xl font-extrabold text-[#B45309] mt-2">{rupiahShort(tot.k)}</p>
          <p className="text-xs text-slate-400">Angka simulasi, bukan dasar persetujuan kredit</p>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b font-bold text-slate-900">Simulasi tersimpan</div>
        {items.length === 0 && (
          <div className="p-10 text-center">
            <Calculator className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">Belum ada simulasi. Cari perumahan lalu buka tab Project Finance.</p>
          </div>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="finance-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">Perumahan</th>
                  <th className="text-right px-3 py-2">Potensi</th>
                  <th className="text-right px-3 py-2">Biaya</th>
                  <th className="text-right px-3 py-2">Selisih</th>
                  <th className="text-right px-3 py-2">Margin</th>
                  <th className="text-right px-3 py-2">Kebutuhan pembiayaan</th>
                  <th className="text-left px-3 py-2">Diperbarui</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.perumahan_id} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-2"><p className="font-semibold">{f.nama}</p><p className="text-[11px] text-slate-500">{f.pengembang} · {titleCase(f.kabupaten)}</p></td>
                    <td className="px-3 py-2 text-right">{rupiahShort(f.result.potensi_penjualan)}</td>
                    <td className="px-3 py-2 text-right">{rupiahShort(f.result.total_biaya)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${f.result.selisih_penjualan_biaya >= 0 ? "text-[#065F46]" : "text-red-600"}`}>{rupiahShort(f.result.selisih_penjualan_biaya)}</td>
                    <td className="px-3 py-2 text-right">{f.result.margin_pct}%</td>
                    <td className="px-3 py-2 text-right font-semibold text-[#B45309]">{rupiahShort(f.result.kebutuhan_pembiayaan)}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{fmtDateTime(f.updated_at)}<br />{f.updated_by}</td>
                    <td className="px-3 py-2"><Button size="sm" variant="outline" onClick={() => open(f.perumahan_id)}>Buka</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Mail } from "lucide-react";
import { toast } from "sonner";
import api, { API, apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { CRM_STAGES, rupiahShort, titleCase } from "@/lib/meta";

export default function LaporanPage() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/reports/summary").then(({ data }) => setD(data)).catch((e) => toast.error(apiErr(e)));
  }, []);

  const sendDigest = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/digest/run");
      toast.success(data.sent_to?.length ? "Ringkasan harian dikirim ke Gmail Anda" : "Ringkasan dibuat, tetapi email gagal dikirim");
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
    }
  };

  if (!d) return <p className="text-slate-400">Memuat laporan…</p>;
  const monthly = d.bulanan_sumber.map((m) => ({ ...m, label: m.bulan }));

  return (
    <div className="fade-up" data-testid="laporan-page">
      <PageHeader title="Laporan" subtitle="Ringkasan data perumahan, perubahan, keuangan proyek, dan tindak lanjut marketing">
        <a href={`${API}/reports/export/perumahan.csv?target_only=true`}><Button variant="outline" data-testid="export-target-csv"><Download className="h-4 w-4 mr-2" /> Perumahan target (CSV)</Button></a>
        <a href={`${API}/reports/export/perubahan.csv?days=30`}><Button variant="outline" data-testid="export-changes-csv"><Download className="h-4 w-4 mr-2" /> Perubahan 30 hari (CSV)</Button></a>
        <Button onClick={sendDigest} disabled={busy} className="bg-[#065F46] hover:bg-[#064E3B]" data-testid="send-digest-btn"><Mail className="h-4 w-4 mr-2" /> Kirim Ringkasan ke Gmail</Button>
      </PageHeader>

      <div className="grid lg:grid-cols-2 gap-6 mb-6 [&>*]:min-w-0">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-bold text-slate-900">Perumahan baru diinput di Sikumbang per bulan</p>
          <p className="text-xs text-slate-500 mb-3">Berdasarkan tanggal input data di sumber (12 bulan terakhir)</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="jumlah" name="Perumahan" fill="#065F46" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-bold text-slate-900 mb-3">Ringkasan tindak lanjut & keuangan</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {CRM_STAGES.map((s) => (
              <div key={s.key} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xl font-extrabold" style={{ color: s.color }}>{d.pipeline[s.key]}</p>
                <p className="text-[11px] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#ECFDF5] p-3"><p className="text-lg font-extrabold text-[#065F46]">{d.finance.jumlah}</p><p className="text-[11px] text-slate-600">Simulasi finance</p></div>
            <div className="rounded-xl bg-[#ECFDF5] p-3"><p className="text-lg font-extrabold text-[#065F46]">{rupiahShort(d.finance.total_potensi)}</p><p className="text-[11px] text-slate-600">Potensi penjualan</p></div>
            <div className="rounded-xl bg-[#FFFBEB] p-3"><p className="text-lg font-extrabold text-[#B45309]">{rupiahShort(d.finance.total_kebutuhan)}</p><p className="text-[11px] text-slate-600">Kebutuhan pembiayaan</p></div>
          </div>
          <p className="font-semibold text-sm text-slate-800 mt-4 mb-2">Jenis perubahan data (30 hari)</p>
          <div className="flex flex-wrap gap-2">
            {d.jenis_perubahan_30d.length === 0 && <span className="text-xs text-slate-400">Belum ada</span>}
            {d.jenis_perubahan_30d.map((c) => <span key={c.field} className="rounded-full bg-[#FFEDD5] text-[#C2410C] px-2.5 py-1 text-xs font-semibold">{c.field}: {c.jumlah}</span>)}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 [&>*]:min-w-0">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b font-bold text-slate-900">Per kabupaten/kota</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="report-kab-table">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">Wilayah</th><th className="text-right px-3 py-2">Perumahan</th>
                  <th className="text-right px-3 py-2">Unit</th><th className="text-right px-3 py-2">Pengembang</th>
                  <th className="text-right px-3 py-2">Harga min rata-rata</th><th className="text-right px-3 py-2">Baru 30h</th>
                  <th className="text-right px-4 py-2">Di CRM</th>
                </tr>
              </thead>
              <tbody>
                {d.per_kabupaten.map((k) => (
                  <tr key={k.kode} className="border-t">
                    <td className="px-4 py-2 font-semibold">{titleCase(k.nama)} {k.target && <span className="text-[10px] text-[#065F46] font-bold ml-1">TARGET</span>}</td>
                    <td className="px-3 py-2 text-right">{k.perumahan}</td>
                    <td className="px-3 py-2 text-right">{k.unit.toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 text-right">{k.pengembang}</td>
                    <td className="px-3 py-2 text-right">{rupiahShort(k.harga_min_avg)}</td>
                    <td className="px-3 py-2 text-right">{k.baru_30d}</td>
                    <td className="px-4 py-2 text-right">{k.crm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-bold text-slate-900 mb-3">Top developer (wilayah target)</p>
          {d.top_developer.map((x, i) => (
            <div key={x.nama} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
              <span className="text-slate-700 truncate pr-2">{i + 1}. {x.nama}</span>
              <span className="text-slate-500 whitespace-nowrap">{x.proyek} proyek · <b>{x.unit}</b> unit</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

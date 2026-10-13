import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2, Phone, MessageCircle, AtSign, Clock } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import { ListingRow } from "@/pages/Dashboard";
import { fmtDateTime, rupiahShort, telList, titleCase, waLink } from "@/lib/meta";

export default function DeveloperDetail() {
  const [sp] = useSearchParams();
  const nama = sp.get("nama") || "";
  const [d, setD] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/developers/detail", { params: { nama } }).then(({ data }) => setD(data)).catch((e) => toast.error(apiErr(e)));
  }, [nama]);

  if (!d) return <p className="text-slate-400">Memuat…</p>;
  return (
    <div className="fade-up" data-testid="developer-detail">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Kembali
      </button>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-[#ECFDF5] text-[#065F46] flex items-center justify-center shrink-0"><Building2 className="h-6 w-6" /></div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold text-slate-900" data-testid="developer-name">{d.nama}</h1>
            <p className="text-sm text-slate-500">Asosiasi {d.asosiasi || "-"}{d.npwp ? ` · NPWP ${d.npwp}` : ""}</p>
            <p className="text-sm text-slate-500">{d.kabupaten.map(titleCase).join(", ")}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {[["Proyek", d.jumlah_proyek], ["Total unit", d.total_unit.toLocaleString("id-ID")], ["Harga terendah", rupiahShort(d.harga_min)], ["Harga tertinggi", rupiahShort(d.harga_max)]].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-extrabold text-slate-900">{v}</p><p className="text-[11px] text-slate-500">{l}</p></div>
          ))}
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-6 [&>*]:min-w-0">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b font-bold text-slate-900">Proyek perumahan ({d.proyek.length})</div>
          {d.proyek.map((p) => <ListingRow key={p.id} p={p} onOpen={(id) => navigate(`/perumahan/${encodeURIComponent(id)}`)} />)}
        </div>
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-bold text-slate-900 mb-3">Kontak yang ditampilkan</p>
            {d.kontak.length === 0 && <p className="text-sm text-slate-400">Belum ada kontak</p>}
            <div className="space-y-3">
              {d.kontak.map((k, i) => (
                <div key={i} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] text-slate-400">{k.perumahan}</p>
                  <p className="text-xs text-slate-700">{k.alamat}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {telList(k.telp).map((t) => <a key={t} href={`tel:${t}`} className="inline-flex items-center gap-1 rounded bg-white border px-2 py-0.5 text-[11px]"><Phone className="h-3 w-3" />{t}</a>)}
                    {(k.wa || telList(k.telp)[0]) && <a href={waLink(k.wa || telList(k.telp)[0])} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-[#DCFCE7] border border-[#86EFAC] px-2 py-0.5 text-[11px] text-[#15803D]"><MessageCircle className="h-3 w-3" />WA</a>}
                    {k.email && <a href={`mailto:${k.email}`} className="inline-flex items-center gap-1 rounded bg-white border px-2 py-0.5 text-[11px] break-all"><AtSign className="h-3 w-3" />{k.email}</a>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-bold text-slate-900 mb-3">Riwayat komunikasi</p>
            {d.aktivitas.length === 0 && <p className="text-sm text-slate-400">Belum ada aktivitas CRM</p>}
            {d.aktivitas.map((a) => (
              <div key={a.id} className="py-2 border-b last:border-0">
                <p className="text-[11px] text-slate-400 flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDateTime(a.created_at)} · {a.perumahan}</p>
                <p className="text-sm text-slate-700"><b className="capitalize">{a.tipe}</b>: {a.catatan}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Save, Wand2, AlertTriangle, Info } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rupiah, rupiahShort, fmtDateTime } from "@/lib/meta";

const FIELDS = [
  { group: "Data listing", items: [
    { k: "jumlah_unit", label: "Jumlah unit", unit: "unit" },
    { k: "harga_jual_per_unit", label: "Harga jual rata-rata / unit", unit: "Rp", money: true },
  ] },
  { group: "Biaya proyek (input pengguna / data developer)", items: [
    { k: "biaya_tanah", label: "Biaya tanah", unit: "Rp", money: true },
    { k: "biaya_konstruksi_per_unit", label: "Biaya konstruksi / unit", unit: "Rp", money: true },
    { k: "biaya_infrastruktur", label: "Infrastruktur (jalan, drainase, PSU)", unit: "Rp", money: true },
    { k: "biaya_perizinan", label: "Perizinan & legal", unit: "Rp", money: true },
    { k: "biaya_overhead_per_bulan", label: "Overhead / bulan", unit: "Rp", money: true },
    { k: "biaya_lain", label: "Biaya lainnya", unit: "Rp", money: true },
    { k: "biaya_pemasaran_pct", label: "Biaya pemasaran", unit: "% penjualan" },
  ] },
  { group: "Jadwal & penjualan", items: [
    { k: "durasi_konstruksi_bulan", label: "Durasi konstruksi", unit: "bulan" },
    { k: "mulai_jual_bulan", label: "Mulai penjualan (bulan ke-)", unit: "bulan" },
    { k: "unit_terjual_per_bulan", label: "Unit terjual / bulan", unit: "unit" },
  ] },
  { group: "Pendanaan", items: [
    { k: "modal_sendiri", label: "Modal sendiri developer", unit: "Rp", money: true },
    { k: "bunga_pct_tahun", label: "Bunga kredit konstruksi", unit: "% / tahun" },
    { k: "porsi_kredit_maks_pct", label: "Porsi kredit maks. dari biaya", unit: "%" },
  ] },
];

function MoneyInput({ value, onChange, money, testid }) {
  const [txt, setTxt] = useState("");
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setTxt(money ? Number(value || 0).toLocaleString("id-ID") : String(value ?? 0));
  }, [value, money, focus]);
  return (
    <Input
      inputMode="decimal"
      value={txt}
      data-testid={testid}
      onFocus={() => { setFocus(true); setTxt(String(value ?? 0)); }}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        setTxt(e.target.value);
        const n = parseFloat(String(e.target.value).replace(/[^\d.,-]/g, "").replace(",", "."));
        onChange(Number.isNaN(n) ? 0 : n);
      }}
      className="text-right font-mono"
    />
  );
}

function Kpi({ label, value, tone = "slate", sub, testid }) {
  const tones = { slate: "text-slate-900", green: "text-[#065F46]", red: "text-[#B91C1C]", amber: "text-[#B45309]" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid={testid}>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p className={`text-xl font-extrabold mt-1 ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function FinancePanel({ pid }) {
  const [input, setInput] = useState(null);
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState({});
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    api.get(`/finance/${encodeURIComponent(pid)}`).then(({ data }) => {
      setInput(data.input);
      setResult(data.result);
      setMeta({ saved: data.saved, updated_at: data.updated_at, updated_by: data.updated_by, listing: data.listing });
    }).catch((e) => toast.error(apiErr(e)));
  }, [pid]);

  const recalc = useCallback((inp) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.post("/finance/calc", inp);
        setResult(data);
      } catch (e) {
        toast.error(apiErr(e, "Input tidak valid"));
      }
    }, 350);
  }, []);

  const setField = (k, v) => {
    const n = { ...input, [k]: v };
    setInput(n);
    recalc(n);
  };

  const fillDefaults = async () => {
    const { data } = await api.get(`/finance/${encodeURIComponent(pid)}/defaults`);
    setInput(data.input);
    setResult(data.result);
    toast.info("Asumsi contoh diisi — sesuaikan dengan data developer");
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/finance/${encodeURIComponent(pid)}`, input);
      setMeta((m) => ({ ...m, saved: true, updated_at: data.updated_at, updated_by: data.updated_by }));
      toast.success("Simulasi disimpan");
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  if (!input || !result) return <p className="text-slate-400 text-sm">Memuat simulasi…</p>;
  const cf = result.cashflow.map((r) => ({ ...r, pendapatan_jt: r.pendapatan / 1e6, biaya_jt: -r.biaya / 1e6, kumulatif_jt: r.kumulatif / 1e6 }));

  return (
    <div className="space-y-6" data-testid="finance-panel">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          <b>Simulasi.</b> Jumlah unit & harga diambil dari listing Sikumbang; komponen biaya berasal dari input pengguna/developer.
          Angka belum tentu laba bersih (belum mencakup seluruh biaya, pajak, waktu penjualan, dan risiko) dan
          <b> bukan dasar persetujuan kredit</b> atau penilaian kelayakan pembiayaan bank.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Potensi penjualan" value={rupiahShort(result.potensi_penjualan)} sub={`${input.jumlah_unit} unit × ${rupiahShort(input.harga_jual_per_unit)}`} testid="kpi-potensi" />
        <Kpi label="Estimasi total biaya" value={rupiahShort(result.total_biaya)} testid="kpi-biaya" />
        <Kpi label="Selisih penjualan & biaya" value={rupiahShort(result.selisih_penjualan_biaya)} tone={result.selisih_penjualan_biaya >= 0 ? "green" : "red"} sub={`Margin ${result.margin_pct}%`} testid="kpi-selisih" />
        <Kpi label="Kebutuhan pembiayaan" value={rupiahShort(result.kebutuhan_pembiayaan)} tone="amber" sub={`Puncak defisit kas ${rupiahShort(result.puncak_defisit_kas)}`} testid="kpi-kebutuhan" />
        <Kpi label="Estimasi bunga" value={rupiahShort(result.estimasi_bunga)} sub={`${input.bunga_pct_tahun}% p.a.`} />
        <Kpi label="Selisih setelah bunga" value={rupiahShort(result.selisih_setelah_bunga)} tone={result.selisih_setelah_bunga >= 0 ? "green" : "red"} />
        <Kpi label="Kas kembali positif" value={result.bulan_balik_kas ? `Bulan ke-${result.bulan_balik_kas}` : "-"} sub={`Durasi simulasi ${result.durasi_bulan} bulan`} />
        <Kpi label="Batas porsi kredit" value={rupiahShort(result.batas_porsi_kredit)} tone={result.melebihi_porsi_kredit ? "red" : "slate"} sub={result.melebihi_porsi_kredit ? "Kebutuhan melebihi porsi kredit" : `${input.porsi_kredit_maks_pct}% dari total biaya`} />
      </div>

      <div className="grid xl:grid-cols-5 gap-6 [&>*]:min-w-0">
        <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-bold text-slate-900">Input simulasi</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fillDefaults} data-testid="finance-defaults-btn">
                <Wand2 className="h-4 w-4 mr-1.5" /> Isi asumsi contoh
              </Button>
              <Button size="sm" onClick={save} disabled={saving} className="bg-[#065F46] hover:bg-[#064E3B]" data-testid="finance-save-btn">
                <Save className="h-4 w-4 mr-1.5" /> Simpan
              </Button>
            </div>
          </div>
          {meta.saved && <p className="text-[11px] text-slate-400">Tersimpan {fmtDateTime(meta.updated_at)} oleh {meta.updated_by}</p>}
          {FIELDS.map((g) => (
            <div key={g.group}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{g.group}</p>
              <div className="space-y-2">
                {g.items.map((f) => (
                  <div key={f.k} className="grid grid-cols-5 items-center gap-2">
                    <Label className="col-span-3 text-xs text-slate-600">
                      {f.label} <span className="text-slate-400">({f.unit})</span>
                    </Label>
                    <div className="col-span-2">
                      <MoneyInput value={input[f.k]} money={f.money} onChange={(v) => setField(f.k, v)} testid={`fin-${f.k}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {meta.listing?.tipe_rumah?.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 flex gap-2">
              <Info className="h-4 w-4 shrink-0" />
              <span>
                Harga dari Sikumbang: {meta.listing.tipe_rumah.map((t) => `Tipe ${t.nama} ${rupiahShort(t.harga)}`).join(" · ")}
              </span>
            </div>
          )}
        </div>

        <div className="xl:col-span-3 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-bold text-slate-900">Proyeksi cash flow bulanan</p>
            <p className="text-xs text-slate-500 mb-3">Juta rupiah · garis = kas kumulatif (tanpa modal sendiri)</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cf} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="bulan" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v.toLocaleString("id-ID", { maximumFractionDigits: 0 })} />
                  <Tooltip formatter={(v) => `${Number(v).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`} labelFormatter={(l) => `Bulan ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="pendapatan_jt" name="Pendapatan" fill="#10B981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="biaya_jt" name="Biaya" fill="#F97316" radius={[0, 0, 3, 3]} />
                  <Line dataKey="kumulatif_jt" name="Kas kumulatif" stroke="#0F172A" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="max-h-80 overflow-auto brand-scroll">
              <table className="w-full text-xs" data-testid="cashflow-table">
                <thead className="bg-slate-50 sticky top-0 text-slate-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-3 py-2 text-left">Bulan</th>
                    <th className="px-3 py-2 text-right">Unit terjual</th>
                    <th className="px-3 py-2 text-right">Pendapatan</th>
                    <th className="px-3 py-2 text-right">Biaya</th>
                    <th className="px-3 py-2 text-right">Arus kas</th>
                    <th className="px-3 py-2 text-right">Kumulatif</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cashflow.map((r) => (
                    <tr key={r.bulan} className="border-t">
                      <td className="px-3 py-1.5">{r.bulan}</td>
                      <td className="px-3 py-1.5 text-right">{r.unit_terjual}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{rupiah(r.pendapatan)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{rupiah(r.biaya)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${r.arus_kas_bersih < 0 ? "text-red-600" : "text-[#065F46]"}`}>{rupiah(r.arus_kas_bersih)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${r.kumulatif < 0 ? "text-red-600" : "text-[#065F46]"}`}>{rupiah(r.kumulatif)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


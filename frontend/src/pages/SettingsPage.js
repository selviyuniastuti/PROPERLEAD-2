import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Database, Save } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtDateTime, titleCase } from "@/lib/meta";

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [wil, setWil] = useState([]);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const poll = useRef(null);

  const loadStatus = useCallback(async () => {
    const { data } = await api.get("/sync/status");
    setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    api.get("/settings").then(({ data }) => setSettings(data));
    api.get("/wilayah").then(({ data }) => setWil(data));
    loadStatus();
    return () => clearInterval(poll.current);
  }, [loadStatus]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings", { targets: settings.targets, email_new_listing: settings.email_new_listing, telegram_enabled: settings.telegram_enabled });
      toast.success("Pengaturan disimpan — skor prioritas dihitung ulang");
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  const run = async (mode) => {
    try {
      const { data } = await api.post("/sync/run", { mode });
      if (data.status === "busy") return toast.info("Sinkronisasi sedang berjalan");
      toast.success(mode === "full" ? "Full scan dimulai (± 2 menit)" : "Sinkronisasi dimulai");
      clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const s = await loadStatus();
        if (!s.running) clearInterval(poll.current);
      }, 4000);
      loadStatus();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  if (!settings) return <p className="text-slate-400">Memuat…</p>;
  const count = (k) => wil.find((w) => w.kode === k)?.jumlah_perumahan ?? 0;

  return (
    <div className="fade-up" data-testid="settings-page">
      <PageHeader title="Wilayah & Collector" subtitle="Atur wilayah target Kalimantan Selatan dan pantau pengambilan data Sikumbang" />
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="font-bold text-slate-900">Wilayah target</p>
            <Button size="sm" onClick={save} disabled={saving} className="bg-[#065F46] hover:bg-[#064E3B]" data-testid="save-settings-btn"><Save className="h-4 w-4 mr-1.5" /> Simpan</Button>
          </div>
          <p className="text-xs text-slate-500 mb-3">Perumahan di wilayah target mendapat +30 skor dan dikirim sebagai notifikasi Gmail (untuk user tanpa pengaturan wilayah khusus).</p>
          <div className="space-y-1">
            {settings.targets.map((t, i) => (
              <label key={t.kode} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50" data-testid={`target-${t.kode}`}>
                <span className="flex items-center gap-3 text-sm text-slate-800">
                  <Checkbox checked={t.target} onCheckedChange={(v) => setSettings({ ...settings, targets: settings.targets.map((x, j) => (j === i ? { ...x, target: !!v } : x)) })} />
                  {titleCase(t.nama)}
                </span>
                <span className="text-xs text-slate-400">{count(t.kode)} perumahan</span>
              </label>
            ))}
          </div>
          <div className="border-t mt-4 pt-4 space-y-3">
            <label className="flex items-center justify-between text-sm">Email Gmail otomatis untuk listing baru <Switch checked={settings.email_new_listing} onCheckedChange={(v) => setSettings({ ...settings, email_new_listing: v })} data-testid="toggle-email-new" /></label>
            <label className="flex items-center justify-between text-sm">Notifikasi Telegram <Switch checked={settings.telegram_enabled} onCheckedChange={(v) => setSettings({ ...settings, telegram_enabled: v })} /></label>
            <p className="text-[11px] text-slate-400">Telegram aktif bila TELEGRAM_TOKEN & TELEGRAM_CHAT_ID diisi di server.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-[#ECFDF5] flex items-center justify-center"><Database className="h-5 w-5 text-[#065F46]" /></div>
            <div>
              <p className="font-bold text-slate-900">Data Collector Sikumbang</p>
              <p className="text-xs text-slate-500">{status?.provinsi} · {status?.total_perumahan?.toLocaleString("id-ID")} perumahan tersimpan</p>
            </div>
          </div>
          <ul className="text-xs text-slate-600 space-y-1 mb-4 list-disc pl-4">
            <li>Otomatis tiap 30 menit: 200 listing terbaru (deteksi listing baru + perubahan).</li>
            <li>Full scan harian 03:00 WITA: seluruh listing Kalsel (perubahan harga/unit/kontak & listing yang hilang).</li>
            <li>Ringkasan harian ke Gmail 07:30 WITA.</li>
            <li>Pengambilan pelan (jeda antar halaman), hanya data publik; NIK pemilik/pemesan tidak disimpan.</li>
          </ul>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="outline" onClick={() => run("incremental")} disabled={status?.running} data-testid="run-incremental-btn"><RefreshCw className={`h-4 w-4 mr-2 ${status?.running ? "animate-spin" : ""}`} /> Sinkron cepat</Button>
            <Button variant="outline" onClick={() => run("full")} disabled={status?.running} data-testid="run-full-btn">Full scan sekarang</Button>
          </div>
          <p className="text-sm font-semibold text-slate-800 mb-2">Riwayat sinkronisasi</p>
          <div className="max-h-80 overflow-y-auto brand-scroll">
            <table className="w-full text-xs" data-testid="sync-runs-table">
              <thead className="text-slate-500"><tr><th className="text-left py-1">Waktu</th><th className="text-left">Mode</th><th className="text-left">Status</th><th className="text-right">Diambil</th><th className="text-right">Baru</th><th className="text-right">Berubah</th></tr></thead>
              <tbody>
                {status?.runs?.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5">{fmtDateTime(r.started_at)}</td>
                    <td>{r.mode}<span className="text-slate-400"> · {r.triggered_by}</span></td>
                    <td className={r.status === "success" ? "text-[#065F46]" : r.status === "running" ? "text-blue-600" : "text-red-600"} title={r.error || ""}>{r.status}</td>
                    <td className="text-right">{r.fetched}{r.total_source ? `/${r.total_source}` : ""}</td>
                    <td className="text-right font-semibold">{r.new}</td>
                    <td className="text-right">{r.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import {
  Home,
  Target,
  Sparkles,
  RefreshCw,
  AlarmClock,
  Route,
  MapPin,
  ExternalLink,
  Database,
  Filter,
  Calculator,
  KanbanSquare,
  Bell,
  DownloadCloud,
} from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import PageHeader, { StatCard } from "@/components/PageHeader";
import { DeteksiBadge, PriorityBadge } from "@/components/Badges";
import AddToPlanButton from "@/components/AddToPlanButton";
import { Button } from "@/components/ui/button";
import { CRM_STAGES, PRIORITY_META, fmtDateTime, mapsHref, rupiahShort, titleCase } from "@/lib/meta";

const FLOW = [
  { icon: DownloadCloud, t: "Sikumbang", d: "Sumber data publik" },
  { icon: Database, t: "Collector", d: "Tiap 30 menit" },
  { icon: Filter, t: "Deteksi", d: "Baru & berubah" },
  { icon: Target, t: "Lead", d: "Skor & prioritas" },
  { icon: Calculator, t: "Finance", d: "Simulasi proyek" },
  { icon: KanbanSquare, t: "CRM", d: "Follow-up" },
  { icon: Bell, t: "Notifikasi", d: "Gmail & Kalender" },
];

export function ListingRow({ p, onOpen }) {
  const w = p.wilayah || {};
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-slate-50 transition-colors"
      data-testid={`listing-row-${p.id}`}
    >
      <button onClick={() => onOpen(p.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
        {p.foto?.[0] ? (
          <img src={p.foto[0]} alt="" className="h-12 w-12 rounded-lg object-cover bg-slate-100 shrink-0" loading="lazy" />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <Home className="h-5 w-5 text-slate-400" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-900 truncate">{p.nama}</p>
            <DeteksiBadge value={p.deteksi} />
          </div>
          <p className="text-xs text-slate-500 truncate">
            {p.pengembang?.nama || "-"} · {titleCase(w.kecamatan)}, {titleCase(w.kabupaten)}
          </p>
          <p className="text-[11px] text-slate-400">
            {p.jumlah_unit} unit · mulai {rupiahShort(p.harga_min)} · input sumber {fmtDateTime(p.tanggal_input_sumber)}
          </p>
        </div>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <PriorityBadge value={p.prioritas} score={p.score} />
        <a
          href={mapsHref(p)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium text-[#1A73E8] hover:bg-blue-50"
          data-testid={`maps-link-${p.id}`}
        >
          <MapPin className="h-3.5 w-3.5" /> Maps
        </a>
        <AddToPlanButton perumahanId={p.id} label="Rencana" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();
  const poll = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard");
      setD(data);
      setSyncing(data.sync_running);
      return data;
    } catch (e) {
      toast.error(apiErr(e));
    }
  }, []);

  useEffect(() => {
    load();
    return () => clearInterval(poll.current);
  }, [load]);

  const runSync = async () => {
    try {
      const { data } = await api.post("/sync/run", { mode: "incremental" });
      if (data.status === "busy") toast.info("Sinkronisasi sedang berjalan");
      else toast.success("Sinkronisasi Sikumbang dimulai");
      setSyncing(true);
      clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const nd = await load();
        if (nd && !nd.sync_running) {
          clearInterval(poll.current);
          const r = nd.last_sync;
          if (r) toast.success(`Sinkronisasi selesai: ${r.new} listing baru, ${r.updated} data berubah`);
        }
      }, 4000);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const open = (id) => navigate(`/perumahan/${encodeURIComponent(id)}`);

  if (!d) return <div className="text-slate-400">Memuat dashboard…</div>;
  const targetSet = new Set(d.per_kabupaten.filter((k) => k.target).map((k) => k.kode));
  const kabData = d.per_kabupaten.map((k) => ({ kode: k.kode, jumlah: k.jumlah, short: titleCase(k.nama).replace("Kab. ", "").replace("Kota ", "") }));
  const totalPrio = Object.values(d.prioritas).reduce((a, b) => a + b, 0) || 1;
  const last = d.last_sync;

  return (
    <div className="fade-up" data-testid="dashboard-page">
      <PageHeader
        title="Dashboard Lead Perumahan"
        subtitle={`Kalimantan Selatan · sumber Sikumbang · sinkron terakhir ${last ? fmtDateTime(last.finished_at || last.started_at) : "-"}`}
      >
        <Button onClick={runSync} disabled={syncing} className="bg-[#065F46] hover:bg-[#064E3B]" data-testid="sync-now-btn">
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Menyinkronkan…" : "Sinkronkan Sekarang"}
        </Button>
      </PageHeader>

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-3 overflow-x-auto brand-scroll">
        <div className="flex items-center gap-2 min-w-max">
          {FLOW.map((f, i) => (
            <div key={f.t} className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <f.icon className="h-4 w-4 text-[#065F46]" />
                <div className="leading-tight">
                  <p className="text-xs font-bold text-slate-800">{f.t}</p>
                  <p className="text-[10px] text-slate-500">{f.d}</p>
                </div>
              </div>
              {i < FLOW.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard icon={Home} label="Perumahan Kalsel" value={d.total.toLocaleString("id-ID")} hint="Terdaftar di Sikumbang" onClick={() => navigate("/perumahan")} testid="stat-total" />
        <StatCard icon={Target} label="Di Wilayah Target" value={d.target.toLocaleString("id-ID")} hint={`${d.unit_target.toLocaleString("id-ID")} unit`} tone="blue" onClick={() => navigate("/perumahan?target_only=1")} testid="stat-target" />
        <StatCard icon={Sparkles} label="Listing Baru (7 hari)" value={d.new_7d} hint="Terdeteksi oleh collector" tone="emerald" onClick={() => navigate("/perumahan?deteksi=NEW_LISTING")} testid="stat-new" />
        <StatCard icon={RefreshCw} label="Data Berubah (7 hari)" value={d.changed_7d} hint="Harga, unit, kontak, status" tone="orange" onClick={() => navigate("/perumahan?deteksi=DATA_UPDATED&sort=berubah")} testid="stat-changed" />
        <StatCard icon={AlarmClock} label="Follow-up Jatuh Tempo" value={d.followup_due} hint="Hari ini & terlambat" tone="red" onClick={() => navigate("/crm")} testid="stat-followup" />
        <StatCard icon={Route} label="Kunjungan Hari Ini" value={d.plan_today} hint="Rencana kunjungan Anda" tone="amber" onClick={() => navigate("/rencana")} testid="stat-plan" />
      </div>

      <div className="grid lg:grid-cols-5 gap-6 mb-6 [&>*]:min-w-0">
        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="latest-new-card">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <p className="font-bold text-slate-900">Listing Baru Terdeteksi</p>
              <p className="text-xs text-slate-500">Muncul di Sikumbang setelah collector mulai memantau</p>
            </div>
            <Link to="/perumahan?deteksi=NEW_LISTING" className="text-xs font-semibold text-[#065F46]">Lihat semua</Link>
          </div>
          {d.latest_new.length === 0 ? (
            <div>
              <p className="px-4 py-3 text-sm text-slate-500 bg-slate-50 border-b">
                Belum ada listing baru sejak data awal diambil. Listing dengan tanggal input terbaru di wilayah target:
              </p>
              {d.latest_source.map((p) => <ListingRow key={p.id} p={p} onOpen={open} />)}
            </div>
          ) : (
            d.latest_new.map((p) => <ListingRow key={p.id} p={p} onOpen={open} />)
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-bold text-slate-900 mb-1">Prioritas Tindak Lanjut</p>
            <p className="text-xs text-slate-500 mb-4">Perumahan di wilayah target</p>
            {["A", "B", "C"].map((k) => (
              <div key={k} className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">{PRIORITY_META[k].label}</span>
                  <span className="font-bold text-slate-900">{d.prioritas[k]}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full" style={{ width: `${(d.prioritas[k] / totalPrio) * 100}%`, background: PRIORITY_META[k].color }} />
                </div>
              </div>
            ))}
            <button onClick={() => navigate("/perumahan?prioritas=A&review=BELUM_REVIEW&target_only=1")} className="mt-2 text-xs font-semibold text-[#065F46]" data-testid="review-pending-link">
              {d.review_pending} lead prioritas A belum direview →
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="font-bold text-slate-900 mb-3">Pipeline CRM</p>
            <div className="space-y-2">
              {CRM_STAGES.map((s) => (
                <div key={s.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-bold text-slate-900">{d.pipeline[s.key]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6 [&>*]:min-w-0">
        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-bold text-slate-900">Perumahan per Kabupaten/Kota</p>
          <p className="text-xs text-slate-500 mb-3">Hijau = wilayah target</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kabData} margin={{ left: -10, right: 8, bottom: 40 }}>
                <XAxis dataKey="short" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v, n) => [v.toLocaleString("id-ID"), n === "jumlah" ? "Perumahan" : n]} />
                <Bar dataKey="jumlah" radius={[6, 6, 0, 0]}>
                  {kabData.map((k) => <Cell key={k.kode} fill={targetSet.has(k.kode) ? "#065F46" : "#CBD5E1"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="latest-changes-card">
          <div className="px-4 py-3 border-b">
            <p className="font-bold text-slate-900">Perubahan Data Terbaru</p>
            <p className="text-xs text-slate-500">Hasil perbandingan snapshot</p>
          </div>
          {d.latest_changes.length === 0 && <p className="p-6 text-sm text-slate-400 text-center">Belum ada perubahan terdeteksi</p>}
          {d.latest_changes.map((c) => (
            <button key={c.id} onClick={() => open(c.perumahan_id)} className="w-full text-left px-4 py-3 border-b last:border-0 hover:bg-slate-50">
              <p className="text-sm font-semibold text-slate-900 truncate">{c.nama}</p>
              <p className="text-xs text-slate-600">
                {c.label}: <span className="line-through text-slate-400">{c.old}</span> → <span className="font-semibold text-[#C2410C]">{c.new}</span>
              </p>
              <p className="text-[11px] text-slate-400">{titleCase(c.kabupaten)} · {fmtDateTime(c.detected_at)}</p>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-6 text-[11px] text-slate-400">
        Sumber: portal publik Sikumbang (sikumbang.tapera.go.id). Sistem hanya menampilkan perubahan yang terdeteksi dari sumber; listing baru tidak otomatis berarti izin baru terbit atau developer membutuhkan pembiayaan.
      </p>
    </div>
  );
}

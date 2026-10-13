import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Navigation, Wand2, CalendarDays, Mail, ChevronUp, ChevronDown, Trash2, MapPin, Search, Crosshair, ChevronLeft,
  ChevronRight, CheckCircle2, Download, Plus,
} from "lucide-react";
import { toast } from "sonner";
import api, { API, apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { PriorityBadge } from "@/components/Badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { titleCase, todayWita, rupiahShort } from "@/lib/meta";

const numIcon = (n, done) =>
  L.divIcon({
    className: "",
    html: `<div style="background:${done ? "#64748B" : "#065F46"};color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
const startIcon = L.divIcon({
  className: "",
  html: `<div style="background:#1A73E8;width:18px;height:18px;border-radius:9999px;border:3px solid #fff;box-shadow:0 0 0 4px rgba(26,115,232,.3)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 13);
    else if (points.length > 1) map.fitBounds(points, { padding: [40, 40] });
  }, [points, map]);
  return null;
}

const shiftDate = (d, n) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};

export default function RencanaPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const [date, setDate] = useState(sp.get("date") || todayWita());
  const [plan, setPlan] = useState(null);
  const [stops, setStops] = useState([]);
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [suggest, setSuggest] = useState([]);
  const [history, setHistory] = useState([]);
  const saveTimer = useRef(null);
  const handledAdd = useRef(false);

  const apply = (data) => {
    setPlan(data);
    setStops(data.stops.map((s) => ({ ...s })));
  };

  const load = useCallback(async (d) => {
    try {
      const { data } = await api.get(`/plans/${d}`);
      apply(data);
    } catch (e) {
      toast.error(apiErr(e));
    }
  }, []);

  useEffect(() => {
    const add = sp.get("add");
    if (add && !handledAdd.current) {
      handledAdd.current = true;
      api.post(`/plans/today/add`, { perumahan_id: add })
        .then(({ data }) => {
          apply(data);
          setDate(data.date);
          toast.success(data.already ? "Perumahan sudah ada di rencana hari ini" : "Perumahan ditambahkan ke rencana kunjungan hari ini");
        })
        .catch((e) => toast.error(apiErr(e)))
        .finally(() => { const n = new URLSearchParams(sp); n.delete("add"); setSp(n, { replace: true }); });
      return;
    }
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    api.get("/perumahan", { params: { prioritas: "A", target_only: true, sort: "sumber_terbaru", limit: 6 } }).then(({ data }) => setSuggest(data.items)).catch(() => {});
    api.get("/plans").then(({ data }) => setHistory(data)).catch(() => {});
  }, [plan?.stops?.length]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => {
      api.get("/perumahan", { params: { q, limit: 8, sort: "skor" } }).then(({ data }) => setResults(data.items)).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const persist = useCallback(async (newStops, start = plan?.start, immediate = false) => {
    clearTimeout(saveTimer.current);
    const run = async () => {
      try {
        const body = {
          start,
          stops: newStops.map((s) => ({
            perumahan_id: s.perumahan_id, waktu: s.waktu, durasi_menit: s.durasi_menit, catatan: s.catatan || "",
            visited: !!s.visited, hasil: s.hasil || "",
          })),
        };
        const { data } = await api.put(`/plans/${date}`, body);
        setPlan(data);
        if (immediate) setStops(data.stops.map((s) => ({ ...s })));
      } catch (e) {
        toast.error(apiErr(e));
      }
    };
    if (immediate) await run();
    else saveTimer.current = setTimeout(run, 700);
  }, [date, plan?.start]);

  const edit = (i, patch, immediate = false) => {
    const n = stops.map((s, j) => (j === i ? { ...s, ...patch } : s));
    setStops(n);
    persist(n, plan?.start, immediate);
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const n = [...stops];
    [n[i], n[j]] = [n[j], n[i]];
    setStops(n);
    persist(n, plan?.start, true);
  };
  const remove = (i) => {
    const n = stops.filter((_, j) => j !== i);
    setStops(n);
    persist(n, plan?.start, true);
  };

  const addStop = async (pid) => {
    try {
      const { data } = await api.post(`/plans/${date}/add`, { perumahan_id: pid });
      apply(data);
      setQ("");
      toast.success(data.already ? "Sudah ada di rencana" : "Ditambahkan ke rencana");
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error("Browser tidak mendukung lokasi");
    setBusy("geo");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const start = { label: "Lokasi saya", lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) };
        await persist(stops, start, true);
        setBusy("");
        toast.success("Titik awal diset ke lokasi Anda");
      },
      () => { setBusy(""); toast.error("Izin lokasi ditolak"); },
      { timeout: 10000 }
    );
  };
  const clearStart = () => persist(stops, null, true);

  const act = async (key, fn, ok) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy("");
    }
  };

  const points = useMemo(() => {
    const pts = [];
    if (plan?.start?.lat) pts.push([plan.start.lat, plan.start.lng]);
    (plan?.stops || []).forEach((s) => s.perumahan?.lat && pts.push([s.perumahan.lat, s.perumahan.lng]));
    return pts;
  }, [plan]);

  const visited = stops.filter((s) => s.visited).length;

  return (
    <div className="fade-up" data-testid="rencana-page">
      <PageHeader title="Rencana Kunjungan Harian" subtitle="Pilih perumahan yang akan dikunjungi, atur urutan, lalu buka rute multi-titik di Google Maps">
        <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
          <Button variant="ghost" size="sm" onClick={() => setDate(shiftDate(date, -1))} data-testid="plan-prev-day"><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-[150px] border-0" data-testid="plan-date" />
          <Button variant="ghost" size="sm" onClick={() => setDate(shiftDate(date, 1))} data-testid="plan-next-day"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {date !== todayWita() && <Button variant="outline" size="sm" onClick={() => setDate(todayWita())}>Hari ini</Button>}
      </PageHeader>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-6 flex flex-wrap items-center gap-2">
        <a href={plan?.route_url || undefined} target="_blank" rel="noreferrer" className={!plan?.route_url ? "pointer-events-none opacity-50" : ""} data-testid="open-route-btn">
          <Button className="bg-[#1A73E8] hover:bg-[#1557B0]"><Navigation className="h-4 w-4 mr-2" /> Buka Rute di Google Maps</Button>
        </a>
        <Button variant="outline" disabled={stops.length < 2 || busy === "opt"} onClick={() => act("opt", async () => { const { data } = await api.post(`/plans/${date}/optimize`); apply(data); }, "Urutan dioptimalkan (terdekat lebih dulu)")} data-testid="optimize-btn">
          <Wand2 className="h-4 w-4 mr-2" /> Optimalkan Urutan
        </Button>
        <a href={stops.length ? `${API}/plans/${date}/ics` : undefined} className={!stops.length ? "pointer-events-none opacity-50" : ""} data-testid="download-ics-btn">
          <Button variant="outline"><Download className="h-4 w-4 mr-2 text-[#D97706]" /> Unduh ke Google Kalender (.ics)</Button>
        </a>
        <Button variant="outline" disabled={!stops.length || busy === "mail"} onClick={() => act("mail", () => api.post(`/plans/${date}/email`), "Rencana dikirim ke Gmail Anda")} data-testid="email-plan-btn">
          <Mail className="h-4 w-4 mr-2" /> Kirim ke Gmail
        </Button>
        <div className="ml-auto text-sm text-slate-600">
          <b>{stops.length}</b> kunjungan · <b>{visited}</b> selesai · ± <b>{plan?.total_km ?? 0}</b> km (garis lurus)
        </div>
        {plan?.waypoint_limit_exceeded && <p className="w-full text-xs text-amber-700">Google Maps hanya mendukung 10 titik per rute; titik setelah ke-10 perlu dibuka terpisah.</p>}
      </div>

      <div className="grid xl:grid-cols-5 gap-6 [&>*]:min-w-0">
        <div className="xl:col-span-3 space-y-4 min-w-0">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-[#EFF6FF] flex items-center justify-center"><Crosshair className="h-4 w-4 text-[#1A73E8]" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">Titik awal: {plan?.start?.lat ? plan.start.label : "Lokasi Anda saat membuka Google Maps"}</p>
              {plan?.start?.lat && <p className="text-[11px] font-mono text-slate-400">{plan.start.lat}, {plan.start.lng}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={useMyLocation} disabled={busy === "geo"} data-testid="use-location-btn">Gunakan lokasi saya</Button>
            {plan?.start?.lat && <Button size="sm" variant="ghost" onClick={clearStart}>Hapus</Button>}
          </div>

          {stops.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center" data-testid="plan-empty">
              <MapPin className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">Belum ada kunjungan untuk tanggal ini</p>
              <p className="text-sm text-slate-500">Cari perumahan di panel kanan, klik “Rencana” di daftar perumahan, atau tombol di email notifikasi.</p>
            </div>
          )}

          {stops.map((s, i) => {
            const p = s.perumahan || {};
            return (
              <div key={s.perumahan_id} className={`rounded-2xl border bg-white p-4 ${s.visited ? "border-slate-200 opacity-75" : "border-slate-200"}`} data-testid={`plan-stop-${i}`}>
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${s.visited ? "bg-slate-400" : "bg-[#065F46]"}`}>{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button className="font-bold text-slate-900 hover:underline text-left" onClick={() => navigate(`/perumahan/${encodeURIComponent(p.id)}`)}>{p.nama}</button>
                      <PriorityBadge value={p.prioritas} score={p.score} />
                    </div>
                    <p className="text-xs text-slate-500 truncate">{p.pengembang?.nama} · {titleCase(p.wilayah?.kecamatan)}, {titleCase(p.wilayah?.kabupaten)}</p>
                    <p className="text-[11px] text-slate-400">
                      {i > 0 || plan?.start?.lat ? `± ${s.jarak_km} km dari titik sebelumnya · ` : ""}{p.jumlah_unit} unit
                      {p.kantor?.[0]?.telp ? ` · Telp ${p.kantor[0].telp}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30" data-testid={`stop-up-${i}`}><ChevronUp className="h-4 w-4" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === stops.length - 1} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30" data-testid={`stop-down-${i}`}><ChevronDown className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="grid sm:grid-cols-12 gap-2 mt-3">
                  <Input type="time" value={s.waktu || ""} onChange={(e) => edit(i, { waktu: e.target.value })} className="sm:col-span-2" data-testid={`stop-time-${i}`} />
                  <select value={s.durasi_menit} onChange={(e) => edit(i, { durasi_menit: +e.target.value })} className="sm:col-span-2 h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                    {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{`${m} menit`}</option>)}
                  </select>
                  <Input placeholder="Catatan / tujuan kunjungan" value={s.catatan || ""} onChange={(e) => edit(i, { catatan: e.target.value })} className="sm:col-span-8" data-testid={`stop-note-${i}`} />
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <a href={s.maps_url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="text-[#1A73E8]"><MapPin className="h-4 w-4 mr-1" /> Maps</Button></a>
                  <a href={s.gcal_url} target="_blank" rel="noreferrer" data-testid={`stop-gcal-${i}`}><Button size="sm" variant="outline"><CalendarDays className="h-4 w-4 mr-1 text-[#D97706]" /> Google Kalender</Button></a>
                  <label className="flex items-center gap-2 text-sm text-slate-700 ml-1">
                    <Checkbox checked={!!s.visited} onCheckedChange={(v) => edit(i, { visited: !!v }, true)} data-testid={`stop-visited-${i}`} />
                    Sudah dikunjungi
                  </label>
                  {s.visited && (
                    <Input placeholder="Hasil kunjungan (tercatat di CRM)" defaultValue={s.hasil || ""} onBlur={(e) => e.target.value !== (s.hasil || "") && edit(i, { hasil: e.target.value }, true)} className="flex-1 min-w-[200px] h-9" data-testid={`stop-result-${i}`} />
                  )}
                  {s.visited && s.visited_at && <CheckCircle2 className="h-4 w-4 text-[#065F46]" />}
                  <button onClick={() => remove(i)} className="ml-auto p-2 rounded hover:bg-red-50 text-red-500" data-testid={`stop-remove-${i}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="xl:col-span-2 space-y-4 min-w-0">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden h-80">
            <MapContainer center={[-3.35, 114.75]} zoom={9} className="h-full w-full" scrollWheelZoom={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
              <FitBounds points={points} />
              {plan?.start?.lat && <Marker position={[plan.start.lat, plan.start.lng]} icon={startIcon}><Tooltip>Titik awal</Tooltip></Marker>}
              {(plan?.stops || []).map((s, i) => s.perumahan?.lat && (
                <Marker key={s.perumahan_id} position={[s.perumahan.lat, s.perumahan.lng]} icon={numIcon(i + 1, s.visited)}>
                  <Tooltip>{i + 1}. {s.perumahan.nama} ({s.waktu})</Tooltip>
                </Marker>
              ))}
              {points.length > 1 && <Polyline positions={points} pathOptions={{ color: "#065F46", weight: 3, dashArray: "6 6" }} />}
            </MapContainer>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="font-bold text-slate-900 mb-2">Tambah perumahan</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama perumahan / developer…" className="pl-9" data-testid="plan-search" />
            </div>
            <div className="mt-2 max-h-72 overflow-y-auto brand-scroll">
              {(q ? results : suggest).map((p) => (
                <div key={p.id} className="flex items-center gap-2 py-2 border-b last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.nama}</p>
                    <p className="text-[11px] text-slate-500 truncate">{titleCase(p.wilayah?.kecamatan)}, {titleCase(p.wilayah?.kabupaten)} · {p.jumlah_unit} unit · {rupiahShort(p.harga_min)}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => addStop(p.id)} data-testid={`plan-add-${p.id}`}><Plus className="h-4 w-4" /></Button>
                </div>
              ))}
              {!q && suggest.length > 0 && <p className="text-[11px] text-slate-400 mt-2">Saran: prioritas A di wilayah target dengan input Sikumbang terbaru</p>}
              {q && results.length === 0 && <p className="text-sm text-slate-400 py-3">Tidak ditemukan</p>}
            </div>
          </div>

          {history.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="font-bold text-slate-900 mb-2">Riwayat rencana</p>
              {history.slice(0, 8).map((h) => (
                <button key={h.id} onClick={() => setDate(h.date)} className={`w-full flex justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-50 ${h.date === date ? "bg-[#ECFDF5]" : ""}`}>
                  <span className="text-slate-700">{h.date}</span>
                  <span className="text-slate-500">{h.dikunjungi}/{h.jumlah} dikunjungi</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

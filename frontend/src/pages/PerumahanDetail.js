import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  ArrowLeft, MapPin, CalendarDays, Mail, ExternalLink, Phone, MessageCircle, AtSign, RefreshCw, Building2, Clock, Plus,
} from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import { DeteksiBadge, PriorityBadge, ReviewBadge, StageBadge } from "@/components/Badges";
import AddToPlanButton from "@/components/AddToPlanButton";
import FinancePanel from "@/components/FinancePanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AKTIVITAS_TIPE, CRM_STAGES, REVIEW_META, fmtDate, fmtDateTime, rupiah, telList, titleCase, waLink,
} from "@/lib/meta";

function Info({ label, children }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
      <div className="text-sm text-slate-800 mt-0.5">{children || "-"}</div>
    </div>
  );
}

export default function PerumahanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get("tab") || "ringkasan");
  const [busy, setBusy] = useState("");
  const [act, setAct] = useState({ tipe: "telepon", catatan: "", kontak_person: "", hasil: "", tanggal_followup: "" });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/perumahan/${encodeURIComponent(id)}`);
      setP(data);
    } catch (e) {
      toast.error(apiErr(e));
      if (e?.response?.status === 404) navigate("/perumahan");
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const doAction = async (key, fn, ok) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy("");
    }
  };

  if (!p) return <p className="text-slate-400">Memuat…</p>;
  const w = p.wilayah || {};
  const enc = encodeURIComponent(p.id);

  const submitAct = () =>
    doAction("act", async () => {
      if (!act.catatan.trim()) throw new Error("Catatan wajib diisi");
      const body = { ...act };
      Object.keys(body).forEach((k) => body[k] === "" && delete body[k]);
      await api.post(`/perumahan/${enc}/aktivitas`, body);
      setAct({ tipe: "telepon", catatan: "", kontak_person: "", hasil: "", tanggal_followup: "" });
    }, "Aktivitas dicatat");

  return (
    <div className="fade-up" data-testid="perumahan-detail">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Kembali
      </button>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <PriorityBadge value={p.prioritas} score={p.score} />
              <DeteksiBadge value={p.deteksi} />
              <ReviewBadge value={p.review_status} />
              {p.crm_status && <StageBadge value={p.crm_status} />}
              {p.delisted && <span className="text-[11px] font-semibold text-red-600">Tidak lagi tampil di Sikumbang</span>}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900" data-testid="detail-nama">{p.nama}</h1>
            <Link to={`/developer/detail?nama=${encodeURIComponent(p.pengembang?.nama || "")}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#065F46] mt-1" data-testid="developer-link">
              <Building2 className="h-4 w-4" /> {p.pengembang?.nama || "-"} {p.pengembang?.asosiasi && <span className="text-slate-400 font-normal">· {p.pengembang.asosiasi}</span>}
              {p.developer_lain > 0 && <span className="text-xs text-slate-400 font-normal">(+{p.developer_lain} proyek lain)</span>}
            </Link>
            <p className="text-sm text-slate-500 mt-1">
              {titleCase(w.kelurahan)}, {titleCase(w.kecamatan)}, {titleCase(w.kabupaten)} · <span className="font-mono text-xs">{p.id}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={p.maps_url} target="_blank" rel="noreferrer" data-testid="detail-maps-btn">
              <Button className="bg-[#1A73E8] hover:bg-[#1557B0]"><MapPin className="h-4 w-4 mr-1.5" /> Google Maps</Button>
            </a>
            <AddToPlanButton perumahanId={p.id} size="default" label="Rencana Hari Ini" />
            <a href={p.gcal_url} target="_blank" rel="noreferrer" data-testid="detail-gcal-btn">
              <Button variant="outline"><CalendarDays className="h-4 w-4 mr-1.5 text-[#D97706]" /> Google Kalender</Button>
            </a>
            <Button variant="outline" disabled={busy === "email"} onClick={() => doAction("email", () => api.post(`/perumahan/${enc}/email-me`), "Detail dikirim ke email Anda")} data-testid="detail-email-btn">
              <Mail className="h-4 w-4 mr-1.5" /> Kirim ke Gmail Saya
            </Button>
            <a href={p.sumber?.url} target="_blank" rel="noreferrer">
              <Button variant="ghost"><ExternalLink className="h-4 w-4 mr-1.5" /> Sikumbang</Button>
            </a>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="ringkasan" data-testid="tab-ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="unit" data-testid="tab-unit">Unit & Harga</TabsTrigger>
          <TabsTrigger value="riwayat" data-testid="tab-riwayat">Riwayat Perubahan ({p.perubahan?.length || 0})</TabsTrigger>
          <TabsTrigger value="crm" data-testid="tab-crm">CRM & Follow-up</TabsTrigger>
          <TabsTrigger value="finance" data-testid="tab-finance">Project Finance</TabsTrigger>
        </TabsList>

        <TabsContent value="ringkasan">
          <div className="grid lg:grid-cols-3 gap-6 [&>*]:min-w-0">
            <div className="lg:col-span-2 space-y-6">
              {p.foto?.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {p.foto.slice(0, 3).map((f) => (
                    <img key={f} src={f} alt={p.nama} className="h-32 sm:h-44 w-full object-cover rounded-xl bg-slate-100" loading="lazy" />
                  ))}
                </div>
              )}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Info label="Jenis">{p.jenis}</Info>
                <Info label="Jumlah unit">{p.jumlah_unit} unit{p.jumlah_unit_komersil ? ` (${p.jumlah_unit_komersil} komersil)` : ""}</Info>
                <Info label="Rentang harga">{p.harga_min ? `${rupiah(p.harga_min)}${p.harga_max !== p.harga_min ? ` – ${rupiah(p.harga_max)}` : ""}` : "Tidak ditampilkan"}</Info>
                <Info label="Kabupaten/Kota">{titleCase(w.kabupaten)}</Info>
                <Info label="Kecamatan">{titleCase(w.kecamatan)}</Info>
                <Info label="Kelurahan/Desa">{titleCase(w.kelurahan)}</Info>
                <Info label="Koordinat">{p.lat ? <span className="font-mono text-xs">{p.lat}, {p.lng}</span> : "Tidak tersedia"}</Info>
                <Info label="Tahun registrasi">{p.tahun_registrasi}</Info>
                <Info label="NPWP pengembang">{p.npwp_pengembang || <span className="text-slate-400 text-xs">Muat detail unit untuk melihat</span>}</Info>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="font-bold text-slate-900 mb-3">Kantor pemasaran</p>
                {(!p.kantor || p.kantor.length === 0) && <p className="text-sm text-slate-400">Kontak belum ditampilkan di Sikumbang</p>}
                <div className="space-y-3">
                  {p.kantor?.map((k, i) => (
                    <div key={i} className="rounded-xl bg-slate-50 p-3" data-testid={`kantor-${i}`}>
                      <p className="text-sm text-slate-700">{k.alamat || "-"}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {telList(k.telp).map((t) => (
                          <a key={t} href={`tel:${t}`} className="inline-flex items-center gap-1 rounded-md bg-white border px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                            <Phone className="h-3.5 w-3.5" /> {t}
                          </a>
                        ))}
                        {(k.wa || telList(k.telp)[0]) && (
                          <a href={waLink(k.wa || telList(k.telp)[0])} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-[#DCFCE7] border border-[#86EFAC] px-2 py-1 text-xs font-medium text-[#15803D]">
                            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                          </a>
                        )}
                        {k.email && (
                          <a href={`mailto:${k.email}`} className="inline-flex items-center gap-1 rounded-md bg-white border px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                            <AtSign className="h-3.5 w-3.5" /> {k.email}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-6">
              {p.lat && (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden h-56">
                  <MapContainer center={[p.lat, p.lng]} zoom={14} scrollWheelZoom={false} className="h-full w-full">
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                    <CircleMarker center={[p.lat, p.lng]} radius={10} pathOptions={{ color: "#065F46", fillColor: "#10B981", fillOpacity: 0.8 }} />
                  </MapContainer>
                </div>
              )}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="font-bold text-slate-900">Skor prioritas: {p.score}</p>
                <p className="text-xs text-slate-500 mb-3">Dihitung dari data yang tersedia</p>
                {p.breakdown?.map((b) => (
                  <div key={b.faktor} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                    <span className="text-slate-600">{b.faktor}</span>
                    <span className={`font-mono font-bold ${b.skor ? "text-[#065F46]" : "text-slate-300"}`}>+{b.skor}/{b.maks}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <p className="font-bold text-slate-900">Status data</p>
                <Info label="Sumber">{p.sumber?.nama}</Info>
                <Info label="Waktu pengambilan terakhir">{fmtDateTime(p.sumber?.fetched_at)}</Info>
                <Info label="Pertama dipantau">{fmtDateTime(p.first_seen_at)}{p.baseline ? " (data awal)" : ""}</Info>
                <Info label="Tanggal input di Sikumbang">{fmtDateTime(p.tanggal_input_sumber)}</Info>
                <Info label="Perubahan terakhir">{fmtDateTime(p.last_changed_at)}</Info>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="unit">
          <div className="grid lg:grid-cols-3 gap-6 [&>*]:min-w-0">
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b font-bold text-slate-900">Tipe rumah & harga</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2">Tipe</th><th className="text-left px-3 py-2">Status</th>
                      <th className="text-right px-3 py-2">LB/LT (m²)</th><th className="text-right px-3 py-2">KT/KM</th>
                      <th className="text-right px-4 py-2">Harga</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(p.tipe_rumah || []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Tipe/harga tidak ditampilkan di Sikumbang</td></tr>}
                    {(p.tipe_rumah || []).map((t, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-4 py-2 font-semibold">{t.nama}</td>
                        <td className="px-3 py-2 capitalize">{t.status}</td>
                        <td className="px-3 py-2 text-right">{t.luas_bangunan ?? "-"}/{t.luas_tanah ?? "-"}</td>
                        <td className="px-3 py-2 text-right">{t.kamar_tidur ?? "-"}/{t.kamar_mandi ?? "-"}</td>
                        <td className="px-4 py-2 text-right font-mono">{rupiah(t.harga)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="font-bold text-slate-900">Status unit</p>
                <Button size="sm" variant="outline" disabled={busy === "units"} onClick={() => doAction("units", () => api.post(`/perumahan/${enc}/refresh-units`), "Status unit diperbarui dari Sikumbang")} data-testid="refresh-units-btn">
                  <RefreshCw className={`h-4 w-4 mr-1.5 ${busy === "units" ? "animate-spin" : ""}`} /> Muat dari Sikumbang
                </Button>
              </div>
              {!p.unit_status && <p className="text-sm text-slate-400">Belum dimuat. Klik tombol untuk mengambil ringkasan status unit (tanpa data pribadi).</p>}
              {p.unit_status && (
                <div className="grid grid-cols-2 gap-3" data-testid="unit-status">
                  {[["total", "Total unit terdata"], ["tersedia", "Tersedia"], ["terjual", "Terjual"], ["booking", "Dibooking"], ["ready_stock", "Ready stock"], ["pembangunan", "Pembangunan"], ["subsidi", "Subsidi"], ["komersil", "Komersil"]].map(([k, l]) => (
                    <div key={k} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xl font-extrabold text-slate-900">{p.unit_status[k] ?? 0}</p>
                      <p className="text-[11px] text-slate-500">{l}</p>
                    </div>
                  ))}
                  <p className="col-span-2 text-[11px] text-slate-400">Diambil {fmtDateTime(p.unit_status.fetched_at)}</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="riwayat">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            {(p.perubahan || []).length === 0 && <p className="p-8 text-center text-sm text-slate-400">Belum ada perubahan terdeteksi sejak data ini dipantau</p>}
            {(p.perubahan || []).map((c) => (
              <div key={c.id} className="px-5 py-3 border-b last:border-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <span className="text-xs text-slate-400 w-44 shrink-0">{fmtDateTime(c.detected_at)}</span>
                <span className="text-sm font-semibold text-slate-800">{c.label}</span>
                <span className="text-sm text-slate-600 break-all">
                  <span className="line-through text-slate-400">{c.old}</span> → <span className="font-semibold text-[#C2410C]">{c.new}</span>
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="crm">
          <div className="grid lg:grid-cols-3 gap-6 [&>*]:min-w-0">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <div>
                  <Label className="text-xs">Review lead</Label>
                  <Select value={p.review_status || "BELUM_REVIEW"} onValueChange={(v) => doAction("review", () => api.put(`/perumahan/${enc}/review`, { review_status: v }), "Status review diperbarui")}>
                    <SelectTrigger className="mt-1" data-testid="review-select"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(REVIEW_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-400 mt-1">“Layak Dihubungi” otomatis memasukkan lead ke CRM.</p>
                </div>
                <div>
                  <Label className="text-xs">Tahap CRM</Label>
                  <Select value={p.crm_status || "NONE"} onValueChange={(v) => doAction("crm", () => api.put(`/perumahan/${enc}/crm`, { crm_status: v === "NONE" ? null : v }), "Tahap CRM diperbarui")}>
                    <SelectTrigger className="mt-1" data-testid="crm-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Belum masuk CRM</SelectItem>
                      {CRM_STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Follow-up berikutnya</Label>
                  <Input type="date" className="mt-1" value={p.next_followup || ""} onChange={(e) => doAction("fu", () => api.put(`/perumahan/${enc}/followup`, { tanggal: e.target.value || null }), "Tanggal follow-up disimpan")} data-testid="followup-date" />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <p className="font-bold text-slate-900">Catat aktivitas</p>
                <Select value={act.tipe} onValueChange={(v) => setAct({ ...act, tipe: v })}>
                  <SelectTrigger data-testid="act-tipe"><SelectValue /></SelectTrigger>
                  <SelectContent>{AKTIVITAS_TIPE.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Kontak person (opsional)" value={act.kontak_person} onChange={(e) => setAct({ ...act, kontak_person: e.target.value })} data-testid="act-kontak" />
                <Textarea placeholder="Catatan komunikasi / meeting / proposal…" value={act.catatan} onChange={(e) => setAct({ ...act, catatan: e.target.value })} data-testid="act-catatan" />
                <Input placeholder="Hasil (opsional)" value={act.hasil} onChange={(e) => setAct({ ...act, hasil: e.target.value })} data-testid="act-hasil" />
                <div>
                  <Label className="text-xs">Jadwalkan follow-up (opsional)</Label>
                  <Input type="date" className="mt-1" value={act.tanggal_followup} onChange={(e) => setAct({ ...act, tanggal_followup: e.target.value })} data-testid="act-followup" />
                </div>
                <Button onClick={submitAct} disabled={busy === "act"} className="w-full bg-[#065F46] hover:bg-[#064E3B]" data-testid="act-submit">
                  <Plus className="h-4 w-4 mr-1.5" /> Simpan aktivitas
                </Button>
              </div>
            </div>
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5">
              <p className="font-bold text-slate-900 mb-4">Riwayat aktivitas</p>
              {(p.aktivitas || []).length === 0 && <p className="text-sm text-slate-400">Belum ada aktivitas</p>}
              <ol className="relative border-l border-slate-200 ml-2 space-y-4" data-testid="aktivitas-list">
                {(p.aktivitas || []).map((a) => (
                  <li key={a.id} className="ml-4">
                    <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-[#065F46] border-2 border-white" />
                    <p className="text-[11px] text-slate-400 flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDateTime(a.created_at)} · {a.oleh}</p>
                    <p className="text-sm text-slate-800"><span className="font-semibold capitalize">{a.tipe}</span>: {a.catatan}</p>
                    {(a.kontak_person || a.hasil || a.tanggal_followup) && (
                      <p className="text-xs text-slate-500">
                        {a.kontak_person && `Kontak: ${a.kontak_person} `}{a.hasil && `· Hasil: ${a.hasil} `}{a.tanggal_followup && `· Follow-up ${fmtDate(a.tanggal_followup)}`}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="finance">
          <FinancePanel pid={p.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

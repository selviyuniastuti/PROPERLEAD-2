import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import AddToPlanButton from "@/components/AddToPlanButton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PRIORITY_META, DETEKSI_META, mapsHref, rupiahShort, titleCase } from "@/lib/meta";

const ALL = "__all";

export default function MapPage() {
  const [points, setPoints] = useState([]);
  const [targetOnly, setTargetOnly] = useState(true);
  const [prio, setPrio] = useState("");
  const [deteksi, setDeteksi] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/perumahan/map", { params: { target_only: targetOnly, prioritas: prio || undefined, deteksi: deteksi || undefined } })
      .then(({ data }) => setPoints(data))
      .catch((e) => toast.error(apiErr(e)));
  }, [targetOnly, prio, deteksi]);

  const color = (p) => (p.deteksi ? DETEKSI_META[p.deteksi].color : PRIORITY_META[p.prioritas]?.color || "#64748B");

  return (
    <div className="fade-up" data-testid="map-page">
      <PageHeader title="Peta Perumahan" subtitle={`${points.length.toLocaleString("id-ID")} titik perumahan dari koordinat Sikumbang`}>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Switch checked={targetOnly} onCheckedChange={setTargetOnly} data-testid="map-target-toggle" /> Wilayah target
        </label>
        <Select value={prio || ALL} onValueChange={(v) => setPrio(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[150px] bg-white" data-testid="map-prio"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua prioritas</SelectItem>
            {["A", "B", "C"].map((x) => <SelectItem key={x} value={x}>Prioritas {x}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={deteksi || ALL} onValueChange={(v) => setDeteksi(v === ALL ? "" : v)}>
          <SelectTrigger className="w-[170px] bg-white" data-testid="map-deteksi"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua status</SelectItem>
            <SelectItem value="NEW_LISTING">Listing Baru</SelectItem>
            <SelectItem value="DATA_UPDATED">Data Berubah</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>
      <div className="flex flex-wrap gap-4 mb-3 text-xs text-slate-600">
        {[["#10B981", "Listing baru"], ["#F97316", "Data berubah"], ["#DC2626", "Prioritas A"], ["#D97706", "Prioritas B"], ["#64748B", "Prioritas C"]].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: c }} />{l}</span>
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden h-[calc(100vh-260px)] min-h-[420px]">
        <MapContainer center={[-3.35, 114.8]} zoom={9} preferCanvas className="h-full w-full">
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {points.map((p) => (
            <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={p.deteksi ? 8 : 5} pathOptions={{ color: "#fff", weight: 1, fillColor: color(p), fillOpacity: 0.85 }}>
              <Popup>
                <div className="space-y-1 min-w-[220px]">
                  <p className="font-bold text-slate-900">{p.nama}</p>
                  <p className="text-xs text-slate-500">{p.pengembang?.nama}</p>
                  <p className="text-xs text-slate-500">{titleCase(p.wilayah?.kecamatan)}, {titleCase(p.wilayah?.kabupaten)}</p>
                  <p className="text-xs">{p.jumlah_unit} unit · {rupiahShort(p.harga_min)} · Prioritas {p.prioritas} ({p.score})</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/perumahan/${encodeURIComponent(p.id)}`)}>Detail</Button>
                    <a href={mapsHref(p)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">Maps</Button></a>
                    <AddToPlanButton perumahanId={p.id} label="Rencana" />
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

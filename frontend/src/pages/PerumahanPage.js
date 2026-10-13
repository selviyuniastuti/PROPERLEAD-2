import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Download, MapPin, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import api, { API, apiErr } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { DeteksiBadge, PriorityBadge, ReviewBadge, StageBadge } from "@/components/Badges";
import AddToPlanButton from "@/components/AddToPlanButton";
import { ListingRow } from "@/pages/Dashboard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CRM_STAGES, REVIEW_META, mapsHref, rupiahShort, titleCase, fmtDate } from "@/lib/meta";

const ALL = "__all";

function FilterSelect({ value, onChange, placeholder, options, testid, width = "w-[170px]" }) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger className={`${width} bg-white`} data-testid={testid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function PerumahanPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const [wilayah, setWilayah] = useState([]);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp.get("q") || "");

  const params = useMemo(
    () => ({
      q: sp.get("q") || "",
      kab: sp.get("kab") || "",
      deteksi: sp.get("deteksi") || "",
      prioritas: sp.get("prioritas") || "",
      review: sp.get("review") || "",
      crm: sp.get("crm") || "",
      target_only: sp.get("target_only") === "1",
      sort: sp.get("sort") || "skor",
      page: parseInt(sp.get("page") || "1", 10),
    }),
    [sp]
  );

  const setParam = (k, v) => {
    const n = new URLSearchParams(sp);
    if (v === "" || v === false || v === null || v === undefined) n.delete(k);
    else n.set(k, v === true ? "1" : v);
    if (k !== "page") n.delete("page");
    setSp(n);
  };

  useEffect(() => {
    api.get("/wilayah").then(({ data }) => setWilayah(data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const p = { ...params, limit: 25 };
    Object.keys(p).forEach((k) => (p[k] === "" || p[k] === false) && delete p[k]);
    api
      .get("/perumahan", { params: p })
      .then(({ data }) => setData(data))
      .catch((e) => toast.error(apiErr(e)))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") || "") !== q) setParam("q", q.trim());
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const exportUrl = useMemo(() => {
    const u = new URLSearchParams();
    ["q", "kab", "deteksi", "prioritas", "review", "crm"].forEach((k) => params[k] && u.set(k, params[k]));
    if (params.target_only) u.set("target_only", "true");
    return `${API}/reports/export/perumahan.csv?${u.toString()}`;
  }, [params]);

  const open = (id) => navigate(`/perumahan/${encodeURIComponent(id)}`);
  const hasFilter = ["q", "kab", "deteksi", "prioritas", "review", "crm", "target_only"].some((k) => sp.get(k));

  return (
    <div className="fade-up" data-testid="perumahan-page">
      <PageHeader title="Daftar Perumahan" subtitle={`${data.total.toLocaleString("id-ID")} perumahan · Kalimantan Selatan · sumber Sikumbang`}>
        <a href={exportUrl} data-testid="export-csv-btn">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" /> Ekspor CSV
          </Button>
        </a>
      </PageHeader>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama perumahan, developer, ID lokasi, kecamatan…"
            className="pl-9"
            data-testid="search-input"
          />
        </div>
        <FilterSelect
          value={params.kab}
          onChange={(v) => setParam("kab", v)}
          placeholder="Semua wilayah"
          testid="filter-kab"
          width="w-[200px]"
          options={wilayah.map((w) => ({ value: w.kode, label: `${titleCase(w.nama)} (${w.jumlah_perumahan})${w.target ? " ★" : ""}` }))}
        />
        <FilterSelect
          value={params.deteksi}
          onChange={(v) => setParam("deteksi", v)}
          placeholder="Semua status data"
          testid="filter-deteksi"
          options={[
            { value: "NEW_LISTING", label: "Listing Baru" },
            { value: "DATA_UPDATED", label: "Data Berubah" },
          ]}
        />
        <FilterSelect
          value={params.prioritas}
          onChange={(v) => setParam("prioritas", v)}
          placeholder="Semua prioritas"
          testid="filter-prioritas"
          width="w-[150px]"
          options={["A", "B", "C"].map((x) => ({ value: x, label: `Prioritas ${x}` }))}
        />
        <FilterSelect
          value={params.review}
          onChange={(v) => setParam("review", v)}
          placeholder="Semua review"
          testid="filter-review"
          options={Object.entries(REVIEW_META).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <FilterSelect
          value={params.crm}
          onChange={(v) => setParam("crm", v)}
          placeholder="Semua tahap CRM"
          testid="filter-crm"
          options={[{ value: "ANY", label: "Sudah masuk CRM" }, ...CRM_STAGES.map((s) => ({ value: s.key, label: s.label }))]}
        />
        <FilterSelect
          value={params.sort === "skor" ? "" : params.sort}
          onChange={(v) => setParam("sort", v)}
          placeholder="Urut: skor tertinggi"
          testid="filter-sort"
          options={[
            { value: "sumber_terbaru", label: "Urut: input Sikumbang terbaru" },
            { value: "terbaru", label: "Urut: terdeteksi terbaru" },
            { value: "berubah", label: "Urut: perubahan terbaru" },
            { value: "unit", label: "Urut: unit terbanyak" },
            { value: "nama", label: "Urut: nama A-Z" },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Switch checked={params.target_only} onCheckedChange={(v) => setParam("target_only", v)} data-testid="filter-target" />
          Wilayah target
        </label>
        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setSp(new URLSearchParams()); }} data-testid="reset-filter-btn">
            <X className="h-4 w-4 mr-1" /> Reset
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading && <p className="p-6 text-sm text-slate-400">Memuat…</p>}
        {!loading && data.items.length === 0 && <p className="p-10 text-center text-sm text-slate-400">Tidak ada perumahan sesuai filter</p>}
        {!loading && data.items.length > 0 && (
          <>
            <div className="md:hidden">
              {data.items.map((p) => <ListingRow key={p.id} p={p} onOpen={open} />)}
            </div>
            <div className="hidden md:block overflow-x-auto brand-scroll">
              <table className="w-full text-sm" data-testid="perumahan-table">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-3">Perumahan</th>
                    <th className="text-left px-3 py-3">Lokasi</th>
                    <th className="text-right px-3 py-3">Unit</th>
                    <th className="text-right px-3 py-3">Harga mulai</th>
                    <th className="text-left px-3 py-3">Status data</th>
                    <th className="text-left px-3 py-3">Prioritas</th>
                    <th className="text-left px-3 py-3">Tindak lanjut</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => open(p.id)} data-testid={`perumahan-row-${p.id}`}>
                      <td className="px-4 py-3 max-w-[320px]">
                        <p className="font-semibold text-slate-900 truncate">{p.nama}</p>
                        <p className="text-xs text-slate-500 truncate">{p.pengembang?.nama || "-"}</p>
                        <p className="text-[10px] font-mono text-slate-400">{p.id}</p>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        <p>{titleCase(p.wilayah?.kecamatan)}</p>
                        <p className="text-slate-400">{titleCase(p.wilayah?.kabupaten)}</p>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{p.jumlah_unit}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">{rupiahShort(p.harga_min)}</td>
                      <td className="px-3 py-3">
                        {p.deteksi ? <DeteksiBadge value={p.deteksi} /> : <span className="text-[11px] text-slate-400">Input {fmtDate(p.tanggal_input_sumber)}</span>}
                        {p.delisted && <p className="text-[10px] text-red-600 mt-1">Tidak tampil di Sikumbang</p>}
                      </td>
                      <td className="px-3 py-3"><PriorityBadge value={p.prioritas} score={p.score} /></td>
                      <td className="px-3 py-3 space-y-1">
                        <ReviewBadge value={p.review_status} />
                        {p.crm_status && <div><StageBadge value={p.crm_status} /></div>}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 justify-end">
                          <a href={mapsHref(p)} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border px-2 py-1.5 text-xs text-[#1A73E8] hover:bg-blue-50">
                            <MapPin className="h-3.5 w-3.5" />
                          </a>
                          <AddToPlanButton perumahanId={p.id} label="Rencana" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
          <span className="text-slate-500">Halaman {params.page} dari {data.pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={params.page <= 1} onClick={() => setParam("page", String(params.page - 1))} data-testid="prev-page-btn">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={params.page >= data.pages} onClick={() => setParam("page", String(params.page + 1))} data-testid="next-page-btn">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

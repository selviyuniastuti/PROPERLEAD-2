export const LOGO_URL =
  "https://customer-assets-4nw71qhi.emergentagent.net/job_d5229e27-27f0-4c5c-b851-9cce3eb9a31b/artifacts/3dewn6za_Gemini_Generated_Image_eyfskfeyfskfeyfs.jpg";

export const DETEKSI_META = {
  NEW_LISTING: {
    label: "Listing Baru",
    badge: "bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]",
    dot: "bg-[#10B981]",
    color: "#10B981",
  },
  DATA_UPDATED: {
    label: "Data Berubah",
    badge: "bg-[#FFEDD5] text-[#C2410C] border-[#FDBA74]",
    dot: "bg-[#F97316]",
    color: "#F97316",
  },
};

export const REVIEW_META = {
  BELUM_REVIEW: { label: "Belum Review", badge: "bg-slate-100 text-slate-600 border-slate-200" },
  REVIEW: { label: "Sedang Review", badge: "bg-[#DBEAFE] text-[#1D4ED8] border-[#93C5FD]" },
  LAYAK: { label: "Layak Dihubungi", badge: "bg-[#D1FAE5] text-[#065F46] border-[#6EE7B7]" },
  TIDAK_LAYAK: { label: "Tidak Layak", badge: "bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]" },
};

export const PRIORITY_META = {
  A: { label: "Prioritas A", badge: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]", color: "#DC2626" },
  B: { label: "Prioritas B", badge: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]", color: "#D97706" },
  C: { label: "Prioritas C", badge: "bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]", color: "#64748B" },
};

export const CRM_STAGES = [
  { key: "NEW", label: "Baru", color: "#64748B" },
  { key: "DIHUBUNGI", label: "Sudah Dihubungi", color: "#0EA5E9" },
  { key: "RESPON", label: "Respon", color: "#8B5CF6" },
  { key: "MEETING", label: "Meeting", color: "#D97706" },
  { key: "PROPOSAL", label: "Proposal", color: "#F97316" },
  { key: "KERJASAMA", label: "Kerjasama", color: "#065F46" },
];

export const AKTIVITAS_TIPE = [
  { key: "catatan", label: "Catatan" },
  { key: "telepon", label: "Telepon" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email" },
  { key: "kunjungan", label: "Kunjungan" },
  { key: "meeting", label: "Meeting" },
  { key: "proposal", label: "Proposal" },
];

export const stageMeta = (key) => CRM_STAGES.find((s) => s.key === key) || CRM_STAGES[0];

export function fmtDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function fmtDateTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Makassar",
    }) + " WITA";
  } catch {
    return iso;
  }
}

export function rupiah(v) {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "-";
  const n = Math.round(Number(v));
  return (n < 0 ? "-Rp" : "Rp") + Math.abs(n).toLocaleString("id-ID");
}

export function rupiahShort(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  const n = Number(v);
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e12) return `${s}Rp${(a / 1e12).toLocaleString("id-ID", { maximumFractionDigits: 2 })} T`;
  if (a >= 1e9) return `${s}Rp${(a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${s}Rp${(a / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `${s}Rp${a.toLocaleString("id-ID")}`;
}

export function titleCase(s) {
  if (!s) return "-";
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^Kab\b/, "Kab.");
}

export function todayWita() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Makassar" });
}

export function waLink(num) {
  if (!num) return null;
  let d = String(num).replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  return d ? `https://wa.me/${d}` : null;
}

export function telList(s) {
  if (!s) return [];
  return String(s)
    .split(/[\s,/;]+/)
    .map((x) => x.trim())
    .filter((x) => x.replace(/\D/g, "").length >= 6);
}

const BACKEND = process.env.REACT_APP_BACKEND_URL;
export function mapsHref(p) {
  if (p?.lat && p?.lng) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return `${BACKEND}/api/go/maps/${encodeURIComponent(p?.id || "")}`;
}

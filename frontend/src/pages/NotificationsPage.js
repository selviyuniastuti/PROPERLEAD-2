import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DETEKSI_META, fmtDateTime } from "@/lib/meta";

export default function NotificationsPage() {
  const [data, setData] = useState({ items: [], unread: 0 });
  const navigate = useNavigate();
  const { reloadNotif } = useOutletContext() || {};
  const { user, refresh } = useAuth();

  const load = () => api.get("/notifications", { params: { limit: 100 } }).then(({ data }) => setData(data)).catch((e) => toast.error(apiErr(e)));
  useEffect(() => {
    load();
  }, []);

  const openItem = async (n) => {
    await api.put(`/notifications/${n.id}/read`);
    reloadNotif?.();
    if (n.perumahan_id) navigate(`/perumahan/${encodeURIComponent(n.perumahan_id)}`);
  };
  const markAll = async () => {
    await api.put("/notifications/read-all");
    load();
    reloadNotif?.();
  };
  const toggleEmail = async (v) => {
    try {
      await api.put("/auth/me/prefs", { email_alert: v });
      await refresh();
      toast.success(v ? "Notifikasi Gmail diaktifkan" : "Notifikasi Gmail dinonaktifkan");
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  return (
    <div className="fade-up" data-testid="notifications-page">
      <PageHeader title="Notifikasi" subtitle={`${data.unread} belum dibaca · listing baru & perubahan data dari Sikumbang`}>
        <Button variant="outline" onClick={markAll} data-testid="notif-mark-all">Tandai semua dibaca</Button>
      </PageHeader>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#FEF2F2] flex items-center justify-center"><Mail className="h-5 w-5 text-[#DC2626]" /></div>
        <div className="flex-1">
          <p className="font-semibold text-slate-900">Notifikasi Gmail ke {user?.email}</p>
          <p className="text-xs text-slate-500">
            Email otomatis saat listing baru terdeteksi di wilayah Anda — berisi detail perumahan, tombol Google Maps, Rencana Kunjungan, dan Google Kalender. Ringkasan harian dikirim 07:30 WITA.
          </p>
        </div>
        <Switch checked={user?.email_alert !== false} onCheckedChange={toggleEmail} data-testid="email-alert-toggle" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {data.items.length === 0 && <p className="p-10 text-center text-sm text-slate-400">Belum ada notifikasi. Notifikasi muncul saat collector menemukan listing baru atau perubahan data.</p>}
        {data.items.map((n) => {
          const m = DETEKSI_META[n.kind] || DETEKSI_META.NEW_LISTING;
          return (
            <button key={n.id} onClick={() => openItem(n)} className={`w-full text-left px-5 py-4 border-b last:border-0 hover:bg-slate-50 flex gap-3 ${n.read ? "opacity-60" : ""}`} data-testid={`notif-${n.id}`}>
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${m.dot}`} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{n.judul}</p>
                <p className="text-xs text-slate-500">{n.pesan}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{m.label} · {fmtDateTime(n.created_at)}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

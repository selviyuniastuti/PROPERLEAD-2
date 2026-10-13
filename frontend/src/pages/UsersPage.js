import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { titleCase } from "@/lib/meta";

const EMPTY = { name: "", email: "", password: "", role: "user", regions: [], email_alert: true, active: true };

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [wil, setWil] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/users").then(({ data }) => setUsers(data)).catch((e) => toast.error(apiErr(e)));
  useEffect(() => {
    load();
    api.get("/wilayah").then(({ data }) => setWil(data));
  }, []);

  const kabName = (k) => titleCase(wil.find((w) => w.kode === k)?.nama || k);

  const save = async () => {
    setSaving(true);
    try {
      if (form.id) {
        const body = { name: form.name, role: form.role, regions: form.regions, email_alert: form.email_alert, active: form.active };
        if (form.password) body.password = form.password;
        await api.put(`/users/${form.id}`, body);
      } else {
        await api.post("/users", { name: form.name, email: form.email, password: form.password, role: form.role, regions: form.regions, email_alert: form.email_alert });
      }
      toast.success("User disimpan");
      setForm(null);
      load();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async (u) => {
    if (!window.confirm(`Hapus user ${u.email}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("User dihapus");
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const toggleRegion = (k) =>
    setForm((f) => ({ ...f, regions: f.regions.includes(k) ? f.regions.filter((x) => x !== k) : [...f.regions, k] }));

  return (
    <div className="fade-up" data-testid="users-page">
      <PageHeader title="Manajemen User" subtitle="Atur akses, wilayah notifikasi, dan notifikasi Gmail tiap marketing">
        <Button onClick={() => setForm({ ...EMPTY })} className="bg-[#065F46] hover:bg-[#064E3B]" data-testid="add-user-btn"><Plus className="h-4 w-4 mr-2" /> Tambah User</Button>
      </PageHeader>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm" data-testid="users-table">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">User</th><th className="text-left px-3 py-3">Peran</th>
              <th className="text-left px-3 py-3">Wilayah notifikasi</th><th className="text-left px-3 py-3">Gmail</th>
              <th className="text-left px-3 py-3">Status</th><th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-4 py-3"><p className="font-semibold">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                <td className="px-3 py-3">{u.role === "super_admin" ? "Super Admin" : "Marketing"}</td>
                <td className="px-3 py-3 text-xs text-slate-600 max-w-[280px]">{u.regions?.length ? u.regions.map(kabName).join(", ") : "Mengikuti wilayah target"}</td>
                <td className="px-3 py-3 text-xs">{u.email_alert ? <span className="text-[#065F46] font-semibold">Aktif</span> : <span className="text-slate-400">Nonaktif</span>}</td>
                <td className="px-3 py-3 text-xs">{u.active ? "Aktif" : <span className="text-red-600">Nonaktif</span>}</td>
                <td className="px-3 py-3">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setForm({ ...EMPTY, ...u, password: "" })} data-testid={`edit-user-${u.email}`}><Pencil className="h-4 w-4" /></Button>
                    {u.id !== me?.id && <Button size="sm" variant="ghost" className="text-red-500" onClick={() => del(u)}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="user-dialog">
          <DialogHeader><DialogTitle>{form?.id ? "Edit User" : "Tambah User"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div><Label>Nama</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="user-name" /></div>
              <div><Label>Email (Gmail untuk notifikasi)</Label><Input type="email" disabled={!!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="user-email" /></div>
              <div><Label>{form.id ? "Password baru (opsional)" : "Password"}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-password" /></div>
              <div>
                <Label>Peran</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="user-role"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="user">Marketing</SelectItem><SelectItem value="super_admin">Super Admin</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label>Wilayah notifikasi</Label>
                <p className="text-[11px] text-slate-400 mb-1">Kosongkan untuk mengikuti wilayah target global</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {wil.map((w) => (
                    <label key={w.kode} className="flex items-center gap-2 text-xs text-slate-700">
                      <Checkbox checked={form.regions.includes(w.kode)} onCheckedChange={() => toggleRegion(w.kode)} /> {titleCase(w.nama)}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between text-sm">Notifikasi Gmail <Switch checked={form.email_alert} onCheckedChange={(v) => setForm({ ...form, email_alert: v })} /></label>
              {form.id && <label className="flex items-center justify-between text-sm">Akun aktif <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></label>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Batal</Button>
            <Button onClick={save} disabled={saving} className="bg-[#065F46] hover:bg-[#064E3B]" data-testid="user-save">Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

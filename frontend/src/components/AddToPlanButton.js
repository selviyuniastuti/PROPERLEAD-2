import { useState } from "react";
import { CalendarPlus, Check } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import api, { apiErr } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function AddToPlanButton({ perumahanId, size = "sm", variant = "outline", label = "Rencana Hari Ini", className = "" }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const add = async (e) => {
    e?.stopPropagation?.();
    setBusy(true);
    try {
      const { data } = await api.post("/plans/today/add", { perumahan_id: perumahanId });
      setDone(true);
      toast.success(data.already ? "Sudah ada di rencana kunjungan hari ini" : "Ditambahkan ke rencana kunjungan hari ini", {
        action: { label: "Buka", onClick: () => navigate("/rencana") },
      });
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size={size}
      variant={variant}
      onClick={add}
      disabled={busy}
      className={className}
      data-testid={`add-to-plan-${perumahanId}`}
    >
      {done ? <Check className="h-4 w-4 mr-1.5 text-[#065F46]" /> : <CalendarPlus className="h-4 w-4 mr-1.5" />}
      {label}
    </Button>
  );
}

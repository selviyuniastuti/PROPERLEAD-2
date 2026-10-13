"""Project Finance — simulasi sederhana berbasis data listing + input pengguna.
Angka hasil adalah SIMULASI, bukan dasar persetujuan kredit."""
import math
from typing import Optional
from pydantic import BaseModel, Field


class FinanceInput(BaseModel):
    jumlah_unit: int = Field(0, ge=0, le=100000)
    harga_jual_per_unit: float = Field(0, ge=0)
    biaya_tanah: float = Field(0, ge=0)
    biaya_konstruksi_per_unit: float = Field(0, ge=0)
    biaya_infrastruktur: float = Field(0, ge=0)
    biaya_perizinan: float = Field(0, ge=0)
    biaya_pemasaran_pct: float = Field(2.0, ge=0, le=100)
    biaya_overhead_per_bulan: float = Field(0, ge=0)
    biaya_lain: float = Field(0, ge=0)
    durasi_konstruksi_bulan: int = Field(12, ge=1, le=120)
    mulai_jual_bulan: int = Field(3, ge=1, le=120)
    unit_terjual_per_bulan: float = Field(5, gt=0, le=10000)
    modal_sendiri: float = Field(0, ge=0)
    bunga_pct_tahun: float = Field(11.0, ge=0, le=100)
    porsi_kredit_maks_pct: float = Field(70.0, ge=0, le=100)
    catatan: Optional[str] = None


def calculate(i: FinanceInput) -> dict:
    units = i.jumlah_unit
    potensi = units * i.harga_jual_per_unit
    konstruksi_total = units * i.biaya_konstruksi_per_unit
    sell_months = math.ceil(units / i.unit_terjual_per_bulan) if units else 0
    n = min(max(i.durasi_konstruksi_bulan, (i.mulai_jual_bulan - 1 + sell_months) if units else 0, 1), 120)
    infra_months = max(1, math.ceil(i.durasi_konstruksi_bulan / 2))

    remaining = units
    cum = 0.0
    min_pos = 0.0
    min_cum = 0.0
    bunga = 0.0
    breakeven = None
    was_negative = False
    total_marketing = 0.0
    total_overhead = 0.0
    rows = []
    for m in range(1, n + 1):
        cost = 0.0
        if m == 1:
            cost += i.biaya_tanah + i.biaya_perizinan + i.biaya_lain
        if m <= infra_months:
            cost += i.biaya_infrastruktur / infra_months
        if m <= i.durasi_konstruksi_bulan:
            cost += konstruksi_total / i.durasi_konstruksi_bulan
        cost += i.biaya_overhead_per_bulan
        total_overhead += i.biaya_overhead_per_bulan
        sold = 0.0
        if m >= i.mulai_jual_bulan and remaining > 0:
            sold = min(i.unit_terjual_per_bulan, remaining)
            remaining -= sold
        revenue = sold * i.harga_jual_per_unit
        marketing = revenue * i.biaya_pemasaran_pct / 100
        total_marketing += marketing
        net = revenue - cost - marketing
        # bunga atas posisi defisit di luar modal sendiri (bulan sebelumnya)
        gap_prev = max(0.0, -(i.modal_sendiri + cum))
        interest = gap_prev * i.bunga_pct_tahun / 100 / 12
        bunga += interest
        cum += net
        pos = i.modal_sendiri + cum
        min_pos = min(min_pos, pos)
        min_cum = min(min_cum, cum)
        if cum < 0:
            was_negative = True
        if was_negative and breakeven is None and cum >= 0:
            breakeven = m
        rows.append({"bulan": m, "unit_terjual": round(sold, 2), "pendapatan": round(revenue),
                     "biaya": round(cost + marketing), "arus_kas_bersih": round(net),
                     "kumulatif": round(cum), "bunga": round(interest)})

    total_biaya = i.biaya_tanah + konstruksi_total + i.biaya_infrastruktur + i.biaya_perizinan + \
        total_marketing + total_overhead + i.biaya_lain
    selisih = potensi - total_biaya
    kebutuhan = max(0.0, -min_pos)
    batas = total_biaya * i.porsi_kredit_maks_pct / 100
    return {
        "potensi_penjualan": round(potensi),
        "biaya_konstruksi_total": round(konstruksi_total),
        "biaya_pemasaran_total": round(total_marketing),
        "biaya_overhead_total": round(total_overhead),
        "total_biaya": round(total_biaya),
        "selisih_penjualan_biaya": round(selisih),
        "margin_pct": round(selisih / potensi * 100, 2) if potensi else 0,
        "puncak_defisit_kas": round(-min_cum),
        "kebutuhan_pembiayaan": round(kebutuhan),
        "batas_porsi_kredit": round(batas),
        "melebihi_porsi_kredit": kebutuhan > batas if kebutuhan else False,
        "estimasi_bunga": round(bunga),
        "selisih_setelah_bunga": round(selisih - bunga),
        "bulan_balik_kas": breakeven,
        "durasi_bulan": n,
        "cashflow": rows,
    }


def illustrative_defaults(p: dict) -> dict:
    """Asumsi CONTOH untuk memulai simulasi — wajib disesuaikan dengan data developer."""
    units = p.get("jumlah_unit") or 0
    tipe = [t for t in p.get("tipe_rumah") or [] if t.get("harga")]
    harga = round(sum(t["harga"] for t in tipe) / len(tipe)) if tipe else 0
    lb = [t.get("luas_bangunan") for t in tipe if t.get("luas_bangunan")]
    avg_lb = sum(lb) / len(lb) if lb else 36
    return {
        "jumlah_unit": units,
        "harga_jual_per_unit": harga,
        "biaya_tanah": round(units * harga * 0.15),
        "biaya_konstruksi_per_unit": round(avg_lb * 3_000_000),
        "biaya_infrastruktur": round(units * harga * 0.08),
        "biaya_perizinan": round(units * harga * 0.02),
        "biaya_pemasaran_pct": 2.0,
        "biaya_overhead_per_bulan": 15_000_000,
        "biaya_lain": 0,
        "durasi_konstruksi_bulan": 12 if units <= 150 else 18,
        "mulai_jual_bulan": 3,
        "unit_terjual_per_bulan": max(1, round(units / 18)) if units else 5,
        "modal_sendiri": round(units * harga * 0.10),
        "bunga_pct_tahun": 11.0,
        "porsi_kredit_maks_pct": 70.0,
    }

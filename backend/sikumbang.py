"""Sikumbang collector + change detector + lead scoring.

Sumber: portal publik https://sikumbang.tapera.go.id (endpoint publik yang dipakai halaman
portal itu sendiri, tanpa login). Pengambilan dilakukan pelan (jeda antar halaman), dicatat
sumber + waktu pengambilan. Data pribadi (NIK pemilik/pemesan, NPWP perorangan) TIDAK disimpan.
"""
import asyncio
import math
import re
from datetime import timedelta, datetime
from typing import Optional

import httpx

from core import db, logger, now_iso, now_utc, new_id, target_kodes

BASE = "https://sikumbang.tapera.go.id"
PROVINSI_KODE = "63"  # Kalimantan Selatan
PAGE_LIMIT = 100
PAGE_DELAY = 1.5
HEADERS = {
    "User-Agent": "PROPERLEAD-Collector/1.0 (pengumpulan data publik terjadwal, pelan)",
    "Accept": "application/json",
}

_sync_lock = asyncio.Lock()

FIELD_LABELS = {
    "nama": "Nama perumahan",
    "jenis": "Jenis perumahan",
    "pengembang_nama": "Nama pengembang",
    "jumlah_unit": "Jumlah unit",
    "jumlah_unit_komersil": "Jumlah unit komersil",
    "aktivasi": "Status aktivasi listing",
    "kontak": "Kontak kantor pemasaran",
    "foto_count": "Jumlah foto",
    "koordinat": "Koordinat lokasi",
}


def source_url(id_lokasi: str) -> str:
    return f"{BASE}/lokasi-perumahan/{id_lokasi}"


# ---------------------------------------------------------------------------
# Normalisasi
# ---------------------------------------------------------------------------
def parse_coord(s) -> tuple:
    if not s or not isinstance(s, str):
        return None, None
    try:
        a, b = [float(x.strip()) for x in s.split(",")[:2]]
        if -6.0 < a < 0.5 and 113.0 < b < 118.0:
            return round(a, 6), round(b, 6)
    except Exception:
        pass
    return None, None


def _int(v):
    try:
        return int(v) if v is not None else None
    except Exception:
        return None


def normalize(item: dict, fetched_at: str) -> dict:
    wil = item.get("wilayah") or {}
    kode = str(wil.get("kodeWilayah") or "")
    lat, lng = parse_coord(item.get("koordinatPerumahan"))
    tipe = []
    for t in (item.get("tipeRumah") or []) + (item.get("tipeRusun") or []):
        if t.get("hide"):
            continue
        tipe.append({
            "nama": str(t.get("nama") or "-"),
            "status": t.get("status") or "-",
            "harga": _int(t.get("harga")),
            "luas_tanah": t.get("luasTanah"),
            "luas_bangunan": t.get("luasBangunan"),
            "kamar_tidur": t.get("kamarTidur"),
            "kamar_mandi": t.get("kamarMandi"),
            "jumlah_lantai": t.get("jumlahLantai"),
        })
    kantor = []
    for k in item.get("kantorPemasaran") or []:
        if k.get("hide"):
            continue
        kantor.append({
            "alamat": " ".join(x for x in [k.get("alamat") or "", (k.get("nomor") or "").strip("- ")] if x).strip(),
            "telp": (k.get("noTelp") or "").strip(),
            "wa": (k.get("noWhatsapp") or "").strip(),
            "email": (k.get("email") or "").strip(),
            "website": (k.get("website") or "").strip(),
            "kantor_utama": bool(k.get("kantorUtama")),
        })
    dates = [x.get("createdAt") for x in (item.get("tipeRumah") or []) + (item.get("kantorPemasaran") or [])
             if x.get("createdAt")]
    hargas = [t["harga"] for t in tipe if t["harga"]]
    m = re.search(r"(20\d{2})T\d+$", item.get("idLokasi") or "")
    peng = item.get("pengembang") or {}
    return {
        "id": item["idLokasi"],
        "nama": (item.get("namaPerumahan") or "").strip(),
        "jenis": item.get("jenisPerumahan") or "-",
        "pengembang": {"nama": (peng.get("nama") or "").strip(), "asosiasi": peng.get("asosiasi") or ""},
        "wilayah": {
            "provinsi": wil.get("provinsi"), "kabupaten": wil.get("kabupaten"),
            "kecamatan": wil.get("kecamatan"), "kelurahan": wil.get("kelurahan"), "kode": kode,
        },
        "kab_kode": kode[:4],
        "lat": lat, "lng": lng,
        "jumlah_unit": _int(item.get("jumlahUnit")) or 0,
        "jumlah_unit_komersil": _int(item.get("jumlahUnitKomersil")) or 0,
        "tipe_rumah": tipe,
        "harga_min": min(hargas) if hargas else None,
        "harga_max": max(hargas) if hargas else None,
        "kantor": kantor,
        "foto": [f for f in (item.get("foto") or []) if isinstance(f, str)][:6],
        "aktivasi": bool(item.get("aktivasi")),
        "tahun_registrasi": int(m.group(1)) if m else None,
        "tanggal_input_sumber": min(dates) if dates else None,
        "sumber": {"nama": "Sikumbang (sikumbang.tapera.go.id)", "url": source_url(item["idLokasi"]),
                   "fetched_at": fetched_at},
    }


def snapshot_of(n: dict) -> dict:
    return {
        "nama": n["nama"],
        "jenis": n["jenis"],
        "pengembang_nama": n["pengembang"]["nama"],
        "jumlah_unit": n["jumlah_unit"],
        "jumlah_unit_komersil": n["jumlah_unit_komersil"],
        "aktivasi": n["aktivasi"],
        "tipe": sorted([[t["nama"], t["status"], t["harga"]] for t in n["tipe_rumah"]], key=lambda x: (x[0], x[1], x[2] or 0)),
        "kontak": sorted({f"{k['telp']}|{k['wa']}|{k['email']}" for k in n["kantor"]}),
        "foto_count": len(n["foto"]),
        "koordinat": f"{n['lat']},{n['lng']}" if n["lat"] else None,
    }


def _fmt(v):
    if isinstance(v, list):
        return ", ".join(str(x) for x in v) if v else "-"
    if v is None:
        return "-"
    if isinstance(v, bool):
        return "Aktif" if v else "Nonaktif"
    return str(v)


def diff_snapshots(old: dict, new: dict) -> list:
    changes = []
    for f, label in FIELD_LABELS.items():
        if f in ("kontak",):
            if sorted(old.get(f) or []) != sorted(new.get(f) or []):
                changes.append({"field": f, "label": label, "old": "; ".join(old.get(f) or []) or "-",
                                "new": "; ".join(new.get(f) or []) or "-"})
            continue
        if old.get(f) != new.get(f):
            changes.append({"field": f, "label": label, "old": _fmt(old.get(f)), "new": _fmt(new.get(f))})
    # Tipe & harga
    o = {(t[0], t[1]): t[2] for t in old.get("tipe") or []}
    nw = {(t[0], t[1]): t[2] for t in new.get("tipe") or []}
    for key in sorted(set(o) | set(nw)):
        label = f"Tipe {key[0]} ({key[1]})"
        if key not in o:
            changes.append({"field": "tipe_baru", "label": f"{label} ditambahkan", "old": "-", "new": _fmt(nw[key])})
        elif key not in nw:
            changes.append({"field": "tipe_hapus", "label": f"{label} dihapus", "old": _fmt(o[key]), "new": "-"})
        elif o[key] != nw[key]:
            changes.append({"field": "harga", "label": f"Harga {label}", "old": _fmt(o[key]), "new": _fmt(nw[key])})
    return changes


# ---------------------------------------------------------------------------
# Lead scoring (berdasarkan data yang benar-benar tersedia)
# ---------------------------------------------------------------------------
def _days_since(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (now_utc() - dt).total_seconds() / 86400
    except Exception:
        return None


def compute_score(doc: dict, targets: set) -> dict:
    br = []

    def add(label, pts, ok):
        br.append({"faktor": label, "skor": pts if ok else 0, "maks": pts})

    add("Lokasi di wilayah target", 30, doc.get("kab_kode") in targets)
    d_first = _days_since(doc.get("first_seen_at")) if not doc.get("baseline") else None
    d_src = _days_since(doc.get("tanggal_input_sumber"))
    recent = (doc.get("deteksi") == "NEW_LISTING" and d_first is not None and d_first <= 30) or \
             (d_src is not None and d_src <= 60)
    add("Listing baru (≤60 hari di Sikumbang / baru terdeteksi)", 25, recent)
    units = doc.get("jumlah_unit") or 0
    unit_pts = 15 if units >= 100 else 10 if units >= 50 else 5 if units >= 20 else 0
    br.append({"faktor": f"Skala proyek ({units} unit)", "skor": unit_pts, "maks": 15})
    has_contact = any(k.get("telp") or k.get("wa") or k.get("email") for k in doc.get("kantor") or [])
    add("Kontak pemasaran tersedia", 15, has_contact)
    d_chg = _days_since(doc.get("last_changed_at"))
    add("Ada perubahan data ≤30 hari", 10, d_chg is not None and d_chg <= 30)
    add("Harga tersedia", 5, bool(doc.get("harga_min")))
    total = sum(b["skor"] for b in br)
    pr = "A" if total >= 70 else "B" if total >= 55 else "C"
    return {"score": total, "prioritas": pr, "breakdown": br, "target": doc.get("kab_kode") in targets}


async def rescore_all():
    targets = await target_kodes()
    async for d in db.perumahan.find({}, {"_id": 0, "id": 1, "kab_kode": 1, "first_seen_at": 1, "baseline": 1,
                                          "deteksi": 1, "tanggal_input_sumber": 1, "jumlah_unit": 1, "kantor": 1,
                                          "last_changed_at": 1, "harga_min": 1}):
        await db.perumahan.update_one({"id": d["id"]}, {"$set": compute_score(d, targets)})


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
async def _get_json(client: httpx.AsyncClient, url: str, params: dict = None):
    last = None
    for attempt in range(3):
        try:
            r = await client.get(url, params=params)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            await asyncio.sleep(3 * (attempt + 1))
    raise last


async def fetch_page(client, page: int, limit: int = PAGE_LIMIT) -> dict:
    return await _get_json(client, f"{BASE}/ajax/lokasi/search",
                           {"kodeWilayah": PROVINSI_KODE, "sort": "terbaru", "page": page, "limit": limit})


async def fetch_unit_status(id_lokasi: str) -> dict:
    """Ambil ringkasan status unit dari halaman detail publik (hanya agregat, tanpa data pribadi)."""
    async with httpx.AsyncClient(timeout=40, headers=HEADERS) as c:
        d = await _get_json(c, f"{BASE}/lokasi-perumahan/{id_lokasi}/json")
    det = d.get("detail") or {}
    b = d.get("bangunan") or []
    terjual = sum(1 for x in b if x.get("tanggalTerjual"))
    booking = sum(1 for x in b if x.get("statusBooking") and not x.get("tanggalTerjual"))
    ready = sum(1 for x in b if x.get("statusReady"))
    bangun = sum(1 for x in b if x.get("statusPembangunan"))
    ppjb = sum(1 for x in b if x.get("statusPpjb"))
    subsidi = sum(1 for x in b if (x.get("tipeBangunan") or x.get("status")) == "subsidi")
    total = len(b)
    npwp = (det.get("npwpPengembang") or "").strip()
    return {
        "unit_status": {
            "total": total, "subsidi": subsidi, "komersil": total - subsidi, "terjual": terjual,
            "booking": booking, "ready_stock": ready, "pembangunan": bangun, "ppjb": ppjb,
            "tersedia": max(total - terjual - booking, 0), "fetched_at": now_iso(),
        },
        "npwp_pengembang": npwp if len(re.sub(r"\D", "", npwp)) >= 15 else None,
        "alamat_lengkap": det.get("alamat"),
        "siteplan": det.get("siteplan") if isinstance(det.get("siteplan"), str) and det.get("siteplan", "").startswith("https://") else None,
    }


async def refresh_unit_status(id_lokasi: str) -> dict:
    data = await fetch_unit_status(id_lokasi)
    old = await db.perumahan.find_one({"id": id_lokasi}, {"_id": 0, "unit_status": 1, "nama": 1, "wilayah": 1})
    if old and old.get("unit_status"):
        ou, nu = old["unit_status"], data["unit_status"]
        changes = []
        for f, label in [("terjual", "Unit terjual"), ("booking", "Unit dibooking"), ("ready_stock", "Unit ready stock"),
                         ("total", "Total unit terdata")]:
            if ou.get(f) != nu.get(f):
                changes.append({"field": f"unit_{f}", "label": label, "old": _fmt(ou.get(f)), "new": _fmt(nu.get(f))})
        if changes:
            await _record_changes(id_lokasi, old, changes, "unit-refresh")
            data["last_changed_at"] = now_iso()
            data["deteksi"] = "DATA_UPDATED"
    await db.perumahan.update_one({"id": id_lokasi}, {"$set": data})
    return data


async def _record_changes(pid: str, doc: dict, changes: list, sync_id: str):
    ts = now_iso()
    rows = [{"id": new_id(), "perumahan_id": pid, "nama": doc.get("nama"),
             "kabupaten": (doc.get("wilayah") or {}).get("kabupaten"), "detected_at": ts, "sync_id": sync_id, **c}
            for c in changes]
    if rows:
        await db.perubahan.insert_many([dict(r) for r in rows])
    return rows


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------
async def baseline_done() -> bool:
    return bool(await db.sync_runs.find_one({"status": "success", "mode": {"$in": ["baseline", "full"]}}))


def is_running() -> bool:
    return _sync_lock.locked()


async def run_sync(mode: str = "incremental", triggered_by: str = "system") -> dict:
    """mode: baseline | incremental | full"""
    if _sync_lock.locked():
        return {"status": "busy"}
    async with _sync_lock:
        return await _run_sync(mode, triggered_by)


async def _run_sync(mode: str, triggered_by: str) -> dict:
    run = {"id": new_id(), "mode": mode, "triggered_by": triggered_by, "status": "running",
           "started_at": now_iso(), "finished_at": None, "pages": 0, "fetched": 0, "new": 0,
           "updated": 0, "delisted": 0, "total_source": None, "error": None,
           "source": f"{BASE}/ajax/lokasi/search?kodeWilayah={PROVINSI_KODE}&sort=terbaru"}
    await db.sync_runs.insert_one(dict(run))
    run.pop("_id", None)
    targets = await target_kodes()
    started = run["started_at"]
    new_docs, changed = [], []
    if mode != "baseline" and not await baseline_done():
        # Belum pernah ada baseline/full scan lengkap → perlakukan sebagai baseline (tanpa notifikasi)
        mode = "baseline"
        run["mode"] = "baseline"
    max_pages = 2 if mode == "incremental" else 9999
    try:
        async with httpx.AsyncClient(timeout=60, headers=HEADERS) as c:
            page = 1
            while page <= max_pages:
                data = await fetch_page(c, page)
                items = data.get("data") or []
                total = (data.get("count") or {}).get("totalLokasi")
                if total:
                    run["total_source"] = total
                    if mode != "incremental":
                        max_pages = math.ceil(total / PAGE_LIMIT)
                run["pages"] += 1
                page_new = 0
                fetched_at = now_iso()
                for item in items:
                    if not item.get("idLokasi"):
                        continue
                    run["fetched"] += 1
                    n = normalize(item, fetched_at)
                    snap = snapshot_of(n)
                    existing = await db.perumahan.find_one({"id": n["id"]}, {"_id": 0, "snapshot": 1, "nama": 1,
                                                                            "wilayah": 1, "delisted": 1})
                    if not existing:
                        doc = {**n, "snapshot": snap, "first_seen_at": fetched_at, "last_seen_at": fetched_at,
                               "last_changed_at": None, "baseline": mode == "baseline",
                               "deteksi": None if mode == "baseline" else "NEW_LISTING",
                               "review_status": "BELUM_REVIEW", "crm_status": None, "aktivitas": [],
                               "next_followup": None, "delisted": False, "unit_status": None}
                        doc.update(compute_score(doc, targets))
                        await db.perumahan.insert_one(dict(doc))
                        if mode != "baseline":
                            run["new"] += 1
                            page_new += 1
                            new_docs.append(doc)
                        continue
                    changes = diff_snapshots(existing.get("snapshot") or {}, snap)
                    upd = {**n, "snapshot": snap, "last_seen_at": fetched_at}
                    if existing.get("delisted"):
                        upd["delisted"] = False
                        changes.append({"field": "listing", "label": "Status listing", "old": "Tidak tampil",
                                        "new": "Tampil kembali"})
                    if changes:
                        upd["last_changed_at"] = fetched_at
                        upd["deteksi"] = "DATA_UPDATED"
                        await _record_changes(n["id"], n, changes, run["id"])
                        run["updated"] += 1
                        changed.append({"id": n["id"], "nama": n["nama"], "kab_kode": n["kab_kode"],
                                        "kabupaten": n["wilayah"]["kabupaten"], "changes": changes})
                    await db.perumahan.update_one({"id": n["id"]}, {"$set": upd})
                    if changes:
                        d = await db.perumahan.find_one({"id": n["id"]}, {"_id": 0})
                        await db.perumahan.update_one({"id": n["id"]}, {"$set": compute_score(d, targets)})
                await db.sync_runs.update_one({"id": run["id"]}, {"$set": {k: run[k] for k in
                                              ("pages", "fetched", "new", "updated", "total_source")}})
                if not items or len(items) < PAGE_LIMIT:
                    break
                # incremental: lanjut 1 halaman ekstra bila halaman terakhir masih berisi listing baru
                if mode == "incremental" and page == max_pages and page_new > 0 and max_pages < 5:
                    max_pages += 1
                page += 1
                await asyncio.sleep(PAGE_DELAY)

        # Delisting hanya dinilai pada full scan yang lengkap
        if mode == "full" and run["total_source"] and run["fetched"] >= 0.95 * run["total_source"]:
            async for d in db.perumahan.find({"last_seen_at": {"$lt": started}, "delisted": {"$ne": True}},
                                             {"_id": 0, "id": 1, "nama": 1, "wilayah": 1}):
                ch = [{"field": "listing", "label": "Status listing", "old": "Tampil",
                       "new": "Tidak lagi tampil di pencarian Sikumbang"}]
                await _record_changes(d["id"], d, ch, run["id"])
                await db.perumahan.update_one({"id": d["id"]}, {"$set": {"delisted": True, "deteksi": "DATA_UPDATED",
                                                                          "last_changed_at": now_iso()}})
                run["delisted"] += 1
        run["status"] = "success"
    except Exception as e:
        logger.exception("Sikumbang sync gagal")
        run["status"] = "error"
        run["error"] = str(e)[:300]
    run["finished_at"] = now_iso()
    await db.sync_runs.update_one({"id": run["id"]}, {"$set": run})

    # Lengkapi status unit untuk listing baru (dibatasi agar tetap pelan)
    for d in new_docs[:10]:
        try:
            await asyncio.sleep(PAGE_DELAY)
            info = await fetch_unit_status(d["id"])
            await db.perumahan.update_one({"id": d["id"]}, {"$set": info})
        except Exception as e:
            logger.warning(f"Detail unit {d['id']} gagal: {e}")

    if new_docs or changed:
        from notify import dispatch_sync_notifications
        try:
            await dispatch_sync_notifications(new_docs, changed, targets)
        except Exception:
            logger.exception("Notifikasi sync gagal")
    logger.info(f"Sync {run['mode']} selesai: {run['status']} new={run['new']} updated={run['updated']} "
                f"fetched={run['fetched']}")
    return {k: v for k, v in run.items() if k != "_id"}


async def recent_runs(limit: int = 10) -> list:
    return await db.sync_runs.find({}, {"_id": 0}).sort("started_at", -1).to_list(limit)


def since_iso(days: float) -> str:
    return (now_utc() - timedelta(days=days)).isoformat()

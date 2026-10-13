"""PROPERLEAD API — Sikumbang → Data Collector → Database → Deteksi Perubahan → Lead → Finance → CRM → Notifikasi."""
import asyncio
import csv
import hmac
import io
import math
import os
import re
from datetime import datetime, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, Response, HTTPException, Depends, Query, BackgroundTasks, Header, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from core import (db, client, logger, now_iso, new_id, today_wita, WITA, APP_URL, CRM_STAGES, REVIEW_STATUSES,
                  KALSEL_KAB, DEFAULT_TARGET, LEGACY_REGION_MAP, hash_password, verify_password, set_auth_cookies,
                  clean_user, get_current_user, require_admin, get_settings, target_kodes)
import sikumbang as sk
import notify as nt
from finance import FinanceInput, calculate, illustrative_defaults

app = FastAPI(title="PROPERLEAD API")
api = APIRouter(prefix="/api")

LIST_PROJECTION = {"_id": 0, "snapshot": 0, "aktivitas": 0, "breakdown": 0}


def _bg(coro):
    """Jalankan task background yang tidak terikat request."""
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


_bg_tasks: set = set()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginReq(BaseModel):
    email: EmailStr
    password: str


class PrefsReq(BaseModel):
    email_alert: Optional[bool] = None
    regions: Optional[List[str]] = None


class UserCreateReq(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["super_admin", "user"] = "user"
    regions: List[str] = []
    email_alert: bool = True


class UserUpdateReq(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["super_admin", "user"]] = None
    active: Optional[bool] = None
    regions: Optional[List[str]] = None
    password: Optional[str] = None
    email_alert: Optional[bool] = None


class TargetItem(BaseModel):
    kode: str
    nama: str
    target: bool


class SettingsReq(BaseModel):
    targets: List[TargetItem]
    email_new_listing: bool = True
    telegram_enabled: bool = True


class SyncReq(BaseModel):
    mode: Literal["incremental", "full"] = "incremental"


class ReviewReq(BaseModel):
    review_status: Literal["BELUM_REVIEW", "REVIEW", "LAYAK", "TIDAK_LAYAK"]
    catatan: Optional[str] = None


class CrmReq(BaseModel):
    crm_status: Optional[Literal["NEW", "DIHUBUNGI", "RESPON", "MEETING", "PROPOSAL", "KERJASAMA"]] = None
    catatan: Optional[str] = None


class AktivitasReq(BaseModel):
    tipe: Literal["catatan", "telepon", "whatsapp", "email", "kunjungan", "meeting", "proposal"] = "catatan"
    catatan: str = Field(min_length=1, max_length=2000)
    kontak_person: Optional[str] = None
    hasil: Optional[str] = None
    tanggal_followup: Optional[str] = None


class FollowupReq(BaseModel):
    tanggal: Optional[str] = None


class PlanStop(BaseModel):
    perumahan_id: str
    waktu: str = "09:00"
    durasi_menit: int = Field(60, ge=10, le=600)
    catatan: Optional[str] = ""
    visited: bool = False
    hasil: Optional[str] = ""


class PlanStart(BaseModel):
    label: str = "Titik awal"
    lat: Optional[float] = None
    lng: Optional[float] = None


class PlanReq(BaseModel):
    start: Optional[PlanStart] = None
    stops: List[PlanStop] = []


class PlanAddReq(BaseModel):
    perumahan_id: str


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@api.post("/auth/login")
async def login(body: LoginReq, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan")
    set_auth_cookies(response, user["id"])
    return clean_user(user)


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"status": "ok"}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return clean_user(user)


@api.put("/auth/me/prefs")
async def update_prefs(body: PrefsReq, user: dict = Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if upd:
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
    return clean_user(await db.users.find_one({"id": user["id"]}, {"_id": 0}))


# ---------------------------------------------------------------------------
# Users (admin)
# ---------------------------------------------------------------------------
@api.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [clean_user(u) for u in users]


@api.post("/users")
async def create_user(body: UserCreateReq, admin: dict = Depends(require_admin)):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    doc = {"id": new_id(), "email": email, "password_hash": hash_password(body.password), "name": body.name,
           "role": body.role, "regions": body.regions, "email_alert": body.email_alert, "active": True,
           "created_at": now_iso()}
    await db.users.insert_one(dict(doc))
    return clean_user(doc)


@api.put("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdateReq, admin: dict = Depends(require_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None and k != "password"}
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
        upd["password_hash"] = hash_password(body.password)
    if user_id == admin["id"] and (upd.get("active") is False or upd.get("role") == "user"):
        raise HTTPException(status_code=400, detail="Tidak dapat menonaktifkan/menurunkan akun sendiri")
    res = await db.users.update_one({"id": user_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    return clean_user(await db.users.find_one({"id": user_id}, {"_id": 0}))


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus akun sendiri")
    res = await db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Settings & wilayah
# ---------------------------------------------------------------------------
@api.get("/settings")
async def read_settings(user: dict = Depends(get_current_user)):
    return await get_settings()


@api.put("/settings")
async def write_settings(body: SettingsReq, admin: dict = Depends(require_admin)):
    doc = {"key": "main", "targets": [t.model_dump() for t in body.targets],
           "email_new_listing": body.email_new_listing, "telegram_enabled": body.telegram_enabled,
           "updated_at": now_iso()}
    await db.settings.replace_one({"key": "main"}, doc, upsert=True)
    _bg(sk.rescore_all())
    return doc


@api.get("/wilayah")
async def wilayah(user: dict = Depends(get_current_user)):
    counts = {r["_id"]: r for r in await db.perumahan.aggregate([
        {"$match": {"delisted": {"$ne": True}}},
        {"$group": {"_id": "$kab_kode", "n": {"$sum": 1}, "unit": {"$sum": "$jumlah_unit"}}}]).to_list(100)}
    targets = await target_kodes()
    return [{**k, "target": k["kode"] in targets, "jumlah_perumahan": counts.get(k["kode"], {}).get("n", 0),
             "jumlah_unit": counts.get(k["kode"], {}).get("unit", 0)} for k in KALSEL_KAB]


# ---------------------------------------------------------------------------
# Sync / collector
# ---------------------------------------------------------------------------
@api.get("/sync/status")
async def sync_status(user: dict = Depends(get_current_user)):
    runs = await sk.recent_runs(15)
    last_ok = next((r for r in runs if r["status"] == "success"), None)
    return {"running": sk.is_running(), "runs": runs, "last_success": last_ok,
            "total_perumahan": await db.perumahan.count_documents({}),
            "source": "https://sikumbang.tapera.go.id", "provinsi": "KALIMANTAN SELATAN (63)"}


@api.post("/sync/run")
async def sync_run(body: SyncReq, user: dict = Depends(get_current_user)):
    if body.mode == "full" and user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Full scan hanya untuk Super Admin")
    if sk.is_running():
        return {"status": "busy", "message": "Sinkronisasi sedang berjalan"}
    _bg(sk.run_sync(body.mode, triggered_by=user["email"]))
    return {"status": "started", "mode": body.mode}


def _check_cron_auth(authorization: Optional[str]):
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not secret or not hmac.compare_digest(authorization[7:], secret):
        raise HTTPException(status_code=401, detail="unauthorized")


async def _cron_accept(request: Request, name: str, x_webhook_id: Optional[str]) -> bool:
    """Return True bila run baru (idempotency via X-Webhook-Id / run_id)."""
    run_id = x_webhook_id
    if not run_id:
        try:
            body = await request.json()
            if body is not None and not isinstance(body, dict):
                raise HTTPException(status_code=400, detail="invalid body")
            run_id = (body or {}).get("run_id")
        except HTTPException:
            raise
        except Exception:
            run_id = None
    run_id = run_id or new_id()
    try:
        await db.cron_runs.insert_one({"run_id": run_id, "name": name, "received_at": now_iso()})
        return True
    except Exception:
        return False  # duplicate


@api.post("/cron/sikumbang-sync")
async def cron_sync(request: Request, authorization: Optional[str] = Header(None),
                    x_webhook_id: Optional[str] = Header(None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _check_cron_auth(authorization)
    if await _cron_accept(request, "sikumbang-sync", x_webhook_id):
        _bg(sk.run_sync("incremental", triggered_by="cron"))
    return {"status": "accepted"}


@api.post("/cron/sikumbang-full")
async def cron_full(request: Request, authorization: Optional[str] = Header(None),
                    x_webhook_id: Optional[str] = Header(None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _check_cron_auth(authorization)
    if await _cron_accept(request, "sikumbang-full", x_webhook_id):
        _bg(sk.run_sync("full", triggered_by="cron"))
    return {"status": "accepted"}


@api.post("/cron/daily-digest")
async def cron_digest(request: Request, authorization: Optional[str] = Header(None),
                      x_webhook_id: Optional[str] = Header(None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _check_cron_auth(authorization)
    if await _cron_accept(request, "daily-digest", x_webhook_id):
        _bg(nt.run_daily_digest())
    return {"status": "accepted"}


@api.post("/digest/run")
async def digest_me(user: dict = Depends(get_current_user)):
    return await nt.run_daily_digest(only_user=user)


# ---------------------------------------------------------------------------
# Perumahan
# ---------------------------------------------------------------------------
def _build_filter(q, kab, deteksi, prioritas, review, crm, jenis, target_only, targets, include_delisted=False,
                  days=None):
    f = {}
    if not include_delisted:
        f["delisted"] = {"$ne": True}
    if q:
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        f["$or"] = [{"nama": rx}, {"pengembang.nama": rx}, {"id": rx}, {"wilayah.kecamatan": rx},
                    {"wilayah.kelurahan": rx}]
    if kab:
        f["kab_kode"] = {"$in": kab.split(",")}
    elif target_only:
        f["kab_kode"] = {"$in": list(targets)}
    if deteksi:
        f["deteksi"] = deteksi
        if days:
            key = "first_seen_at" if deteksi == "NEW_LISTING" else "last_changed_at"
            f[key] = {"$gte": sk.since_iso(days)}
    if prioritas:
        f["prioritas"] = {"$in": prioritas.split(",")}
    if review:
        f["review_status"] = review
    if crm:
        f["crm_status"] = {"$ne": None} if crm == "ANY" else crm
    if jenis:
        f["jenis"] = jenis
    return f


SORTS = {"terbaru": [("first_seen_at", -1), ("tanggal_input_sumber", -1)],
         "skor": [("score", -1), ("tanggal_input_sumber", -1)],
         "unit": [("jumlah_unit", -1)], "nama": [("nama", 1)],
         "sumber_terbaru": [("tanggal_input_sumber", -1)], "berubah": [("last_changed_at", -1)]}


@api.get("/perumahan")
async def list_perumahan(q: Optional[str] = None, kab: Optional[str] = None, deteksi: Optional[str] = None,
                         prioritas: Optional[str] = None, review: Optional[str] = None, crm: Optional[str] = None,
                         jenis: Optional[str] = None, target_only: bool = False, days: Optional[int] = None,
                         sort: str = "skor", page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=200),
                         user: dict = Depends(get_current_user)):
    targets = await target_kodes()
    f = _build_filter(q, kab, deteksi, prioritas, review, crm, jenis, target_only, targets, days=days)
    total = await db.perumahan.count_documents(f)
    items = await db.perumahan.find(f, LIST_PROJECTION).sort(SORTS.get(sort, SORTS["skor"])) \
        .skip((page - 1) * limit).limit(limit).to_list(limit)
    for it in items:
        it["foto"] = (it.get("foto") or [])[:1]
    return {"items": items, "total": total, "page": page, "pages": max(1, math.ceil(total / limit))}


@api.get("/perumahan/map")
async def perumahan_map(kab: Optional[str] = None, prioritas: Optional[str] = None, deteksi: Optional[str] = None,
                        target_only: bool = False, user: dict = Depends(get_current_user)):
    targets = await target_kodes()
    f = _build_filter(None, kab, deteksi, prioritas, None, None, None, target_only, targets)
    f["lat"] = {"$ne": None}
    proj = {"_id": 0, "id": 1, "nama": 1, "lat": 1, "lng": 1, "kab_kode": 1, "wilayah.kabupaten": 1,
            "wilayah.kecamatan": 1, "prioritas": 1, "score": 1, "deteksi": 1, "jumlah_unit": 1, "pengembang.nama": 1,
            "harga_min": 1, "crm_status": 1}
    return await db.perumahan.find(f, proj).to_list(5000)


async def _get_p(pid: str) -> dict:
    p = await db.perumahan.find_one({"id": pid}, {"_id": 0, "snapshot": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Perumahan tidak ditemukan")
    return p


@api.get("/perumahan/{pid}")
async def get_perumahan(pid: str, user: dict = Depends(get_current_user)):
    p = await _get_p(pid)
    p["perubahan"] = await db.perubahan.find({"perumahan_id": pid}, {"_id": 0}).sort("detected_at", -1).to_list(200)
    p["maps_url"] = nt.maps_url(p)
    p["gcal_url"] = nt.gcal_url(p, nt.default_visit_start())
    fin = await db.finance.find_one({"perumahan_id": pid}, {"_id": 0, "result.cashflow": 0})
    p["finance"] = fin
    others = await db.perumahan.count_documents({"pengembang.nama": p["pengembang"]["nama"], "id": {"$ne": pid}}) \
        if p.get("pengembang", {}).get("nama") else 0
    p["developer_lain"] = others
    return p


@api.post("/perumahan/{pid}/refresh-units")
async def refresh_units(pid: str, user: dict = Depends(get_current_user)):
    await _get_p(pid)
    try:
        data = await sk.refresh_unit_status(pid)
    except Exception as e:
        logger.warning(f"refresh unit {pid}: {e}")
        raise HTTPException(status_code=502, detail="Gagal mengambil detail unit dari Sikumbang, coba lagi nanti")
    return data


async def _log(pid: str, user: dict, tipe: str, catatan: str, **extra):
    entry = {"id": new_id(), "tipe": tipe, "catatan": catatan, "oleh": user.get("name"), "user_id": user["id"],
             "created_at": now_iso(), **{k: v for k, v in extra.items() if v}}
    await db.perumahan.update_one({"id": pid}, {"$push": {"aktivitas": {"$each": [entry], "$position": 0}}})
    return entry


@api.put("/perumahan/{pid}/review")
async def set_review(pid: str, body: ReviewReq, user: dict = Depends(get_current_user)):
    p = await _get_p(pid)
    upd = {"review_status": body.review_status, "reviewed_by": user.get("name"), "reviewed_at": now_iso()}
    if body.review_status == "LAYAK" and not p.get("crm_status"):
        upd["crm_status"] = "NEW"
    await db.perumahan.update_one({"id": pid}, {"$set": upd})
    label = {"BELUM_REVIEW": "Belum review", "REVIEW": "Sedang direview", "LAYAK": "Layak dihubungi",
             "TIDAK_LAYAK": "Tidak layak"}[body.review_status]
    await _log(pid, user, "review", f"Status review: {label}" + (f" — {body.catatan}" if body.catatan else ""))
    return await _get_p(pid)


@api.put("/perumahan/{pid}/crm")
async def set_crm(pid: str, body: CrmReq, user: dict = Depends(get_current_user)):
    p = await _get_p(pid)
    upd = {"crm_status": body.crm_status, "crm_updated_at": now_iso()}
    if body.crm_status and p.get("review_status") in ("BELUM_REVIEW", "REVIEW", None):
        upd["review_status"] = "LAYAK"
    await db.perumahan.update_one({"id": pid}, {"$set": upd})
    await _log(pid, user, "crm", f"Tahap CRM: {p.get('crm_status') or '-'} → {body.crm_status or 'dikeluarkan'}"
               + (f" — {body.catatan}" if body.catatan else ""))
    return await _get_p(pid)


@api.post("/perumahan/{pid}/aktivitas")
async def add_aktivitas(pid: str, body: AktivitasReq, user: dict = Depends(get_current_user)):
    await _get_p(pid)
    entry = await _log(pid, user, body.tipe, body.catatan, kontak_person=body.kontak_person, hasil=body.hasil,
                       tanggal_followup=body.tanggal_followup)
    if body.tanggal_followup:
        await db.perumahan.update_one({"id": pid}, {"$set": {"next_followup": body.tanggal_followup}})
    return entry


@api.put("/perumahan/{pid}/followup")
async def set_followup(pid: str, body: FollowupReq, user: dict = Depends(get_current_user)):
    await _get_p(pid)
    await db.perumahan.update_one({"id": pid}, {"$set": {"next_followup": body.tanggal or None}})
    return {"next_followup": body.tanggal or None}


@api.post("/perumahan/{pid}/email-me")
async def email_me(pid: str, user: dict = Depends(get_current_user)):
    p = await _get_p(pid)
    ok = await nt.email_new_listings(user, [p])
    if not ok:
        raise HTTPException(status_code=502, detail="Email gagal dikirim")
    return {"status": "sent", "to": user["email"]}


@api.get("/perubahan")
async def list_perubahan(days: int = Query(30, ge=1, le=3650), kab: Optional[str] = None,
                         page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=500),
                         user: dict = Depends(get_current_user)):
    f = {"detected_at": {"$gte": sk.since_iso(days)}}
    if kab:
        ids = [d["id"] for d in await db.perumahan.find({"kab_kode": {"$in": kab.split(",")}}, {"_id": 0, "id": 1})
               .to_list(5000)]
        f["perumahan_id"] = {"$in": ids}
    total = await db.perubahan.count_documents(f)
    items = await db.perubahan.find(f, {"_id": 0}).sort("detected_at", -1).skip((page - 1) * limit) \
        .limit(limit).to_list(limit)
    return {"items": items, "total": total}


# ---------------------------------------------------------------------------
# Developer profile
# ---------------------------------------------------------------------------
@api.get("/developers")
async def list_developers(q: Optional[str] = None, kab: Optional[str] = None, page: int = Query(1, ge=1),
                          limit: int = Query(30, ge=1, le=200), sort: str = "unit",
                          user: dict = Depends(get_current_user)):
    match = {"delisted": {"$ne": True}, "pengembang.nama": {"$nin": [None, ""]}}
    if q:
        match["pengembang.nama"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    if kab:
        match["kab_kode"] = {"$in": kab.split(",")}
    sort_stage = {"unit": {"total_unit": -1}, "proyek": {"jumlah_proyek": -1}, "terbaru": {"terbaru": -1},
                  "nama": {"_id": 1}}.get(sort, {"total_unit": -1})
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$pengembang.nama", "asosiasi": {"$first": "$pengembang.asosiasi"},
                    "jumlah_proyek": {"$sum": 1}, "total_unit": {"$sum": "$jumlah_unit"},
                    "kabupaten": {"$addToSet": "$wilayah.kabupaten"}, "terbaru": {"$max": "$tanggal_input_sumber"},
                    "skor_max": {"$max": "$score"}, "baru": {"$sum": {"$cond": [{"$eq": ["$deteksi", "NEW_LISTING"]}, 1, 0]}},
                    "di_crm": {"$sum": {"$cond": [{"$ne": [{"$ifNull": ["$crm_status", None]}, None]}, 1, 0]}}}},
        {"$sort": sort_stage},
        {"$facet": {"items": [{"$skip": (page - 1) * limit}, {"$limit": limit}], "total": [{"$count": "n"}]}},
    ]
    res = (await db.perumahan.aggregate(pipeline).to_list(1))[0]
    items = [{"nama": r.pop("_id"), **r} for r in res["items"]]
    total = res["total"][0]["n"] if res["total"] else 0
    return {"items": items, "total": total, "pages": max(1, math.ceil(total / limit))}


@api.get("/developers/detail")
async def developer_detail(nama: str, user: dict = Depends(get_current_user)):
    proj = await db.perumahan.find({"pengembang.nama": nama}, LIST_PROJECTION).sort("tanggal_input_sumber", -1) \
        .to_list(500)
    if not proj:
        raise HTTPException(status_code=404, detail="Developer tidak ditemukan")
    kontak, seen = [], set()
    for p in proj:
        for k in p.get("kantor") or []:
            key = (k.get("telp"), k.get("wa"), k.get("email"))
            if key not in seen and any(key):
                seen.add(key)
                kontak.append({**k, "perumahan": p["nama"]})
    npwp = next((p.get("npwp_pengembang") for p in proj if p.get("npwp_pengembang")), None)
    acts = []
    for p in await db.perumahan.find({"pengembang.nama": nama}, {"_id": 0, "id": 1, "nama": 1, "aktivitas": 1}).to_list(500):
        for a in (p.get("aktivitas") or [])[:20]:
            acts.append({**a, "perumahan_id": p["id"], "perumahan": p["nama"]})
    acts.sort(key=lambda a: a.get("created_at") or "", reverse=True)
    return {
        "nama": nama, "asosiasi": proj[0].get("pengembang", {}).get("asosiasi"), "npwp": npwp,
        "jumlah_proyek": len(proj), "total_unit": sum(p.get("jumlah_unit") or 0 for p in proj),
        "kabupaten": sorted({(p.get("wilayah") or {}).get("kabupaten") for p in proj if p.get("wilayah")}),
        "harga_min": min([p["harga_min"] for p in proj if p.get("harga_min")] or [0]) or None,
        "harga_max": max([p["harga_max"] for p in proj if p.get("harga_max")] or [0]) or None,
        "kontak": kontak[:20], "proyek": proj, "aktivitas": acts[:50],
    }


# ---------------------------------------------------------------------------
# CRM board
# ---------------------------------------------------------------------------
@api.get("/crm/board")
async def crm_board(user: dict = Depends(get_current_user)):
    items = await db.perumahan.find({"crm_status": {"$ne": None}}, {
        "_id": 0, "id": 1, "nama": 1, "pengembang.nama": 1, "wilayah.kabupaten": 1, "prioritas": 1, "score": 1,
        "crm_status": 1, "next_followup": 1, "jumlah_unit": 1, "crm_updated_at": 1}).sort("score", -1).to_list(1000)
    return {"stages": CRM_STAGES, "columns": {s: [i for i in items if i["crm_status"] == s] for s in CRM_STAGES}}


@api.get("/followups")
async def followups(user: dict = Depends(get_current_user)):
    today = today_wita()
    items = await db.perumahan.find({"next_followup": {"$ne": None}}, {
        "_id": 0, "id": 1, "nama": 1, "pengembang.nama": 1, "wilayah.kabupaten": 1, "next_followup": 1,
        "crm_status": 1, "prioritas": 1}).sort("next_followup", 1).to_list(200)
    for i in items:
        i["status"] = "terlambat" if i["next_followup"] < today else "hari_ini" if i["next_followup"] == today else "mendatang"
    return items


# ---------------------------------------------------------------------------
# Project Finance
# ---------------------------------------------------------------------------
@api.post("/finance/calc")
async def finance_calc(body: FinanceInput, user: dict = Depends(get_current_user)):
    return calculate(body)


@api.get("/finance")
async def finance_list(user: dict = Depends(get_current_user)):
    return await db.finance.find({}, {"_id": 0, "result.cashflow": 0}).sort("updated_at", -1).to_list(500)


@api.get("/finance/{pid}")
async def finance_get(pid: str, user: dict = Depends(get_current_user)):
    p = await _get_p(pid)
    saved = await db.finance.find_one({"perumahan_id": pid}, {"_id": 0})
    if saved:
        inp = FinanceInput(**saved["input"])
    else:
        tipe = [t for t in p.get("tipe_rumah") or [] if t.get("harga")]
        harga = round(sum(t["harga"] for t in tipe) / len(tipe)) if tipe else 0
        inp = FinanceInput(jumlah_unit=p.get("jumlah_unit") or 0, harga_jual_per_unit=harga)
    return {"perumahan_id": pid, "saved": bool(saved), "input": inp.model_dump(), "result": calculate(inp),
            "updated_at": (saved or {}).get("updated_at"), "updated_by": (saved or {}).get("updated_by"),
            "listing": {"jumlah_unit": p.get("jumlah_unit"), "tipe_rumah": p.get("tipe_rumah"),
                        "harga_min": p.get("harga_min"), "harga_max": p.get("harga_max")}}


@api.get("/finance/{pid}/defaults")
async def finance_defaults(pid: str, user: dict = Depends(get_current_user)):
    p = await _get_p(pid)
    inp = FinanceInput(**illustrative_defaults(p))
    return {"input": inp.model_dump(), "result": calculate(inp)}


@api.put("/finance/{pid}")
async def finance_save(pid: str, body: FinanceInput, user: dict = Depends(get_current_user)):
    p = await _get_p(pid)
    res = calculate(body)
    doc = {"perumahan_id": pid, "nama": p["nama"], "pengembang": p.get("pengembang", {}).get("nama"),
           "kabupaten": (p.get("wilayah") or {}).get("kabupaten"), "input": body.model_dump(), "result": res,
           "updated_at": now_iso(), "updated_by": user.get("name")}
    await db.finance.replace_one({"perumahan_id": pid}, doc, upsert=True)
    await _log(pid, user, "finance", f"Simulasi Project Finance disimpan (selisih {nt.rupiah(res['selisih_penjualan_biaya'])}, "
               f"kebutuhan pembiayaan {nt.rupiah(res['kebutuhan_pembiayaan'])})")
    return doc


# ---------------------------------------------------------------------------
# Rencana Kunjungan Harian
# ---------------------------------------------------------------------------
def _valid_date(d: str) -> str:
    try:
        return datetime.fromisoformat(d).date().isoformat()
    except Exception:
        raise HTTPException(status_code=400, detail="Format tanggal harus YYYY-MM-DD")


def _hav(a, b) -> float:
    if not (a and b and a.get("lat") and b.get("lat")):
        return 0.0
    r = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [a["lat"], a["lng"], b["lat"], b["lng"]])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


async def _plan_doc(user: dict, date: str) -> dict:
    plan = await db.plans.find_one({"user_id": user["id"], "date": date}, {"_id": 0})
    if not plan:
        plan = {"id": new_id(), "user_id": user["id"], "date": date, "start": None, "stops": [],
                "created_at": now_iso(), "updated_at": now_iso()}
    return plan


async def _expand_plan(plan: dict) -> dict:
    ids = [s["perumahan_id"] for s in plan.get("stops") or []]
    ps = {p["id"]: p for p in await db.perumahan.find({"id": {"$in": ids}}, {
        "_id": 0, "id": 1, "nama": 1, "lat": 1, "lng": 1, "wilayah": 1, "pengembang": 1, "kantor": 1,
        "jumlah_unit": 1, "prioritas": 1, "score": 1, "tipe_rumah": 1, "crm_status": 1}).to_list(100)}
    stops, prev, total_km = [], plan.get("start"), 0.0
    for s in plan.get("stops") or []:
        p = ps.get(s["perumahan_id"])
        if not p:
            continue
        km = _hav(prev, p) if prev else 0.0
        total_km += km
        start_dt = nt.default_visit_start(plan["date"], s.get("waktu") or "09:00")
        stops.append({**s, "perumahan": p, "jarak_km": round(km, 1), "maps_url": nt.maps_url(p),
                      "gcal_url": nt.gcal_url(p, start_dt, s.get("durasi_menit") or 60, s.get("catatan") or "")})
        prev = p
    out = {**plan, "stops": stops, "total_km": round(total_km, 1),
           "route_url": nt.route_url([x["perumahan"] for x in stops], plan.get("start")),
           "waypoint_limit_exceeded": len(stops) > 10}
    return out


@api.get("/plans")
async def list_plans(user: dict = Depends(get_current_user)):
    rows = await db.plans.find({"user_id": user["id"]}, {"_id": 0, "date": 1, "stops": 1, "id": 1}).sort("date", -1).to_list(60)
    return [{"id": r["id"], "date": r["date"], "jumlah": len(r.get("stops") or []),
             "dikunjungi": sum(1 for s in r.get("stops") or [] if s.get("visited"))} for r in rows]


@api.get("/plans/{date}")
async def get_plan(date: str, user: dict = Depends(get_current_user)):
    date = today_wita() if date == "today" else _valid_date(date)
    return await _expand_plan(await _plan_doc(user, date))


async def _save_plan(user: dict, plan: dict, stops: list, start: Optional[dict]):
    old = {s["perumahan_id"]: s for s in plan.get("stops") or []}
    for s in stops:
        o = old.get(s["perumahan_id"], {})
        if s.get("visited") and (not o.get("visited") or (s.get("hasil") and s.get("hasil") != o.get("hasil"))):
            s["visited_at"] = now_iso()
            await _log(s["perumahan_id"], user, "kunjungan",
                       f"Kunjungan {plan['date']} {s.get('waktu') or ''}: {s.get('hasil') or 'sudah dikunjungi'}")
        elif o.get("visited_at"):
            s["visited_at"] = o["visited_at"]
    plan.update({"stops": stops, "start": start, "updated_at": now_iso()})
    await db.plans.replace_one({"user_id": user["id"], "date": plan["date"]}, plan, upsert=True)
    return await _expand_plan(plan)


@api.put("/plans/{date}")
async def put_plan(date: str, body: PlanReq, user: dict = Depends(get_current_user)):
    date = _valid_date(date)
    plan = await _plan_doc(user, date)
    seen, stops = set(), []
    for s in body.stops:
        if s.perumahan_id not in seen:
            seen.add(s.perumahan_id)
            stops.append(s.model_dump())
    if len(stops) > 25:
        raise HTTPException(status_code=400, detail="Maksimal 25 kunjungan per hari")
    return await _save_plan(user, plan, stops, body.start.model_dump() if body.start else None)


@api.post("/plans/{date}/add")
async def add_to_plan(date: str, body: PlanAddReq, user: dict = Depends(get_current_user)):
    date = today_wita() if date == "today" else _valid_date(date)
    await _get_p(body.perumahan_id)
    plan = await _plan_doc(user, date)
    stops = plan.get("stops") or []
    if any(s["perumahan_id"] == body.perumahan_id for s in stops):
        out = await _expand_plan(plan)
        out["already"] = True
        return out
    if len(stops) >= 25:
        raise HTTPException(status_code=400, detail="Maksimal 25 kunjungan per hari")
    last = stops[-1]["waktu"] if stops else None
    if last:
        h, m = [int(x) for x in last.split(":")]
        t = h * 60 + m + 90
        waktu = f"{min(t // 60, 21):02d}:{t % 60:02d}"
    else:
        waktu = "09:00"
    stops.append({"perumahan_id": body.perumahan_id, "waktu": waktu, "durasi_menit": 60, "catatan": "",
                  "visited": False, "hasil": ""})
    return await _save_plan(user, plan, stops, plan.get("start"))


@api.post("/plans/{date}/optimize")
async def optimize_plan(date: str, user: dict = Depends(get_current_user)):
    date = _valid_date(date)
    plan = await _plan_doc(user, date)
    stops = plan.get("stops") or []
    if len(stops) < 2:
        return await _expand_plan(plan)
    ps = {p["id"]: p for p in await db.perumahan.find({"id": {"$in": [s["perumahan_id"] for s in stops]}},
                                                      {"_id": 0, "id": 1, "lat": 1, "lng": 1}).to_list(100)}
    remaining = [s for s in stops if ps.get(s["perumahan_id"], {}).get("lat")]
    no_coord = [s for s in stops if not ps.get(s["perumahan_id"], {}).get("lat")]
    cur = plan.get("start") if (plan.get("start") or {}).get("lat") else ps[remaining[0]["perumahan_id"]]
    ordered = []
    while remaining:
        nxt = min(remaining, key=lambda s: _hav(cur, ps[s["perumahan_id"]]))
        ordered.append(nxt)
        remaining.remove(nxt)
        cur = ps[nxt["perumahan_id"]]
    ordered += no_coord
    # jadwal ulang: mulai 09:00, durasi kunjungan + perjalanan (asumsi 35 km/jam)
    t = 9 * 60
    prev = plan.get("start") if (plan.get("start") or {}).get("lat") else None
    for s in ordered:
        p = ps.get(s["perumahan_id"])
        if prev and p and p.get("lat"):
            t += int(_hav(prev, p) / 35 * 60)
        s["waktu"] = f"{min(t // 60, 23):02d}:{t % 60:02d}"
        t += (s.get("durasi_menit") or 60)
        if p and p.get("lat"):
            prev = p
    return await _save_plan(user, plan, ordered, plan.get("start"))


@api.get("/plans/{date}/ics")
async def plan_ics(date: str, user: dict = Depends(get_current_user)):
    date = _valid_date(date)
    plan = await _expand_plan(await _plan_doc(user, date))
    events = []
    for s in plan["stops"]:
        p = s["perumahan"]
        events.append({"uid": f"{plan['id']}-{p['id']}", "start": nt.default_visit_start(date, s.get("waktu")),
                       "minutes": s.get("durasi_menit") or 60, "title": f"Kunjungan: {p['nama']}",
                       "description": nt.listing_text(p) + (f"\nCatatan: {s['catatan']}" if s.get("catatan") else ""),
                       "location": f"{p['lat']},{p['lng']}" if p.get("lat") else (p.get("wilayah") or {}).get("kabupaten", ""),
                       "lat": p.get("lat"), "lng": p.get("lng")})
    if not events:
        raise HTTPException(status_code=400, detail="Rencana kunjungan masih kosong")
    return Response(content=nt.build_ics(events), media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="rencana-kunjungan-{date}.ics"'})


@api.post("/plans/{date}/email")
async def plan_email(date: str, user: dict = Depends(get_current_user)):
    date = _valid_date(date)
    plan = await _expand_plan(await _plan_doc(user, date))
    if not plan["stops"]:
        raise HTTPException(status_code=400, detail="Rencana kunjungan masih kosong")
    body = ""
    if plan["route_url"]:
        route_link = f"{APP_URL}/api/go/route/{plan['id']}"
        body += '<div style="margin-bottom:14px">' + nt._btn(route_link, "Buka Rute Semua Kunjungan di Google Maps", "#1A73E8") + '</div>'
    for i, s in enumerate(plan["stops"], 1):
        body += f'<div style="font-size:13px;font-weight:bold;color:#065F46;margin:6px 0">#{i} · {nt.escape(s.get("waktu") or "")} WITA</div>'
        body += nt.listing_card_html({**s["perumahan"], "score": s["perumahan"].get("score"),
                                      "prioritas": s["perumahan"].get("prioritas")}, date)
    ok = await nt.safe_send(user["email"], f"Rencana kunjungan {date} — {len(plan['stops'])} perumahan",
                            nt.wrap_email(f"Rencana kunjungan {date}",
                                          f"Halo {nt.escape(user.get('name') or '')}, berikut rute dan daftar perumahan yang akan Anda kunjungi. Total jarak garis lurus ± {plan['total_km']} km.",
                                          body))
    if not ok:
        raise HTTPException(status_code=502, detail="Email gagal dikirim")
    return {"status": "sent", "to": user["email"]}


# ---------------------------------------------------------------------------
# Public redirect links (dipakai tombol email — semua tautan email menuju domain aplikasi)
# ---------------------------------------------------------------------------
@api.get("/go/maps/{pid}")
async def go_maps(pid: str):
    p = await db.perumahan.find_one({"id": pid}, {"_id": 0, "id": 1, "nama": 1, "lat": 1, "lng": 1, "wilayah": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Perumahan tidak ditemukan")
    return RedirectResponse(nt.maps_url(p), status_code=302)


@api.get("/go/calendar/{pid}")
async def go_calendar(pid: str, date: Optional[str] = None, time: Optional[str] = None):
    p = await db.perumahan.find_one({"id": pid}, {"_id": 0, "snapshot": 0, "aktivitas": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Perumahan tidak ditemukan")
    if date:
        date = _valid_date(date)
    if time and not re.match(r"^\d{2}:\d{2}$", time):
        time = None
    return RedirectResponse(nt.gcal_url(p, nt.default_visit_start(date, time or "09:00")), status_code=302)


@api.get("/go/route/{plan_id}")
async def go_route(plan_id: str):
    plan = await db.plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Rencana tidak ditemukan")
    out = await _expand_plan(plan)
    if not out["route_url"]:
        raise HTTPException(status_code=404, detail="Rencana belum memiliki titik koordinat")
    return RedirectResponse(out["route_url"], status_code=302)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
def _notif_filter(user: dict, targets: set) -> dict:
    regions = user.get("regions") or []
    kods = regions or list(targets)
    return {"$or": [{"kab_kode": {"$in": kods}}, {"kab_kode": None}]}


@api.get("/notifications")
async def list_notifications(limit: int = Query(30, ge=1, le=200), user: dict = Depends(get_current_user)):
    targets = await target_kodes()
    f = _notif_filter(user, targets)
    items = await db.notifications.find(f, {"_id": 0}).sort("created_at", -1).to_list(limit)
    unread = await db.notifications.count_documents({**f, "read_by": {"$ne": user["id"]}})
    for n in items:
        n["read"] = user["id"] in (n.pop("read_by", []) or [])
    return {"items": items, "unread": unread}


@api.put("/notifications/read-all")
async def read_all(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"read_by": {"$ne": user["id"]}}, {"$addToSet": {"read_by": user["id"]}})
    return {"status": "ok"}


@api.put("/notifications/{nid}/read")
async def read_one(nid: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": nid}, {"$addToSet": {"read_by": user["id"]}})
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Dashboard & reports
# ---------------------------------------------------------------------------
@api.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    targets = await target_kodes()
    base = {"delisted": {"$ne": True}}
    tgt = {**base, "kab_kode": {"$in": list(targets)}}
    since7 = sk.since_iso(7)
    today = today_wita()
    new7 = await db.perumahan.count_documents({**base, "deteksi": "NEW_LISTING", "first_seen_at": {"$gte": since7}})
    changed_ids = await db.perubahan.distinct("perumahan_id", {"detected_at": {"$gte": since7}})
    plan = await db.plans.find_one({"user_id": user["id"], "date": today}, {"_id": 0, "stops": 1})
    prio = {r["_id"]: r["n"] for r in await db.perumahan.aggregate([
        {"$match": tgt}, {"$group": {"_id": "$prioritas", "n": {"$sum": 1}}}]).to_list(10)}
    pipeline = {r["_id"]: r["n"] for r in await db.perumahan.aggregate([
        {"$match": {"crm_status": {"$ne": None}}}, {"$group": {"_id": "$crm_status", "n": {"$sum": 1}}}]).to_list(10)}
    kab = await db.perumahan.aggregate([
        {"$match": base}, {"$group": {"_id": "$kab_kode", "nama": {"$first": "$wilayah.kabupaten"}, "n": {"$sum": 1},
                                      "unit": {"$sum": "$jumlah_unit"}}}, {"$sort": {"n": -1}}]).to_list(20)
    latest_new = await db.perumahan.find({**base, "deteksi": "NEW_LISTING"}, LIST_PROJECTION) \
        .sort("first_seen_at", -1).limit(6).to_list(6)
    latest_src = await db.perumahan.find(tgt, LIST_PROJECTION).sort("tanggal_input_sumber", -1).limit(6).to_list(6)
    changes = await db.perubahan.find({}, {"_id": 0}).sort("detected_at", -1).limit(8).to_list(8)
    runs = await sk.recent_runs(1)
    return {
        "total": await db.perumahan.count_documents(base),
        "target": await db.perumahan.count_documents(tgt),
        "unit_target": sum(r["unit"] for r in kab if r["_id"] in targets),
        "new_7d": new7, "changed_7d": len(changed_ids),
        "followup_due": await db.perumahan.count_documents({"next_followup": {"$lte": today, "$ne": None}}),
        "review_pending": await db.perumahan.count_documents({**tgt, "review_status": "BELUM_REVIEW",
                                                              "prioritas": "A"}),
        "plan_today": len((plan or {}).get("stops") or []),
        "prioritas": {k: prio.get(k, 0) for k in ["A", "B", "C"]},
        "pipeline": {s: pipeline.get(s, 0) for s in CRM_STAGES},
        "per_kabupaten": [{"kode": r["_id"], "nama": r["nama"], "jumlah": r["n"], "unit": r["unit"],
                           "target": r["_id"] in targets} for r in kab],
        "latest_new": latest_new, "latest_source": latest_src, "latest_changes": changes,
        "last_sync": runs[0] if runs else None, "sync_running": sk.is_running(),
    }


@api.get("/reports/summary")
async def report_summary(user: dict = Depends(get_current_user)):
    targets = await target_kodes()
    since30 = sk.since_iso(30)
    kab = await db.perumahan.aggregate([
        {"$match": {"delisted": {"$ne": True}}},
        {"$group": {"_id": "$kab_kode", "nama": {"$first": "$wilayah.kabupaten"}, "perumahan": {"$sum": 1},
                    "unit": {"$sum": "$jumlah_unit"}, "harga_min_avg": {"$avg": "$harga_min"},
                    "pengembang": {"$addToSet": "$pengembang.nama"},
                    "baru_30d": {"$sum": {"$cond": [{"$and": [{"$eq": ["$deteksi", "NEW_LISTING"]},
                                                              {"$gte": ["$first_seen_at", since30]}]}, 1, 0]}},
                    "crm": {"$sum": {"$cond": [{"$ne": [{"$ifNull": ["$crm_status", None]}, None]}, 1, 0]}}}},
        {"$sort": {"perumahan": -1}}]).to_list(20)
    per_kab = [{"kode": r["_id"], "nama": r["nama"], "perumahan": r["perumahan"], "unit": r["unit"],
                "harga_min_avg": round(r["harga_min_avg"]) if r.get("harga_min_avg") else None,
                "pengembang": len([x for x in r["pengembang"] if x]), "baru_30d": r["baru_30d"], "crm": r["crm"],
                "target": r["_id"] in targets} for r in kab]
    monthly = await db.perumahan.aggregate([
        {"$match": {"tanggal_input_sumber": {"$ne": None}}},
        {"$group": {"_id": {"$substr": ["$tanggal_input_sumber", 0, 7]}, "n": {"$sum": 1},
                    "unit": {"$sum": "$jumlah_unit"}}},
        {"$sort": {"_id": -1}}, {"$limit": 12}]).to_list(12)
    chg_types = await db.perubahan.aggregate([
        {"$match": {"detected_at": {"$gte": since30}}}, {"$group": {"_id": "$field", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}]).to_list(30)
    top_dev = await db.perumahan.aggregate([
        {"$match": {"delisted": {"$ne": True}, "kab_kode": {"$in": list(targets)}}},
        {"$group": {"_id": "$pengembang.nama", "proyek": {"$sum": 1}, "unit": {"$sum": "$jumlah_unit"}}},
        {"$sort": {"unit": -1}}, {"$limit": 10}]).to_list(10)
    fin = await db.finance.find({}, {"_id": 0, "result.cashflow": 0}).to_list(500)
    pipeline = {r["_id"]: r["n"] for r in await db.perumahan.aggregate([
        {"$match": {"crm_status": {"$ne": None}}}, {"$group": {"_id": "$crm_status", "n": {"$sum": 1}}}]).to_list(10)}
    return {
        "per_kabupaten": per_kab,
        "bulanan_sumber": [{"bulan": r["_id"], "jumlah": r["n"], "unit": r["unit"]} for r in reversed(monthly)],
        "jenis_perubahan_30d": [{"field": r["_id"], "jumlah": r["n"]} for r in chg_types],
        "top_developer": [{"nama": r["_id"], "proyek": r["proyek"], "unit": r["unit"]} for r in top_dev],
        "finance": {"jumlah": len(fin), "total_kebutuhan": sum(f["result"]["kebutuhan_pembiayaan"] for f in fin),
                    "total_potensi": sum(f["result"]["potensi_penjualan"] for f in fin),
                    "items": sorted(fin, key=lambda f: -f["result"]["kebutuhan_pembiayaan"])[:10]},
        "pipeline": {s: pipeline.get(s, 0) for s in CRM_STAGES},
    }


def _csv_response(rows: list, headers: list, filename: str):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    return StreamingResponse(iter(["\ufeff" + buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@api.get("/reports/export/perumahan.csv")
async def export_perumahan(q: Optional[str] = None, kab: Optional[str] = None, deteksi: Optional[str] = None,
                           prioritas: Optional[str] = None, review: Optional[str] = None, crm: Optional[str] = None,
                           target_only: bool = False, user: dict = Depends(get_current_user)):
    targets = await target_kodes()
    f = _build_filter(q, kab, deteksi, prioritas, review, crm, None, target_only, targets)
    rows = []
    async for p in db.perumahan.find(f, LIST_PROJECTION).sort("score", -1):
        w = p.get("wilayah") or {}
        k = (p.get("kantor") or [{}])[0] if p.get("kantor") else {}
        rows.append([p["id"], p["nama"], p.get("jenis"), (p.get("pengembang") or {}).get("nama"),
                     (p.get("pengembang") or {}).get("asosiasi"), w.get("kabupaten"), w.get("kecamatan"),
                     w.get("kelurahan"), p.get("lat"), p.get("lng"), p.get("jumlah_unit"), p.get("harga_min"),
                     p.get("harga_max"), k.get("telp"), k.get("wa"), k.get("email"), p.get("score"), p.get("prioritas"),
                     p.get("deteksi") or "", p.get("review_status"), p.get("crm_status") or "",
                     p.get("tanggal_input_sumber"), p.get("first_seen_at"), (p.get("sumber") or {}).get("fetched_at"),
                     (p.get("sumber") or {}).get("url")])
    return _csv_response(rows, ["id_lokasi", "nama", "jenis", "pengembang", "asosiasi", "kabupaten", "kecamatan",
                                "kelurahan", "lat", "lng", "jumlah_unit", "harga_min", "harga_max", "telp", "whatsapp",
                                "email", "skor", "prioritas", "deteksi", "review", "crm", "tanggal_input_sumber",
                                "pertama_terdeteksi", "waktu_ambil", "sumber_url"], f"perumahan-kalsel-{today_wita()}.csv")


@api.get("/reports/export/perubahan.csv")
async def export_perubahan(days: int = Query(30, ge=1, le=3650), user: dict = Depends(get_current_user)):
    rows = [[c["detected_at"], c["perumahan_id"], c.get("nama"), c.get("kabupaten"), c.get("label"), c.get("old"),
             c.get("new")] async for c in db.perubahan.find({"detected_at": {"$gte": sk.since_iso(days)}}, {"_id": 0})
            .sort("detected_at", -1)]
    return _csv_response(rows, ["terdeteksi", "id_lokasi", "nama", "kabupaten", "perubahan", "lama", "baru"],
                         f"riwayat-perubahan-{today_wita()}.csv")


@api.get("/")
async def root():
    return {"message": "PROPERLEAD API", "status": "ok", "source": "Sikumbang"}


# ---------------------------------------------------------------------------
# Startup / seed / migration
# ---------------------------------------------------------------------------
async def migrate_and_seed():
    # Migrasi user lama (ObjectId) → id UUID & region kode
    async for u in db.users.find({"id": {"$exists": False}}):
        regions = [LEGACY_REGION_MAP.get(r, r) for r in u.get("regions") or []]
        await db.users.update_one({"_id": u["_id"]}, {"$set": {"id": new_id(), "regions": [r for r in regions if r.isdigit()],
                                                               "email_alert": u.get("email") != "marketing@properlead.id"}})
    async for u in db.users.find({"regions": {"$elemMatch": {"$not": {"$regex": r"^\d{4}$"}}}}, {"_id": 0}):
        regions = [LEGACY_REGION_MAP.get(r, r) for r in u.get("regions") or []]
        await db.users.update_one({"id": u["id"]}, {"$set": {"regions": [r for r in regions if r.isdigit()]}})
    # Bersihkan data simulasi OSS lama
    names = await db.list_collection_names()
    if "leads" in names:
        await db.leads.drop()
        await db.notifications.delete_many({"kind": {"$exists": False}})
        logger.info("Data simulasi OSS lama dihapus")
    old = await db.settings.find_one({"key": "main"})
    if old and "targets" not in old:
        await db.settings.delete_one({"key": "main"})

    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.perumahan.create_index("id", unique=True)
    for k in ["kab_kode", "deteksi", "prioritas", "score", "first_seen_at", "tanggal_input_sumber", "pengembang.nama",
              "crm_status", "next_followup", "last_seen_at"]:
        await db.perumahan.create_index(k)
    await db.perubahan.create_index([("perumahan_id", 1), ("detected_at", -1)])
    await db.perubahan.create_index("detected_at")
    await db.notifications.create_index("created_at")
    await db.plans.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.plans.create_index("id")
    await db.finance.create_index("perumahan_id", unique=True)
    await db.cron_runs.create_index("run_id", unique=True)
    await db.sync_runs.create_index("started_at")

    email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if not existing:
        await db.users.insert_one({"id": new_id(), "email": email, "password_hash": hash_password(password),
                                   "name": "Selvi Yuniastuti", "role": "super_admin", "regions": [],
                                   "email_alert": True, "active": True, "created_at": now_iso()})
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password),
                                                              "role": "super_admin"}})
    demo = "marketing@properlead.id"
    if not await db.users.find_one({"email": demo}):
        await db.users.insert_one({"id": new_id(), "email": demo, "password_hash": hash_password("Marketing2026!"),
                                   "name": "Andi Marketing", "role": "user", "regions": ["6372", "6303"],
                                   "email_alert": False, "active": True, "created_at": now_iso()})
    await get_settings()
    # Mark stale running runs
    await db.sync_runs.update_many({"status": "running"}, {"$set": {"status": "interrupted", "finished_at": now_iso()}})
    if not await sk.baseline_done():
        logger.info("Baseline Sikumbang belum lengkap — memulai baseline sync (tanpa notifikasi)")
        _bg(sk.run_sync("baseline", triggered_by="startup"))
    else:
        _bg(sk.rescore_all())  # skor bergantung waktu (recency) → segarkan saat start


app.include_router(api)

_frontend = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(CORSMiddleware, allow_origins=[_frontend, "http://localhost:3000"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await migrate_and_seed()


@app.on_event("shutdown")
async def shutdown():
    client.close()

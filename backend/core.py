"""Core: env, database, auth helpers, settings."""
from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import logging
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from fastapi import Request, HTTPException, Depends, Response
from motor.motor_asyncio import AsyncIOMotorClient

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("properlead")

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
APP_URL = os.environ.get("FRONTEND_URL", "").rstrip("/")
WITA = ZoneInfo("Asia/Makassar")

CRM_STAGES = ["NEW", "DIHUBUNGI", "RESPON", "MEETING", "PROPOSAL", "KERJASAMA"]
REVIEW_STATUSES = ["BELUM_REVIEW", "REVIEW", "LAYAK", "TIDAK_LAYAK"]

# Kabupaten/Kota di Kalimantan Selatan (kode BPS 4 digit, mengikuti wilayah Sikumbang)
KALSEL_KAB = [
    {"kode": "6371", "nama": "KOTA BANJARMASIN"},
    {"kode": "6372", "nama": "KOTA BANJARBARU"},
    {"kode": "6303", "nama": "KAB BANJAR"},
    {"kode": "6301", "nama": "KAB TANAH LAUT"},
    {"kode": "6304", "nama": "KAB BARITO KUALA"},
    {"kode": "6305", "nama": "KAB TAPIN"},
    {"kode": "6306", "nama": "KAB HULU SUNGAI SELATAN"},
    {"kode": "6307", "nama": "KAB HULU SUNGAI TENGAH"},
    {"kode": "6308", "nama": "KAB HULU SUNGAI UTARA"},
    {"kode": "6309", "nama": "KAB TABALONG"},
    {"kode": "6310", "nama": "KAB TANAH BUMBU"},
    {"kode": "6311", "nama": "KAB BALANGAN"},
    {"kode": "6302", "nama": "KAB KOTABARU"},
]
DEFAULT_TARGET = {"6371", "6372", "6303", "6301"}
LEGACY_REGION_MAP = {
    "Banjarmasin": "6371", "Banjarbaru": "6372", "Kabupaten Banjar": "6303",
    "Tanah Laut": "6301", "Barito Kuala": "6304", "Tapin": "6305",
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def today_wita() -> str:
    return datetime.now(WITA).date().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, kind: str, ttl: timedelta) -> str:
    payload = {"sub": user_id, "type": kind, "exp": now_utc() + ttl}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, user_id: str):
    response.set_cookie("access_token", create_token(user_id, "access", timedelta(hours=12)),
                        httponly=True, secure=True, samesite="lax", max_age=43200, path="/")
    response.set_cookie("refresh_token", create_token(user_id, "refresh", timedelta(days=7)),
                        httponly=True, secure=True, samesite="lax", max_age=604800, path="/")


def clean_user(u: dict) -> dict:
    u = {k: v for k, v in u.items() if k not in ("_id", "password_hash")}
    u.setdefault("email_alert", True)
    u.setdefault("regions", [])
    return u


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Belum terautentikasi")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesi kadaluarsa, silakan login ulang")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token tidak valid")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Tipe token tidak valid")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Hanya Super Admin")
    return user


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
async def get_settings() -> dict:
    doc = await db.settings.find_one({"key": "main"}, {"_id": 0})
    if not doc or "targets" not in doc:
        doc = {
            "key": "main",
            "targets": [{"kode": k["kode"], "nama": k["nama"], "target": k["kode"] in DEFAULT_TARGET}
                        for k in KALSEL_KAB],
            "email_new_listing": True,
            "telegram_enabled": True,
            "updated_at": now_iso(),
        }
        await db.settings.replace_one({"key": "main"}, doc, upsert=True)
    return doc


async def target_kodes() -> set:
    s = await get_settings()
    return {t["kode"] for t in s["targets"] if t.get("target")}

"""Notifikasi: in-app, email (Emergent managed email), Telegram, tautan Google Maps & Google Calendar."""
import os
import re
import ipaddress
from datetime import datetime, timedelta, timezone, time as dtime
from html import escape
from html.parser import HTMLParser
from typing import Optional, List
from urllib.parse import urlparse, quote, urlencode

import httpx
from fastapi import HTTPException

from core import db, logger, now_iso, new_id, APP_URL, WITA, today_wita, get_settings

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "PROPERLEAD")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")


# ---------------------------------------------------------------------------
# URL builders
# ---------------------------------------------------------------------------
def maps_url(p: dict) -> str:
    if p.get("lat") and p.get("lng"):
        return f"https://www.google.com/maps/search/?api=1&query={p['lat']},{p['lng']}"
    q = ", ".join(x for x in [p.get("nama"), (p.get("wilayah") or {}).get("kecamatan"),
                              (p.get("wilayah") or {}).get("kabupaten"), "Kalimantan Selatan"] if x)
    return f"https://www.google.com/maps/search/?api=1&query={quote(q)}"


def route_url(stops: List[dict], start: Optional[dict] = None) -> Optional[str]:
    pts = []
    for s in stops:
        if s.get("lat") and s.get("lng"):
            pts.append(f"{s['lat']},{s['lng']}")
    if not pts:
        return None
    params = {"api": "1", "travelmode": "driving", "destination": pts[-1]}
    if start and start.get("lat") and start.get("lng"):
        params["origin"] = f"{start['lat']},{start['lng']}"
    if len(pts) > 1:
        params["waypoints"] = "|".join(pts[:-1][:9])
    return "https://www.google.com/maps/dir/?" + urlencode(params, safe=",|")


def _gcal_dt(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def default_visit_start(date_str: Optional[str] = None, hhmm: str = "09:00") -> datetime:
    now = datetime.now(WITA)
    if date_str:
        d = datetime.fromisoformat(date_str).date()
    else:
        d = now.date() if now.hour < 14 else (now + timedelta(days=1)).date()
    h, m = [int(x) for x in (hhmm or "09:00").split(":")[:2]]
    return datetime.combine(d, dtime(h, m), tzinfo=WITA)


def listing_text(p: dict) -> str:
    w = p.get("wilayah") or {}
    kontak = "; ".join(" / ".join(x for x in [k.get("telp"), k.get("wa") and f"WA {k['wa']}", k.get("email")] if x)
                       for k in p.get("kantor") or [])
    return (f"Perumahan: {p.get('nama')}\nPengembang: {(p.get('pengembang') or {}).get('nama')}\n"
            f"Lokasi: {w.get('kelurahan')}, {w.get('kecamatan')}, {w.get('kabupaten')}\n"
            f"Unit: {p.get('jumlah_unit')}\nKontak: {kontak or '-'}\nID Lokasi Sikumbang: {p.get('id')}\n"
            f"Google Maps: {maps_url(p)}")


def gcal_url(p: dict, start: datetime, minutes: int = 60, note: str = "") -> str:
    end = start + timedelta(minutes=minutes)
    details = listing_text(p) + (f"\n\nCatatan: {note}" if note else "") + \
        (f"\n\nDetail di PROPERLEAD: {APP_URL}/perumahan/{p['id']}" if APP_URL else "")
    loc = f"{p['lat']},{p['lng']}" if p.get("lat") else (p.get("wilayah") or {}).get("kabupaten") or ""
    params = {"action": "TEMPLATE", "text": f"Kunjungan: {p.get('nama')}",
              "dates": f"{_gcal_dt(start)}/{_gcal_dt(end)}", "details": details, "location": loc,
              "ctz": "Asia/Makassar"}
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


def _ics_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_ics(events: List[dict]) -> str:
    """events: [{uid, start(datetime), minutes, title, description, location, lat, lng}]"""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PROPERLEAD//Rencana Kunjungan//ID",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    stamp = _gcal_dt(datetime.now(WITA))
    for e in events:
        end = e["start"] + timedelta(minutes=e.get("minutes", 60))
        lines += ["BEGIN:VEVENT", f"UID:{e['uid']}@properlead", f"DTSTAMP:{stamp}",
                  f"DTSTART:{_gcal_dt(e['start'])}", f"DTEND:{_gcal_dt(end)}",
                  f"SUMMARY:{_ics_escape(e['title'])}", f"DESCRIPTION:{_ics_escape(e.get('description', ''))}",
                  f"LOCATION:{_ics_escape(e.get('location', ''))}"]
        if e.get("lat"):
            lines.append(f"GEO:{e['lat']};{e['lng']}")
        lines += ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Pengingat kunjungan PROPERLEAD",
                  "TRIGGER:-PT30M", "END:VALARM", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


# ---------------------------------------------------------------------------
# Email guardrail gate (Emergent managed email playbook)
# ---------------------------------------------------------------------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        raise HTTPException(status_code=500, detail="Email belum dikonfigurasi")
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            resp = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY},
                                json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        try:
            code = e.response.json().get("code", "")
        except ValueError:
            code = ""
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
            logger.warning(f"Email paused: {code} ({e.response.status_code})")
            raise HTTPException(status_code=503, detail="Layanan email sementara tidak tersedia")
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="Gagal mengirim email")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email send error: {e}")
        raise HTTPException(status_code=500, detail="Gagal mengirim email")


async def safe_send(to: str, subject: str, html: str) -> bool:
    try:
        await send_email(to=to, subject=subject, html=html)
        await db.email_log.insert_one({"id": new_id(), "to": to, "subject": subject, "sent_at": now_iso(), "ok": True})
        return True
    except Exception as e:
        logger.warning(f"Email ke {to} gagal: {getattr(e, 'detail', e)}")
        await db.email_log.insert_one({"id": new_id(), "to": to, "subject": subject, "sent_at": now_iso(),
                                       "ok": False, "error": str(getattr(e, 'detail', e))[:200]})
        return False


# ---------------------------------------------------------------------------
# Email templates (server-side, semua tautan menuju domain aplikasi)
# ---------------------------------------------------------------------------
def rupiah(v) -> str:
    if not v:
        return "-"
    return "Rp" + f"{int(v):,}".replace(",", ".")


def _btn(href: str, label: str, color: str) -> str:
    return (f'<a href="{escape(href)}" style="display:inline-block;background:{color};color:#ffffff;'
            f'text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:bold;'
            f'margin:4px 6px 4px 0">{escape(label)}</a>')


def listing_card_html(p: dict, date_str: Optional[str] = None) -> str:
    w = p.get("wilayah") or {}
    tipe_rows = "".join(
        f'<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">Tipe {escape(str(t["nama"]))} '
        f'({escape(str(t["status"]))})</td><td style="padding:4px 8px;border-bottom:1px solid #eee">'
        f'{t.get("luas_bangunan") or "-"}/{t.get("luas_tanah") or "-"} m²</td>'
        f'<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">{rupiah(t.get("harga"))}</td></tr>'
        for t in (p.get("tipe_rumah") or [])[:6]) or \
        '<tr><td style="padding:4px 8px;color:#888" colspan="3">Tipe/harga belum ditampilkan di Sikumbang</td></tr>'
    kontak = "".join(
        f'<div style="font-size:13px;color:#334155;margin-top:2px">{escape(k.get("alamat") or "")}'
        f'{" · Telp " + escape(k["telp"]) if k.get("telp") else ""}'
        f'{" · WA " + escape(k["wa"]) if k.get("wa") else ""}'
        f'{" · " + escape(k["email"]) if k.get("email") else ""}</div>'
        for k in (p.get("kantor") or [])[:2]) or '<div style="font-size:13px;color:#888">Kontak belum tersedia</div>'
    pid = quote(p["id"])
    q = f"?date={date_str}" if date_str else ""
    buttons = (_btn(f"{APP_URL}/api/go/maps/{pid}", "Buka di Google Maps", "#1A73E8") +
               _btn(f"{APP_URL}/rencana?add={pid}", "Tambah ke Rencana Kunjungan Hari Ini", "#065F46") +
               _btn(f"{APP_URL}/api/go/calendar/{pid}{q}", "Tambah ke Google Kalender", "#D97706") +
               _btn(f"{APP_URL}/perumahan/{pid}", "Lihat Detail", "#0F172A"))
    return f"""
<table role="presentation" width="100%" style="border:1px solid #e2e8f0;border-radius:12px;margin:0 0 16px 0">
<tr><td style="padding:16px">
  <div style="font-size:11px;color:#065F46;font-weight:bold;letter-spacing:1px">PRIORITAS {escape(p.get('prioritas') or '-')} · SKOR {p.get('score', 0)}</div>
  <div style="font-size:18px;font-weight:bold;color:#0f172a;margin-top:4px">{escape(p.get('nama') or '-')}</div>
  <div style="font-size:13px;color:#475569;margin-top:2px">{escape((p.get('pengembang') or {}).get('nama') or '-')} {('· ' + escape(p['pengembang']['asosiasi'])) if (p.get('pengembang') or {}).get('asosiasi') else ''}</div>
  <div style="font-size:13px;color:#475569;margin-top:6px">📍 {escape(w.get('kelurahan') or '-')}, {escape(w.get('kecamatan') or '-')}, {escape(w.get('kabupaten') or '-')}</div>
  <div style="font-size:13px;color:#475569;margin-top:2px">{escape(p.get('jenis') or '-')} · {p.get('jumlah_unit', 0)} unit · ID Lokasi {escape(p['id'])}</div>
  <table role="presentation" width="100%" style="margin-top:10px;font-size:13px;color:#334155;border-collapse:collapse">{tipe_rows}</table>
  <div style="margin-top:10px;font-size:12px;font-weight:bold;color:#0f172a">Kantor pemasaran</div>{kontak}
  <div style="margin-top:12px">{buttons}</div>
</td></tr></table>"""


def wrap_email(title: str, intro: str, body: str) -> str:
    return f"""<table role="presentation" width="100%" style="background:#f8fafc"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:640px;background:#ffffff;border-radius:14px;font-family:Arial,Helvetica,sans-serif">
<tr><td style="background:#0F172A;padding:18px 22px;border-radius:14px 14px 0 0">
<span style="color:#ffffff;font-size:20px;font-weight:bold">PROPER</span><span style="color:#F59E0B;font-size:20px;font-weight:bold">LEAD</span>
<div style="color:#94a3b8;font-size:11px;letter-spacing:1px">PROJECT &amp; FINANCE INTELLIGENCE</div></td></tr>
<tr><td style="padding:22px">
<div style="font-size:20px;font-weight:bold;color:#0f172a">{escape(title)}</div>
<p style="font-size:14px;color:#475569;line-height:1.5">{intro}</p>
{body}
<p style="font-size:11px;color:#94a3b8;line-height:1.5;margin-top:18px">Sumber data: portal publik Sikumbang (Kementerian PUPR/BP Tapera). PROPERLEAD hanya menampilkan perubahan yang terdeteksi dari sumber; listing baru tidak otomatis berarti izin baru terbit atau developer membutuhkan pembiayaan.<br>Dikirim otomatis oleh {escape(EMAIL_FROM_NAME)}. Kami tidak pernah meminta password melalui email.</p>
</td></tr></table></td></tr></table>"""


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------
async def send_telegram(text: str) -> bool:
    token, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"https://api.telegram.org/bot{token}/sendMessage",
                             json={"chat_id": chat, "text": text[:4000], "parse_mode": "HTML",
                                   "disable_web_page_preview": True})
        r.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Telegram gagal: {e}")
        return False


# ---------------------------------------------------------------------------
# In-app notifications
# ---------------------------------------------------------------------------
async def create_notification(kind: str, judul: str, pesan: str, perumahan_id: Optional[str] = None,
                              kab_kode: Optional[str] = None):
    doc = {"id": new_id(), "kind": kind, "judul": judul, "pesan": pesan, "perumahan_id": perumahan_id,
           "kab_kode": kab_kode, "read_by": [], "created_at": now_iso()}
    await db.notifications.insert_one(dict(doc))
    return doc


def _user_wants(user: dict, kab_kode: str, targets: set) -> bool:
    regions = user.get("regions") or []
    if regions:
        return kab_kode in regions
    return kab_kode in targets


async def recipients_for(kab_kode: str, targets: set) -> list:
    users = await db.users.find({"active": True, "email_alert": {"$ne": False}}, {"_id": 0}).to_list(500)
    return [u for u in users if _user_wants(u, kab_kode, targets)]


async def email_new_listings(user: dict, listings: list) -> bool:
    listings = sorted(listings, key=lambda x: -(x.get("score") or 0))
    shown = listings[:15]
    more = len(listings) - len(shown)
    first = shown[0]
    if len(listings) == 1:
        subject = f"Perumahan baru di Sikumbang: {first['nama']} — {(first.get('wilayah') or {}).get('kabupaten')}"
    else:
        subject = f"{len(listings)} perumahan baru terdaftar di Sikumbang (Kalimantan Selatan)"
    body = "".join(listing_card_html(p) for p in shown)
    if more > 0:
        body += f'<p style="font-size:13px;color:#475569">Dan {more} perumahan lainnya. {_btn(APP_URL + "/perumahan?deteksi=NEW_LISTING", "Lihat semua listing baru", "#0F172A")}</p>'
    intro = (f"Halo {escape(user.get('name') or '')}, sistem mendeteksi listing perumahan baru di Sikumbang "
             f"untuk wilayah Anda. Klik <b>Buka di Google Maps</b> untuk navigasi, atau tambahkan ke rencana "
             f"kunjungan & Google Kalender.")
    return await safe_send(user["email"], subject, wrap_email("Listing perumahan baru terdeteksi", intro, body))


async def dispatch_sync_notifications(new_docs: list, changed: list, targets: set):
    settings = await get_settings()
    for d in new_docs:
        w = d.get("wilayah") or {}
        await create_notification("NEW_LISTING", f"Listing baru: {d['nama']}",
                                  f"{(d.get('pengembang') or {}).get('nama')} · {w.get('kabupaten')} · {d.get('jumlah_unit')} unit",
                                  d["id"], d.get("kab_kode"))
    for c in changed[:50]:
        labels = ", ".join(sorted({x["label"] for x in c["changes"]}))[:160]
        await create_notification("DATA_UPDATED", f"Data berubah: {c['nama']}", f"{c['kabupaten']} · {labels}",
                                  c["id"], c.get("kab_kode"))
    # Email per user (digabung per sinkronisasi agar tidak spam)
    if new_docs and settings.get("email_new_listing", True):
        fresh = [await db.perumahan.find_one({"id": d["id"]}, {"_id": 0}) or d for d in new_docs]
        users = await db.users.find({"active": True, "email_alert": {"$ne": False}}, {"_id": 0}).to_list(500)
        for u in users:
            mine = [d for d in fresh if _user_wants(u, d.get("kab_kode"), targets)]
            if mine:
                await email_new_listings(u, mine)
    if settings.get("telegram_enabled", True):
        for d in new_docs[:10]:
            w = d.get("wilayah") or {}
            await send_telegram(
                "🏠 <b>LISTING BARU SIKUMBANG</b>\n"
                f"{escape(d['nama'])}\nPengembang: {escape((d.get('pengembang') or {}).get('nama') or '-')}\n"
                f"Lokasi: {escape(w.get('kecamatan') or '-')}, {escape(w.get('kabupaten') or '-')}\n"
                f"Unit: {d.get('jumlah_unit')} · Prioritas {d.get('prioritas')} ({d.get('score')})\n"
                f"Maps: {maps_url(d)}")
        if changed:
            await send_telegram(f"🟠 <b>{len(changed)} perumahan berubah datanya</b> di Sikumbang. Cek PROPERLEAD.")


# ---------------------------------------------------------------------------
# Daily digest
# ---------------------------------------------------------------------------
async def run_daily_digest(only_user: Optional[dict] = None) -> dict:
    from sikumbang import since_iso
    from core import target_kodes
    targets = await target_kodes()
    since = since_iso(1)
    new_l = await db.perumahan.find({"deteksi": "NEW_LISTING", "first_seen_at": {"$gte": since}}, {"_id": 0}).to_list(200)
    chg = await db.perubahan.find({"detected_at": {"$gte": since}}, {"_id": 0}).to_list(500)
    today = today_wita()
    users = [only_user] if only_user else await db.users.find(
        {"active": True, "email_alert": {"$ne": False}}, {"_id": 0}).to_list(500)
    sent = []
    for u in users:
        mine_new = [p for p in new_l if _user_wants(u, p.get("kab_kode"), targets)]
        chg_ids = {c["perumahan_id"] for c in chg}
        mine_chg = await db.perumahan.find({"id": {"$in": list(chg_ids)}}, {"_id": 0, "id": 1, "nama": 1,
                                           "kab_kode": 1, "wilayah": 1}).to_list(500)
        mine_chg = [p for p in mine_chg if _user_wants(u, p.get("kab_kode"), targets)]
        fu = await db.perumahan.find({"next_followup": {"$lte": today, "$ne": None}}, {"_id": 0, "id": 1, "nama": 1,
                                     "next_followup": 1}).to_list(50)
        plan = await db.plans.find_one({"user_id": u["id"], "date": today}, {"_id": 0})
        n_stops = len((plan or {}).get("stops") or [])
        if not (mine_new or mine_chg or fu or n_stops) and not only_user:
            continue
        body = f"""<table role="presentation" width="100%" style="font-size:14px;color:#0f172a;margin-bottom:12px">
<tr><td style="padding:8px;background:#ecfdf5;border-radius:8px"><b>{len(mine_new)}</b> listing baru (24 jam)</td>
<td style="padding:8px;background:#fff7ed;border-radius:8px"><b>{len(mine_chg)}</b> perumahan berubah data</td>
<td style="padding:8px;background:#eff6ff;border-radius:8px"><b>{len(fu)}</b> follow-up jatuh tempo</td>
<td style="padding:8px;background:#f1f5f9;border-radius:8px"><b>{n_stops}</b> kunjungan hari ini</td></tr></table>"""
        body += "".join(listing_card_html(p) for p in mine_new[:8])
        if mine_chg:
            body += '<div style="font-weight:bold;margin:10px 0 4px">Perubahan data</div>' + "".join(
                f'<div style="font-size:13px;color:#334155">• <a href="{APP_URL}/perumahan/{quote(p["id"])}" style="color:#065F46">'
                f'{escape(p["nama"])}</a> — {escape((p.get("wilayah") or {}).get("kabupaten") or "")}</div>'
                for p in mine_chg[:15])
        if fu:
            body += '<div style="font-weight:bold;margin:10px 0 4px">Follow-up jatuh tempo</div>' + "".join(
                f'<div style="font-size:13px;color:#334155">• <a href="{APP_URL}/perumahan/{quote(p["id"])}" style="color:#065F46">'
                f'{escape(p["nama"])}</a> ({escape(p["next_followup"])})</div>' for p in fu[:15])
        body += f'<div style="margin-top:14px">{_btn(APP_URL + "/rencana", "Buka Rencana Kunjungan Hari Ini", "#065F46")}</div>'
        ok = await safe_send(u["email"], f"Ringkasan harian PROPERLEAD — {today}",
                             wrap_email("Ringkasan harian", f"Halo {escape(u.get('name') or '')}, berikut ringkasan data Sikumbang & tindak lanjut Anda.", body))
        if ok:
            sent.append(u["email"])
    await send_telegram(f"📊 <b>Ringkasan harian {today}</b>\nListing baru 24 jam: {len(new_l)}\n"
                        f"Perubahan data: {len({c['perumahan_id'] for c in chg})} perumahan")
    return {"sent_to": sent, "new_listings": len(new_l), "changes": len(chg)}

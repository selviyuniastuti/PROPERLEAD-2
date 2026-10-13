"""PROPERLEAD (Sikumbang) backend API tests.

Covers: auth, dashboard, perumahan + filters + CSV, detail, perubahan,
developers, finance, plans + optimize + ics + public redirects, cron auth,
notifications, users RBAC, settings, CRM board, followups, reports.

NOTE: Avoid real-email endpoints (/api/digest/run, /api/plans/{date}/email,
/api/perumahan/{id}/email-me) and /api/sync/run mode=full.
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or
            open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "selviyuniastuti6@gmail.com"
ADMIN_PASS = "Properlead2026!"
MKT_EMAIL = "marketing@properlead.id"
MKT_PASS = "Marketing2026!"
CRON_SECRET = open("/app/backend/.env").read().split('WEBHOOK_CRON_SECRET="')[1].split('"')[0]


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s, r.json()


@pytest.fixture(scope="session")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="session")
def mkt():
    return _login(MKT_EMAIL, MKT_PASS)


@pytest.fixture(scope="session")
def sample_pid(admin):
    s, _ = admin
    r = s.get(f"{API}/perumahan", params={"limit": 1}, timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "no perumahan rows found"
    return items[0]["id"]


@pytest.fixture(scope="session")
def plan_date_id(admin, sample_pid):
    """Ensure today's plan exists with at least sample_pid as a stop; returns (date, plan_id)."""
    s, _ = admin
    r = s.post(f"{API}/plans/today/add", json={"perumahan_id": sample_pid}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    return d["date"], d.get("id")


# ---------- Auth ----------
class TestAuth:
    def test_login_admin(self, admin):
        s, u = admin
        assert "access_token" in s.cookies
        assert u["email"] == ADMIN_EMAIL
        assert u["role"] == "super_admin"

    def test_login_marketing(self, mkt):
        s, u = mkt
        assert u["role"] == "user"

    def test_login_bad(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "bad"}, timeout=15)
        assert r.status_code == 401

    def test_me(self, admin):
        s, _ = admin
        r = s.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_prefs_update(self, admin):
        s, _ = admin
        r = s.put(f"{API}/auth/me/prefs", json={"email_alert": True}, timeout=15)
        assert r.status_code == 200
        assert r.json()["email_alert"] is True


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard_shape(self, admin):
        s, _ = admin
        r = s.get(f"{API}/dashboard", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["total", "target", "new_7d", "changed_7d", "prioritas", "pipeline",
                  "per_kabupaten", "latest_new", "latest_source", "latest_changes", "last_sync"]:
            assert k in d, f"missing key {k}"
        assert d["total"] >= 1000, f"expected >=1000 perumahan, got {d['total']}"
        assert set(["A", "B", "C"]).issubset(d["prioritas"].keys())


# ---------- Sync status ----------
class TestSyncStatus:
    def test_status(self, admin):
        s, _ = admin
        r = s.get(f"{API}/sync/status", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "running" in d and "total_perumahan" in d
        assert d["source"].startswith("https://sikumbang")

    def test_full_sync_forbidden_mkt(self, mkt):
        s, _ = mkt
        r = s.post(f"{API}/sync/run", json={"mode": "full"}, timeout=15)
        assert r.status_code == 403


# ---------- Wilayah ----------
class TestWilayah:
    def test_wilayah_list(self, admin):
        s, _ = admin
        r = s.get(f"{API}/wilayah", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 10
        assert all("kode" in w and "nama" in w and "target" in w for w in rows)


# ---------- Perumahan ----------
class TestPerumahan:
    def test_list_default(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan", params={"limit": 10}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["total"] >= 1000
        assert len(d["items"]) == 10

    def test_filter_kab(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan", params={"kab": "6372", "limit": 5}, timeout=20)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["kab_kode"] == "6372"

    def test_filter_new_listing(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan", params={"deteksi": "NEW_LISTING", "limit": 5}, timeout=20)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["deteksi"] == "NEW_LISTING"

    def test_filter_prioritas_A(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan", params={"prioritas": "A", "limit": 5}, timeout=20)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["prioritas"] == "A"

    def test_filter_target_only(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan", params={"target_only": "true", "limit": 5}, timeout=20)
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_search_q(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan", params={"q": "Griya", "limit": 5}, timeout=20)
        assert r.status_code == 200
        # Not asserting count — just ensure no error and shape ok
        assert "items" in r.json()

    def test_sort_variants(self, admin):
        s, _ = admin
        for sort in ["skor", "sumber_terbaru", "terbaru", "unit", "nama"]:
            r = s.get(f"{API}/perumahan", params={"sort": sort, "limit": 3}, timeout=20)
            assert r.status_code == 200, f"sort {sort} failed: {r.text}"

    def test_pagination(self, admin):
        s, _ = admin
        r1 = s.get(f"{API}/perumahan", params={"page": 1, "limit": 5}, timeout=20).json()
        r2 = s.get(f"{API}/perumahan", params={"page": 2, "limit": 5}, timeout=20).json()
        assert r1["items"][0]["id"] != r2["items"][0]["id"]

    def test_detail(self, admin, sample_pid):
        s, _ = admin
        pid = sample_pid
        r = s.get(f"{API}/perumahan/{pid}", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == pid
        assert "perubahan" in d
        assert "maps_url" in d and d["maps_url"].startswith("https://")
        assert "gcal_url" in d and "calendar.google.com" in d["gcal_url"]

    def test_detail_known_ids(self, admin):
        s, _ = admin
        # one of the simulated listings per prior test state
        for pid in ["MTP0520362026T006", "BJB0210062026T004"]:
            r = s.get(f"{API}/perumahan/{pid}", timeout=20)
            # may or may not exist depending on live data, 200 or 404
            assert r.status_code in (200, 404), f"{pid}: {r.status_code}"

    def test_detail_404(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan/NONEXISTENT_XYZ", timeout=10)
        assert r.status_code == 404

    def test_map(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perumahan/map", params={"target_only": "true"}, timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        if rows:
            assert "lat" in rows[0] and "lng" in rows[0]


# ---------- CSV export ----------
class TestExport:
    def test_export_perumahan(self, admin):
        s, _ = admin
        r = s.get(f"{API}/reports/export/perumahan.csv", params={"target_only": "true"},
                  timeout=60, stream=True)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        head = next(r.iter_lines()).decode("utf-8", "ignore")
        assert "id_lokasi" in head and "nama" in head

    def test_export_perubahan(self, admin):
        s, _ = admin
        r = s.get(f"{API}/reports/export/perubahan.csv", timeout=30)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")


# ---------- Perubahan listing ----------
class TestPerubahan:
    def test_list_perubahan(self, admin):
        s, _ = admin
        r = s.get(f"{API}/perubahan", params={"days": 30}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total" in d


# ---------- Developers ----------
class TestDevelopers:
    def test_list_developers(self, admin):
        s, _ = admin
        r = s.get(f"{API}/developers", params={"limit": 5}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and len(d["items"]) >= 1
        pytest.sample_dev = d["items"][0]["nama"]

    def test_developer_detail(self, admin):
        s, _ = admin
        name = getattr(pytest, "sample_dev", None)
        assert name
        r = s.get(f"{API}/developers/detail", params={"nama": name}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["nama"] == name
        assert "proyek" in d

    def test_developer_detail_404(self, admin):
        s, _ = admin
        r = s.get(f"{API}/developers/detail", params={"nama": "TEST_NONEXISTENT"}, timeout=10)
        assert r.status_code == 404


# ---------- Finance ----------
class TestFinance:
    def test_calc(self, admin):
        s, _ = admin
        payload = {"jumlah_unit": 50, "harga_jual_per_unit": 400_000_000, "biaya_per_unit": 250_000_000,
                   "biaya_tanah": 2_000_000_000, "biaya_infrastruktur": 500_000_000,
                   "durasi_bulan": 12, "penjualan_bulan_mulai": 1, "self_funding_pct": 30}
        r = s.post(f"{API}/finance/calc", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["potensi_penjualan"] == 50 * 400_000_000
        assert "total_biaya" in d and "selisih_penjualan_biaya" in d
        assert "margin_pct" in d and "kebutuhan_pembiayaan" in d
        assert "cashflow" in d and isinstance(d["cashflow"], list)

    def test_defaults_and_save(self, admin, sample_pid):
        s, _ = admin
        pid = sample_pid
        rd = s.get(f"{API}/finance/{pid}/defaults", timeout=15)
        assert rd.status_code == 200
        inp = rd.json()["input"]
        # Save
        rs = s.put(f"{API}/finance/{pid}", json=inp, timeout=15)
        assert rs.status_code == 200
        # Fetch back
        rg = s.get(f"{API}/finance/{pid}", timeout=15)
        assert rg.status_code == 200
        d = rg.json()
        assert d["saved"] is True
        assert d["perumahan_id"] == pid

    def test_list(self, admin):
        s, _ = admin
        r = s.get(f"{API}/finance", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- CRM / Review / Aktivitas / Plans ----------
class TestReviewCRM:
    def test_review_and_crm_flow(self, admin, sample_pid):
        s, _ = admin
        pid = sample_pid
        # Review LAYAK → crm_status NEW auto
        r = s.put(f"{API}/perumahan/{pid}/review",
                  json={"review_status": "LAYAK", "catatan": "TEST layak"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["review_status"] == "LAYAK"
        assert d["crm_status"] in ("NEW", "DIHUBUNGI", "RESPON", "MEETING", "PROPOSAL", "KERJASAMA")
        # Move to MEETING
        r2 = s.put(f"{API}/perumahan/{pid}/crm", json={"crm_status": "MEETING"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["crm_status"] == "MEETING"
        # Add aktivitas with follow-up
        r3 = s.post(f"{API}/perumahan/{pid}/aktivitas",
                    json={"tipe": "telepon", "catatan": "TEST call",
                          "tanggal_followup": "2026-02-15"}, timeout=15)
        assert r3.status_code == 200
        # Confirm next_followup set
        rd = s.get(f"{API}/perumahan/{pid}", timeout=15).json()
        assert rd.get("next_followup") == "2026-02-15"


class TestCRMBoard:
    def test_board(self, admin):
        s, _ = admin
        r = s.get(f"{API}/crm/board", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "stages" in d and "columns" in d
        for st in d["stages"]:
            assert st in d["columns"]

    def test_followups(self, admin):
        s, _ = admin
        r = s.get(f"{API}/followups", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Plans ----------
class TestPlans:
    def test_get_today(self, admin, plan_date_id):
        s, _ = admin
        r = s.get(f"{API}/plans/today", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "stops" in d and "date" in d and "route_url" in d

    def test_add_perumahan_to_plan(self, admin, sample_pid):
        s, _ = admin
        pid = sample_pid
        r = s.post(f"{API}/plans/today/add", json={"perumahan_id": pid}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert any(st["perumahan_id"] == pid for st in d["stops"])

    def test_optimize_plan(self, admin, plan_date_id):
        s, _ = admin
        date, _ = plan_date_id
        r = s.post(f"{API}/plans/{date}/optimize", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "stops" in d

    def test_ics_download(self, admin, plan_date_id):
        s, _ = admin
        date, _ = plan_date_id
        r = s.get(f"{API}/plans/{date}/ics", timeout=20)
        assert r.status_code == 200
        assert "text/calendar" in r.headers.get("content-type", "")
        text = r.text
        assert "BEGIN:VEVENT" in text and "VALARM" in text

    def test_list_plans(self, admin):
        s, _ = admin
        r = s.get(f"{API}/plans", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Public redirect links ----------
class TestPublicRedirects:
    def test_go_maps(self, sample_pid):
        pid = sample_pid
        r = requests.get(f"{API}/go/maps/{pid}", timeout=15, allow_redirects=False)
        assert r.status_code == 302
        assert "google.com/maps" in r.headers.get("location", "")

    def test_go_calendar(self, sample_pid):
        pid = sample_pid
        r = requests.get(f"{API}/go/calendar/{pid}",
                         params={"date": "2026-10-20", "time": "10:00"},
                         timeout=15, allow_redirects=False)
        assert r.status_code == 302
        loc = r.headers.get("location", "")
        assert "calendar.google.com" in loc and "TEMPLATE" in loc.upper()

    def test_go_route(self, plan_date_id):
        _, plan_id = plan_date_id
        if not plan_id:
            pytest.skip("no plan id")
        r = requests.get(f"{API}/go/route/{plan_id}", timeout=15, allow_redirects=False)
        assert r.status_code in (302, 404)
        if r.status_code == 302:
            assert "google.com/maps" in r.headers.get("location", "")

    def test_go_unknown_404(self):
        r = requests.get(f"{API}/go/maps/NOPE_XYZ", timeout=10, allow_redirects=False)
        assert r.status_code == 404


# ---------- Cron endpoints ----------
class TestCron:
    def test_cron_sync_no_auth_401(self):
        r = requests.post(f"{API}/cron/sikumbang-sync", json={}, timeout=15)
        assert r.status_code == 401

    def test_cron_sync_bad_token(self):
        r = requests.post(f"{API}/cron/sikumbang-sync", json={},
                          headers={"Authorization": "Bearer wrong"}, timeout=15)
        assert r.status_code == 401

    def test_cron_sync_valid_token(self):
        rid = f"test-{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/cron/sikumbang-sync",
                          json={"run_id": rid},
                          headers={"Authorization": f"Bearer {CRON_SECRET}",
                                   "X-Webhook-Id": rid}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"
        # duplicate still 200
        r2 = requests.post(f"{API}/cron/sikumbang-sync",
                           json={"run_id": rid},
                           headers={"Authorization": f"Bearer {CRON_SECRET}",
                                    "X-Webhook-Id": rid}, timeout=15)
        assert r2.status_code == 200


# ---------- Notifications ----------
class TestNotifications:
    def test_list(self, admin):
        s, _ = admin
        r = s.get(f"{API}/notifications", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "unread" in d

    def test_mark_read_all(self, admin):
        s, _ = admin
        r = s.put(f"{API}/notifications/read-all", timeout=15)
        assert r.status_code == 200
        rl = s.get(f"{API}/notifications", timeout=15).json()
        assert rl["unread"] == 0


# ---------- Users (admin RBAC) ----------
class TestUsers:
    def test_list_admin(self, admin):
        s, _ = admin
        r = s.get(f"{API}/users", timeout=15)
        assert r.status_code == 200
        assert len(r.json()) >= 2

    def test_mkt_forbidden(self, mkt):
        s, _ = mkt
        r = s.get(f"{API}/users", timeout=15)
        assert r.status_code == 403

    def test_crud(self, admin):
        s, _ = admin
        email = f"TEST_user_{uuid.uuid4().hex[:6]}@properlead.id"
        cr = s.post(f"{API}/users", json={
            "email": email, "password": "Password2026!",
            "name": "TEST User", "role": "user", "regions": ["6372"]
        }, timeout=15)
        assert cr.status_code == 200, cr.text
        uid = cr.json()["id"]
        assert cr.json()["regions"] == ["6372"]
        u = s.put(f"{API}/users/{uid}", json={"active": False}, timeout=15)
        assert u.status_code == 200 and u.json()["active"] is False
        dr = s.delete(f"{API}/users/{uid}", timeout=15)
        assert dr.status_code == 200


# ---------- Settings ----------
class TestSettings:
    def test_get(self, admin):
        s, _ = admin
        r = s.get(f"{API}/settings", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "targets" in d

    def test_put_admin(self, admin):
        s, _ = admin
        cur = s.get(f"{API}/settings", timeout=15).json()
        r = s.put(f"{API}/settings", json={
            "targets": cur["targets"],
            "email_new_listing": cur.get("email_new_listing", True),
            "telegram_enabled": cur.get("telegram_enabled", True)
        }, timeout=20)
        assert r.status_code == 200

    def test_put_mkt_forbidden(self, mkt):
        s, _ = mkt
        r = s.put(f"{API}/settings", json={"targets": [], "email_new_listing": True, "telegram_enabled": True},
                  timeout=15)
        assert r.status_code == 403


# ---------- Reports ----------
class TestReports:
    def test_summary(self, admin):
        s, _ = admin
        r = s.get(f"{API}/reports/summary", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["per_kabupaten", "bulanan_sumber", "jenis_perubahan_30d", "top_developer", "finance", "pipeline"]:
            assert k in d

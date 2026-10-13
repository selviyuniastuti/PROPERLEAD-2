# PRD — PROPERLEAD (Project & Finance Intelligence) — v2 Sikumbang

## Problem Statement
Marketing bank ingin langsung tahu bila ada perumahan baru terdaftar di Sikumbang (sikumbang.tapera.go.id) wilayah Kalimantan Selatan, menerima notifikasi via Gmail berisi detail perumahan, klik langsung ke Google Maps, dan menyusun rencana kunjungan harian (rute multi-titik) + pengingat Google Kalender. Alur: Sikumbang → Data Collector → Database Perumahan → Filter & Deteksi Perubahan → Dashboard Lead → Project Finance → CRM & Follow-up → Laporan & Notifikasi.

## User choices
- Data: endpoint publik yang dipakai portal Sikumbang (tanpa login), pelan, tiap 30 menit, sumber+waktu dicatat.
- Tulis ulang total tetap di stack Emergent (React + FastAPI + MongoDB). Fitur OSS/KKPR simulasi DIHAPUS.
- Notifikasi Gmail (Emergent managed email) + Google Kalender (link template + .ics, tanpa OAuth).
- Lingkup: semua sekaligus termasuk Project Finance.

## Architecture
- backend/core.py (db, auth JWT cookie, settings, kab Kalsel), sikumbang.py (collector, normalisasi, snapshot diff, scoring), notify.py (email gate+template, Telegram, in-app, Google Maps/Calendar URL, ICS, digest), finance.py (simulasi cash flow), server.py (routes /api).
- Collections: users, perumahan (id = idLokasi), perubahan, sync_runs, notifications (read_by), plans (user_id+date), finance (perumahan_id), settings, cron_runs, email_log.
- Crons (.emergent/crons.yml): sikumbang-sync */30, sikumbang-full 03:00 WITA, daily-digest 07:30 WITA.
- Email links all point to app domain: /api/go/maps/{id}, /api/go/calendar/{id}, /api/go/route/{plan_id}, /rencana?add={id}, /perumahan/{id}.

## Implemented (2026-10-13)
- Baseline 1.693 perumahan Kalsel (tanpa notifikasi); incremental 200 terbaru; full scan + delisting; riwayat perubahan (harga per tipe, unit, kontak, nama, aktivasi, koordinat, foto, unit status).
- Skor prioritas berbasis data nyata (target +30, baru +25, skala unit +15, kontak +15, berubah +10, harga +5) A≥70/B≥55/C.
- Halaman: Dashboard, Daftar Perumahan (filter/sort/pagination/CSV), Detail (ringkasan, unit&harga + status unit dari Sikumbang, riwayat, CRM, finance), Developer list/detail, Rencana Kunjungan (tambah/urut/optimalkan/rute Maps/ICS/Gmail/visited→CRM), CRM kanban + follow-up jatuh tempo, Project Finance, Peta, Laporan, Notifikasi, Users, Wilayah & Collector.

## Backlog
- P1: Google Calendar API (OAuth) untuk auto-insert event (saat ini via link template/.ics).
- P1: Isi TELEGRAM_TOKEN/CHAT_ID.
- P2: Multi-skenario finance, ekspor PDF laporan, WhatsApp follow-up template.

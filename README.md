# Workflow Sentinel (PoC)

Aplikasi approval workflow internal: cuti/izin, akses IT, dan permintaan pembelian.

## Struktur

- `packages/engine`: mesin alur tanpa I/O (definisi, tabel aturan, routing, pemisahan tugas, SLA, simulasi, versi).
- `apps/api`: Cloudflare Worker (Hono) dengan D1, R2, Cron Trigger, adapter ERP/email, dan penyusun draf AI.
- `apps/web`: React + Vite (kotak masuk, permintaan, editor visual, chat).

## Menjalankan secara lokal

```bash
npm install
npm test            # 69 test
npm run db:setup    # buat database lokal + data contoh
npm run dev         # http://localhost:8787
```

Akun contoh (password `demo1234`): `budi@contoh.test` (pemohon), `maya@contoh.test` (atasan),
`fajar@contoh.test` (finance), `irfan@contoh.test` (IT, admin), `hana@contoh.test` (HR, admin),
`dewi@contoh.test` (direktur, admin).

Chat AI butuh file `apps/api/.dev.vars`:

```
AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/anthropic
ANTHROPIC_API_KEY=...
```

## Deploy ke Cloudflare

```bash
cd apps/api
npx wrangler d1 create sentinel --location apac     # salin database_id ke wrangler.jsonc
npx wrangler r2 bucket create sentinel-files
npx wrangler d1 migrations apply sentinel --remote
npx wrangler secret put ANTHROPIC_API_KEY
cd ../.. && npm run deploy
```

Isi `AI_GATEWAY_URL` di `wrangler.jsonc`. Direktori karyawan diimpor lewat
`POST /api/admin/directory` (CSV: `id,email,name,department,manager_id,roles,is_admin`, peran dipisah `|`).

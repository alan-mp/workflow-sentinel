# Workflow Sentinel (PoC)

Aplikasi approval workflow internal: cuti/izin, akses IT, dan permintaan pembelian.

## Struktur

- `packages/engine`: mesin alur tanpa I/O (definisi, tabel aturan, routing, pemisahan tugas, SLA, simulasi, versi).
  Kondisi dan tabel aturan dievaluasi oleh [json-rules-engine](https://github.com/CacheControl/json-rules-engine) (versi dikunci) lewat `src/rules.ts`;
  browser hanya memakai `@sentinel/engine/model` (bentuk definisi dan pemeriksaannya), evaluasi aturan hanya di server.
- `apps/api`: Cloudflare Worker (Hono) dengan D1, R2, Cron Trigger, adapter ERP/email, dan penyusun draf AI.
- `apps/web`: React + Vite (kotak masuk, permintaan, editor visual, chat).

## Menjalankan secara lokal

```bash
npm install
npm test
npm run db:setup    # buat database lokal + data contoh
npm run dev         # http://localhost:8787
```

Akun contoh (password `demo1234`): `budi@contoh.test` (pemohon), `maya@contoh.test` (atasan),
`fajar@contoh.test` (finance), `hana@contoh.test` dan `dewi@contoh.test` (pemilik proses cuti dan pembelian),
`irfan@contoh.test` dan `sari@contoh.test` (pemilik proses akses IT), `hadi@contoh.test` (admin sistem).

Pemilik proses menyusun dan mengaktifkan alur miliknya; admin sistem hanya menunjuk pemilik dan mengimpor direktori.

## Master organisasi

Atasan tidak disimpan per orang. Ia dihitung dari pohon unit (`org_units`) dengan urutan tetap: pengecualian pelaporan yang
masih berlaku, lalu kepala unit atau Plt, lalu naik ke unit di atasnya kalau kosong. Wewenang ("siapa berhak menyetujui hal
ini") ada di matriks wewenang dan bisa dibatasi ke satu cabang unit. Setiap penunjukan approver menyimpan alasannya.

Perubahan struktur diusulkan pemilik master organisasi (contoh: `hana@contoh.test`, `dewi@contoh.test`), ditinjau pemilik lain,
lalu berlaku pada tanggalnya; tugas yang masih terbuka dipindahkan mengikuti struktur baru. Menu Organisasi menampilkan pohon,
temuan risiko, dan uji cakupan. Isi awal diimpor admin sistem: `POST /api/org/import/units` (CSV `id,name,level,parent_id`)
lalu `POST /api/admin/directory` (CSV `id,email,name,unit_id,title,is_admin`).

Chat AI butuh `AI_GATEWAY_ID` (lihat bagian AI di bawah).

## Server MCP

Semua fitur Sentinel tersedia sebagai tool MCP di `https://<host>/mcp` (Streamable HTTP, tanpa state). Klien masuk lewat
OAuth: pengguna login dan menyetujui akses di `/authorize`, lalu setiap tool berjalan sebagai pengguna itu dengan hak akses
yang sama persis dengan di aplikasi web, dan tercatat di audit yang sama. Daftar tool ada di `apps/api/src/mcp.ts`.

Menyambungkan dari Claude Code: `claude mcp add --transport http sentinel https://<host>/mcp`, lalu `/mcp` untuk login.
Butuh KV namespace yang di-bind sebagai `OAUTH_KV`; tanpa itu endpoint MCP mati dan aplikasi tetap berjalan.

## AI lewat Cloudflare AI Gateway

Cara utama tidak memakai kunci apa pun. Worker memanggil Claude lewat binding `AI` ke sebuah AI Gateway, dan pemakaian
ditagih ke kredit Cloudflare (Unified Billing):

1. Di dashboard Cloudflare: AI > AI Gateway, buat gateway (atau pakai yang ada) dan isi kredit di "Credits Available".
2. Isi nama gateway di `AI_GATEWAY_ID` pada `wrangler.jsonc`, lalu deploy.

Alternatif dengan kunci Anthropic sendiri: kosongkan `AI_GATEWAY_ID`, isi `AI_GATEWAY_URL`, lalu simpan
`ANTHROPIC_API_KEY` (dan `AI_GATEWAY_TOKEN` untuk gateway yang terautentikasi) dengan `wrangler secret put`.

## Deploy ke Cloudflare

```bash
cd apps/api
npx wrangler d1 create sentinel --location apac     # salin database_id ke wrangler.jsonc
npx wrangler r2 bucket create sentinel-files
npx wrangler d1 migrations apply sentinel --remote
npx wrangler secret put ANTHROPIC_API_KEY
cd ../.. && npm run deploy
```

Isi `AI_GATEWAY_URL` di `wrangler.jsonc`. Unit dan karyawan diimpor lewat menu Organisasi > Pengaturan.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Karyawan kantor internal, ratusan orang saat dipakai penuh. Perangkatnya campuran: admin dan pemilik proses bekerja di desktop kantor, sementara atasan sering memberi approval dari HP.

- **Pemohon:** mengajukan cuti/izin, akses IT, dan pembelian, lalu memantau statusnya sampai selesai atau diminta revisi.
- **Approver (atasan, finance, peran lain):** memproses antrean kotak masuk dengan menyetujui, menolak, atau meminta revisi, sering di sela pekerjaan lain dan dari HP. Bisa punya belasan tugas terbuka sekaligus.
- **Atasan langsung:** dapat membuat delegasi atas nama bawahan yang berhalangan.
- **Pemilik proses:** menyusun, mensimulasikan, dan meninjau versi alur miliknya di desktop. Draf harus diaktifkan oleh pemilik lain di alur yang sama.
- **Pemilik master organisasi (HR dan direksi):** mengusulkan dan meninjau perubahan unit, kepala unit, pengecualian pelaporan, dan matriks wewenang.
- **Admin sistem (IT):** menunjuk pemilik proses dan pemilik master organisasi, serta mengimpor isi awal. Admin tidak mengubah isi alur atau struktur.

## Product Purpose

Menggantikan approval lewat kertas, chat, dan email dengan alur yang terdefinisi, berversi, dan teraudit. Keberhasilan berarti permintaan selesai tepat tenggat, setiap keputusan bisa ditelusuri ke orang, waktu, dan versi alur, dan pemilik proses bisa mengubah aturan tanpa bantuan developer.

## Positioning

Alur approval adalah definisi berversi yang dimiliki pemilik proses, dirujuk ke SOP sumber, divalidasi mesin (tidak ada jalur tanpa approval, pemisahan tugas), dan bisa disimulasikan sebelum diaktifkan. Draf bisa disusun dengan bantuan AI dari SOP, dengan kutipan sumber yang tampil per aturan. Aktivasi selalu butuh pemilik kedua (four-eyes).

## Operating Context

- Antrean kotak masuk berisi tenggat SLA. Ada pengingat dan eskalasi otomatis ke atasan lewat cron.
- Detail permintaan memuat isian dinamis per alur, lampiran (R2), langkah approval, dan riwayat audit append-only.
- Delegasi berjangka waktu, dibuat sendiri atau oleh atasan atas nama bawahan.
- Hasil approval pembelian disinkronkan ke ERP. Notifikasi dikirim di dalam aplikasi dan lewat email.
- Integrasi dua arah: sistem lain mengajukan permintaan lewat API dengan kunci per sistem (permintaan itu mengikuti alur yang sama), dan diberi tahu hasil akhirnya lewat webhook bertanda tangan. Logika approval hanya ada di Sentinel.
- Editor alur terdiri dari diagram visual, panel langkah, tabel aturan, simulasi, pemeriksaan validasi, tautan SOP wajib, dan chat AI penyusun draf.

## Capabilities and Constraints

- Sentinel punya master organisasi sendiri dan tidak menyalin approver dari sistem HR: atasan dihitung dari pohon unit (satu kepala per unit, Plt, naik kalau kosong), pengecualian pelaporan dicatat dengan alasan dan masa berlaku, dan wewenang ada di matriks terpisah. Data HR hanya menjadi draf isi awal.
- Dua jalur approval dibedakan eksplisit: sesuai struktur (atasan, kepala unit) dan sesuai wewenang. Setiap penunjukan approver menampilkan alasannya.

- Stack: React 18 + Vite (`apps/web`), Cloudflare Worker + Hono + D1 + R2 (`apps/api`), mesin alur murni di `packages/engine`. Diagram memakai `@xyflow/react`.
- Routing berbasis hash. Satu SPA melayani semua peran, dan menu Alur hanya tampil untuk admin atau pemilik proses.
- Bahasa antarmuka: bahasa Inggris profesional (layar, pesan error, notifikasi). Tanggal memakai `en-GB`, angka `en-US`. Data yang ditulis pengguna (nama alur, langkah, alasan) tetap apa adanya.
- Semua fitur juga tersedia lewat server MCP di `/mcp` dengan login OAuth; tiap tool berjalan dengan hak akses pengguna yang sama.
- Fase awal dipakai tim IT: admin sistem boleh mengubah dan mengaktifkan semuanya sendiri, dan tindakan tanpa peninjau kedua ditandai di audit.
- Status inti: draf, terbuka/berjalan, disetujui, ditolak, diminta revisi, aktif (versi alur).
- Skala 100–500 karyawan berarti daftar bisa panjang. Filter, pencarian, dan aksi massal belum ada dan belum diputuskan.
- Masih PoC. Akun contoh ada di data seed (`apps/api/scripts/seed.ts`).

## Brand Commitments

UI wajib membawa identitas Mitra Prodin (logo dan warna perusahaan). Aset resmi belum ada di repositori dan harus diberikan pengguna. Jangan menebak atau menggambar ulang logo. "Sentinel" adalah nama aplikasi di dalam identitas Mitra Prodin.

## Evidence on Hand

- Contoh definisi alur: `packages/engine/examples/` (cuti, akses IT, pembelian, direktori).
- Data seed akun dan peran: `apps/api/scripts/seed.ts`.
- Belum ada aset brand, data pemakaian nyata, atau testimoni. Jangan mengarang.

## Product Principles

1. **Keputusan cepat, jejak lengkap.** Approver harus bisa memutuskan dalam hitungan detik dari HP, tanpa mengorbankan konteks dan audit.
2. **Aturan milik pemilik proses.** Perubahan alur dilakukan oleh orang yang bertanggung jawab atas SOP, dengan validasi, simulasi, dan pemilik kedua sebelum berlaku.
3. **Tenggat terlihat.** Status SLA, keterlambatan, dan eskalasi selalu tampak di tempat keputusan diambil.
4. **Transparan bagi pemohon.** Pemohon selalu tahu permintaannya di mana, menunggu siapa, dan kenapa.

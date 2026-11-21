---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/pages.tsx","src/admin/Editor.tsx"]
---

# Sentinel web app (semua layar)

Mode: Operate. Cakupan: shell, login, kotak masuk, permintaan saya, buat permintaan, detail permintaan, delegasi, notifikasi, daftar alur, editor alur.

Pengguna dan tugas: approver memutuskan antrean (desktop dan HP), pemohon memantau status, pemilik proses menyusun alur di desktop. Permintaan pengguna: layout desktop penuh (sidebar, tabel padat, panel detail), sistem desain konsisten, kotak masuk kelas berat (cari, filter, urut tenggat, setujui massal). Aset brand diambil dari mitraprodin.com: logo putih `public/brand/mp-logo-white-768.png`, favicon `public/brand/favicon-32.png`; biru #00558C, merah #C20017, slate #333F48.

Keputusan terbuka: endpoint khusus aksi massal belum ada; setujui massal memanggil endpoint keputusan per tugas.

## Direction contract

THESIS: Tenggat dan aturan dibaca seperti hasil uji QC terhadap spesifikasi: di dalam toleransi, mendekati batas, atau di luar. Menolak dasbor SaaS abu-abu dengan kartu-kartu dan satu aksen.

OWN-WORLD: Header atas biru Mitra Prodin (#00558C) dengan logo putih; sidebar putih; bidang kerja putih di atas latar abu-biru sangat muda (#EEF2F5) bergaris rambut biru-abu. Teks slate #333F48; semua netral diturunkan dari slate brand (tanpa warna lain), sehingga warna hanya muncul untuk status. Angka ukur dalam monospace tabular (IBM Plex Mono hanya untuk data: nomor, nominal, waktu); UI dalam Public Sans. Status: hijau uji #1E7F4F lulus, amber #B26B00 mendekati batas, merah pena #C20017 di luar spesifikasi. Biru hanya untuk state aktif/terpilih dan aksi utama. Elevasi hanya untuk drawer/dialog. Tabel satu ukuran huruf (13px), peringkat lewat ketebalan, kapital kecil, dan garis.

STORY: Approver membuka kotak masuk, langsung melihat mana yang di luar toleransi tenggat, memutuskan satu atau beberapa sekaligus, lalu lanjut ke berikutnya. Pemohon melihat permintaannya di langkah mana dan menunggu siapa. Pemilik proses menyusun alur dengan ambang aturan yang terbaca sebagai batas spesifikasi.

FIRST VIEWPORT: Desktop 1440: header biru 52px (logo, nama aplikasi Sentinel, pencarian global, pengguna). Sidebar 224px kiri: Kotak masuk (jumlah), Permintaan saya, Buat permintaan, Delegasi, Notifikasi (jumlah), grup Pengelolaan: Alur approval. Area kerja: judul + bar filter (cari, alur, status tenggat, urut) di atas tabel kotak masuk (centang, No., Alur, Pemohon, Langkah, Tenggat + pita toleransi); bar aksi massal muncul saat ada pilihan. Panel detail kanan 460px untuk baris terpilih dengan tombol Setujui/Minta revisi/Tolak. HP: header + tab bawah, daftar satu kolom, detail layar penuh, setelah memutuskan langsung ke tugas berikutnya. Signature move: pita toleransi SLA (batang tipis: terpakai vs batas SLA, zona 75% amber, lewat batas merah dengan nilai lebihnya) di setiap baris dan di detail; ambang tabel aturan ditampilkan sebagai nilai vs batas.

FORM: Lembar Uji QC, kandidat 5 dari daftar grounded undian ulang 1. seed:c56cd30eb08108a2

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

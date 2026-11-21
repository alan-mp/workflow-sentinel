---
name: Sentinel · Mitra Prodin
description: Approval berversi dan teraudit untuk karyawan Mitra Prodin, dibaca seperti lembar uji QC.
colors:
  prodin-blue: "#00558c"
  prodin-blue-ink: "#00426d"
  blue-wash: "#e5eff6"
  blue-line: "#9cc0d8"
  pen-red: "#c20017"
  red-wash: "#fbe9eb"
  test-green: "#1e7f4f"
  green-wash: "#e5f2ea"
  amber: "#a35f00"
  amber-bar: "#d98a00"
  amber-wash: "#fcf0dc"
  ink-strong: "#1d252c"
  slate-ink: "#333f48"
  muted: "#5b6770"
  faint: "#8a949b"
  line: "#d4dde4"
  line-soft: "#e5ebef"
  control-line: "#c3ccd3"
  ground: "#eef2f5"
  surface: "#ffffff"
  surface-sunk: "#f6f8f9"
typography:
  display:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.43rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.14rem"
    fontWeight: 650
    lineHeight: 1.25
  subtitle:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.93rem"
    fontWeight: 650
    lineHeight: 1.25
  body:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  table:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.93rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 650
    letterSpacing: "0.05em"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.93em"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
rounded:
  mark: "1px"
  chip: "3px"
  r: "4px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  page-x: "1.75rem"
components:
  button-primary:
    backgroundColor: "{colors.prodin-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.r}"
    padding: "0.35rem 0.85rem"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.prodin-blue-ink}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.r}"
    padding: "0.35rem 0.85rem"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-sunk}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.pen-red}"
    rounded: "{rounded.r}"
    padding: "0.35rem 0.85rem"
  button-danger-hover:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.pen-red}"
  button-ghost:
    textColor: "{colors.muted}"
    rounded: "{rounded.r}"
    padding: "0.35rem 0.85rem"
  button-ghost-hover:
    backgroundColor: "{colors.line-soft}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-strong}"
    rounded: "{rounded.r}"
    padding: "0.4rem 0.6rem"
    height: "34px"
  appbar:
    backgroundColor: "{colors.prodin-blue}"
    textColor: "{colors.surface}"
    height: "52px"
  sidebar:
    backgroundColor: "{colors.surface}"
    width: "224px"
  nav-item:
    textColor: "{colors.slate-ink}"
    rounded: "{rounded.r}"
    padding: "0.5rem 0.6rem"
  nav-item-active:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.prodin-blue-ink}"
  table-header:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "0.55rem 0.75rem"
  table-row-selected:
    backgroundColor: "{colors.blue-wash}"
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.r}"
    padding: "1.25rem"
  badge-ok:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.test-green}"
    rounded: "{rounded.chip}"
    padding: "0.1rem 0.45rem"
  badge-warn:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.amber}"
    rounded: "{rounded.chip}"
    padding: "0.1rem 0.45rem"
  badge-bad:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.pen-red}"
    rounded: "{rounded.chip}"
    padding: "0.1rem 0.45rem"
  badge-run:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.prodin-blue-ink}"
    rounded: "{rounded.chip}"
    padding: "0.1rem 0.45rem"
  detail-panel:
    backgroundColor: "{colors.surface}"
    width: "460px"
---

# Design System: Sentinel · Mitra Prodin

## Overview

**Creative North Star: "Lembar Uji QC"**

Sentinel membaca setiap tenggat dan setiap ambang aturan seperti hasil uji terhadap spesifikasi: di dalam toleransi, mendekati batas, atau di luar. Dunia visualnya adalah lembar uji pabrik yang rapi: bidang kerja putih bergaris rambut di atas latar abu-biru sangat muda, label kolom kecil berhuruf kapital seperti kolom isian formulir, dan angka ukur dalam monospace tabular. Identitas Mitra Prodin hadir lewat header biru dengan logo putih resmi (`public/brand/mp-logo-white-768.png`, tidak pernah digambar ulang).

Kepadatannya tinggi dan sengaja: 14px sebagai ukuran dasar, tabel satu ukuran huruf (≈13px), peringkat dibangun dengan ketebalan, kapital kecil, dan garis, bukan dengan ukuran atau warna. Semua netral diturunkan dari slate brand, sehingga warna hanya muncul ketika ia berarti sesuatu: hijau lulus, amber mendekati batas, merah pena di luar spesifikasi, biru untuk yang aktif atau terpilih dan untuk aksi utama. Dunia ini menolak dasbor SaaS abu-abu yang tersusun dari kartu-kartu dengan satu aksen.

Datar secara default. Kedalaman dibangun oleh garis rambut dan pergeseran nada permukaan (latar → putih → sunk); bayangan hanya untuk lapisan yang benar-benar mengambang.

**Key Characteristics:**
- Header biru Mitra Prodin, sidebar putih, bidang kerja putih di atas latar `ground`.
- Warna hanya untuk status dan tindakan; netral semuanya slate.
- Public Sans untuk UI, IBM Plex Mono hanya untuk data (nomor, nominal, waktu, hitungan).
- Label kecil kapital di atas nilai, seperti kolom isian lembar uji.
- Pita toleransi SLA sebagai tanda tangan: batang tipis dengan garis batas, bukan progress bar.
- Sudut nyaris tegas (4px); penanda status persegi, bukan titik bulat.

## Colors

Slate brand untuk semua netral, biru Mitra Prodin untuk identitas dan tindakan, dan tiga warna uji untuk status; setiap warna punya pasangan "wash" untuk latar penanda.

### Primary
- **Biru Mitra Prodin** (prodin-blue): header aplikasi, panel brand login, tombol utama, state aktif/terpilih (indikator bawah tab, hitungan nav aktif, cincin fokus, tanda langkah yang terbuka, pesan pengguna di chat). Juga `accent-color` dan `caret-color` global.
- **Biru Tinta** (prodin-blue-ink): hover tombol utama, teks item nav aktif, nomor permintaan (REQ-…) di tabel, teks di atas `blue-wash`.
- **Biru Basuh** (blue-wash): latar item nav aktif, baris tabel terpilih, segmen gauge/segmented terpilih, bar aksi massal, notice informasi, badge "berjalan".
- **Garis Biru** (blue-line): bingkai bar seleksi dan notice, garis bawah blok keputusan, hover node diagram.

### Secondary
- **Merah Pena** (pen-red): di luar spesifikasi/lewat batas, ditolak, aksi berbahaya (tombol Tolak bergaris merah), segmen lewat batas pada pita toleransi. Teks di atas `red-wash` memakai merah gelap #8e0011.
- **Hijau Uji** (test-green): lulus, disetujui, aktif, isi pita toleransi dalam batas. Teks di atas `green-wash` memakai #155c39.
- **Amber** (amber): teks dan angka "mendekati batas", revisi diminta, draf. Teks di atas `amber-wash` pada baris cek memakai #7a4700.
- **Amber Batang** (amber-bar): hanya untuk isian grafis yang lebih terang (pita toleransi mendekati batas, tanda langkah revisi, penanda node kondisi), tidak untuk teks.

### Neutral
- **Tinta Tegas** (ink-strong): judul, nilai isian, nama orang, garis batas pada pita toleransi dan chip ambang.
- **Tinta Slate** (slate-ink): warna teks dasar, sama dengan slate brand #333F48.
- **Redup** (muted): label kolom, sub-teks, ikon sidebar, waktu.
- **Pudar** (faint): "Tanpa tenggat", tanda langkah belum dimulai, titik slot diagram.
- **Garis** (line) dan **Garis Lembut** (line-soft): garis rambut bingkai dan pemisah baris.
- **Garis Kontrol** (control-line): bingkai tombol sekunder, node diagram, garis putus-putus empty state, thumb scrollbar.
- **Latar** (ground), **Permukaan** (surface), **Permukaan Turun** (surface-sunk): tiga nada lapisan; `surface-sunk` untuk kepala tabel, hover baris, nilai nonaktif, kanvas diagram.

### Named Rules
**The Color Means Status Rule.** Warna hanya muncul untuk status (hijau/amber/merah) dan untuk tindakan atau state aktif (biru). Dekorasi dan ilustrasi tetap slate. Satu pengecualian yang sudah ada: penanda jenis node diagram meminjam palet yang sama (biru, amber-bar, hijau), tidak pernah hue baru.

**The Wash Pairing Rule.** Penanda status selalu teks berwarna di atas basuhan warna yang sama (`*-wash`), tidak pernah teks putih di atas warna jenuh, kecuali tombol utama dan hitungan nav aktif.

## Typography

**Display Font:** Public Sans Variable (dengan Public Sans, system-ui)
**Body Font:** Public Sans Variable
**Label/Mono Font:** IBM Plex Mono 400/500/600 (dengan ui-monospace), hanya untuk data

**Character:** Public Sans memberi suara administratif yang netral dan jelas; Plex Mono membuat setiap angka ukur terbaca sebagai hasil instrumen. Keduanya di-host sendiri lewat @fontsource. Ketebalan memakai nilai variabel menengah (520, 550, 650) untuk peringkat halus.

### Hierarchy
- **Display** (650, 2rem, 1.25): nama aplikasi di panel brand login saja; 1.5rem di HP.
- **Headline** (650, 1.43rem, 1.25, -0.01em): judul halaman (h1); 1.25rem di HP. Judul detail permintaan memakai 1.29rem.
- **Title** (650, 1.14rem): judul sheet dan alur (h2).
- **Subtitle** (650, 0.93rem): judul bagian di detail (h3).
- **Body** (400, 14px, 1.45): teks UI; sub-judul halaman dibatasi 68ch. Seluruh UI memakai `tabular-nums`.
- **Table** (0.93rem ≈ 13px): satu ukuran untuk semua isi sel; sub-baris di dalam tabel juga 1em, bukan lebih kecil.
- **Label** (650, 0.75rem, 0.05em, kapital): label isian, `dt` spesifikasi, label panel. Kepala tabel dan judul grup nav memakai 0.72rem dengan 0.06em.
- **Data** (Plex Mono 500, 0.93em, -0.01em): nomor permintaan, waktu, hitungan nav dan gauge, teks pita toleransi, nilai ambang.

### Named Rules
**The Mono Is Measurement Rule.** IBM Plex Mono hanya untuk nilai yang diukur atau dirujuk (nomor, nominal, waktu, hitungan). Judul, label, dan kalimat tetap Public Sans.

**The One Size Table Rule.** Di dalam tabel, peringkat dibuat lewat ketebalan (600 untuk isi utama), warna redup untuk sub-baris, dan garis; ukuran huruf tidak berubah.

## Layout

Shell grid tiga area: header 52px penuh lebar, sidebar 224px di kiri, area kerja yang bergulir sendiri. Editor alur menyembunyikan sidebar (`shell-editor`). Halaman biasa memakai padding 1.5rem 1.75rem 3rem dan lebar maksimum 1180px (760px untuk halaman sempit, 820px untuk detail berdiri sendiri).

Kotak masuk adalah split view: daftar di kiri dan panel detail 460px di kanan (420px di bawah 1240px), masing-masing bergulir sendiri; tanpa pilihan, panel menampilkan placeholder pada `surface-sunk`. Di atas daftar: gauge hitungan tenggat (Semua / Lewat batas / Mendekati batas / Dalam batas) yang sekaligus menjadi saringan, lalu toolbar filter; bar aksi massal biru-basuh muncul saat ada baris tercentang. Tabel kotak masuk menggabungkan "Alur" dan "Langkah" menjadi satu kolom **"Alur dan langkah"**: nama alur sebagai isi utama, nama langkah sebagai sub-baris; kedua nilai tetap tampil.

Formulir memakai grid dua kolom (gap 0.9rem 1rem) dan `two-col` (isi + kolom samping 380px). Ritme jarak dominan: 0.5rem, 0.75rem, 1rem, 1.25rem; padding sel tabel 0.55rem 0.75rem.

Responsif:
- ≤1080px: split menjadi satu kolom; detail menggantikan daftar saat ada pilihan; `two-col` menumpuk.
- ≤820px: sidebar dan pencarian header disembunyikan, tab bar bawah muncul (indikator aktif garis biru 2px di atas, hitungan mono di atas ikon). Baris tabel kotak masuk dan permintaan menjadi blok grid ringkas (alur di atas, nomor di bawah, tenggat di kanan); kepala tabel disembunyikan. Tombol keputusan melebar dengan tinggi minimum 44px. Gauge bergulir horizontal dan segmen "Semua" disembunyikan. Login menumpuk, panel brand di atas.

## Elevation & Depth

Sistem ini datar. Kedalaman dinyatakan oleh tiga nada lapisan (`ground` → `surface` → `surface-sunk`) dan garis rambut 1px. Satu-satunya bayangan bertingkat dipakai untuk lapisan yang mengambang di atas konten (menu tambah langkah di diagram). State aktif memakai garis dalam (`inset`), bukan angkat.

### Shadow Vocabulary
- **Lapisan** (`box-shadow: 0 8px 24px rgb(29 37 44 / 0.14), 0 2px 6px rgb(29 37 44 / 0.08)`): menu, drawer, dialog yang mengambang.
- **Garis aktif bawah** (`box-shadow: inset 0 -2px 0 #00558c`): segmen gauge terpilih dan tab panel samping terpilih; versi atas `inset 0 2px 0` untuk tab bar HP.
- **Cincin fokus input** (`box-shadow: 0 0 0 3px rgb(0 85 140 / 0.18)` dengan bingkai biru).
- **Cincin terpilih node** (`box-shadow: 0 0 0 2px #00558c`).

### Named Rules
**The Flat Sheet Rule.** Permukaan kerja tidak pernah diberi bayangan. Bayangan berarti "mengambang di atas lembar", sehingga hanya menu, drawer, dan dialog yang boleh memakainya.

## Shapes

Sudut nyaris tegas: 4px (`r`) untuk tombol, input, sheet, tabel, notice, node diagram; 3px untuk badge, tag, avatar, dan hitungan; 1px untuk penanda kecil. Penanda status adalah kotak kecil persegi (7–8px, radius 1px) di depan badge, item simulasi, notifikasi belum dibaca, dan jenis node, bukan titik bulat. Lingkaran hanya dipakai untuk tanda langkah approval (13px, bergaris 2px), spinner, dan tombol tambah slot di diagram. Avatar adalah inisial di kotak 28px (22px ringkas), bukan lingkaran. Garis rambut 1px mendefinisikan semua wadah; empty state memakai garis putus-putus.

**The Square Mark Rule.** Penanda status dan jenis berbentuk persegi kecil dengan radius 1px, seperti kotak centang pada lembar uji.

## Components

### Buttons
Tegas dan administratif; tinggi tetap, tanpa kejutan.
- **Shape:** sudut 4px, tinggi minimum 34px (28px untuk kecil, 40px di form login, 44px untuk keputusan di HP), ketebalan 550, ikon lucide di kiri dengan gap 0.4rem.
- **Primary:** biru Mitra Prodin dengan teks putih; hover ke biru tinta. Tombol Setujui di blok keputusan minimal 8.5rem.
- **Hover / Focus / Active:** transisi latar dan bingkai 120ms ease-out; tekan menggeser 1px ke bawah; fokus memakai outline biru 2px offset 2px. Nonaktif berarti opacity 0.5.
- **Secondary:** putih dengan bingkai `control-line`; hover ke `surface-sunk`.
- **Danger:** teks merah pena dengan bingkai merah muda #e3a3ab; hover ke `red-wash` dengan bingkai merah.
- **Ghost / Link / Icon:** ghost transparan teks redup; link berwarna biru tanpa bingkai, bergaris bawah saat hover; tombol ikon 34×34 transparan, varian `on-blue` untuk header.

### Chips
- **Badge status:** teks 0.78rem/650 berwarna di atas basuhannya, radius 3px, dengan kotak penanda 7px berwarna `currentColor`. Nada: ok (disetujui, aktif), warn (revisi, draf), bad (ditolak), run (berjalan, terbuka), idle (dibatalkan, dilewati).
- **Tag:** bingkai garis, teks redup 0.75rem/600 (misalnya "Delegasi"); varian warn amber.
- **Hitungan nav:** mono 0.78rem pada `line-soft`; menjadi biru dengan teks putih pada item aktif.

### Cards / Containers
- **Corner Style:** 4px.
- **Background:** `surface` di atas `ground`; bagian dalam memakai `surface-sunk`.
- **Shadow Strategy:** tidak ada (lihat The Flat Sheet Rule).
- **Border:** garis rambut `line`; pemisah internal `line-soft`.
- **Internal Padding:** sheet 1.25rem; bagian detail 1rem 1.25rem.
- Blok keputusan di detail memakai latar #f4f8fb dengan garis bawah `blue-line` untuk menandai tempat tindakan.

### Inputs / Fields
- **Style:** bingkai `line` 1px, putih, radius 4px, tinggi minimum 34px; hover menggelapkan bingkai ke #b7c1c9. Select memakai chevron SVG slate sendiri.
- **Focus:** bingkai biru dan halo 3px biru 18%.
- **Disabled:** `surface-sunk` dengan teks tetap terbaca (slate, opacity 1).
- **Label:** label kecil kapital di atas nilai (gaya Label); keterangan opsional ditulis biasa, tanpa kapital.
- **Tanggal delegasi:** memakai pemilih `datetime-local` bawaan browser (tampil dalam bahasa UI browser), dengan baris petunjuk berbahasa Indonesia di bawahnya, **"Terbaca sebagai …"**, yang mengonfirmasi nilai dalam format `id-ID`.
- **Error:** catatan bergaris #e8b4ba di atas `red-wash` dengan teks #8e0011.

### Navigation
- **Header:** biru Mitra Prodin 52px, logo putih 30px (26px di HP) dipisah garis putih 35% dari nama "Sentinel" (650, 1.02rem); pencarian global berlatar putih 12% yang berubah putih penuh saat fokus.
- **Sidebar:** putih, item 0.5rem 0.6rem dengan ikon redup; hover `surface-sunk`; aktif `blue-wash`, teks biru tinta 650, ikon biru. Judul grup memakai gaya label kepala tabel.
- **Tab bar HP:** putih bergaris atas, label 0.72rem, aktif biru tinta 700 dengan garis atas 2px biru.
- **Gauge, segmented, tab panel samping:** segmen bergaris rambut; terpilih `blue-wash` (gauge dan tab panel memakai garis aktif bawah).

### Tables
- Kepala lengket berlatar `surface-sunk`, label kapital 0.72rem; baris dipisah `line-soft`, hover `surface-sunk`, tercentang #f2f7fb, terpilih `blue-wash` dengan nomor menebal.
- Nomor permintaan mono biru tinta; isi utama 600 tinta tegas dengan sub-baris redup.

### Pita Toleransi SLA (signature)
Batang tipis 6px yang membaca tenggat sebagai hasil uji terhadap batas, dipakai di setiap baris kotak masuk, detail, dan langkah approval.
- **Geometri:** jatah SLA digambar sampai **garis batas pada 70%** lebar (garis tinta tegas 2px yang menjulur 3px di atas dan bawah). **Tanda 75% SLA** berada pada **52.5%** lebar (garis 1px #b8c3cc). Zona di kanan garis batas (30%) diarsir diagonal #e1c3c8.
- **Isi:** hijau dalam batas, `amber-bar` saat rasio ≥ 0.75, merah muda #e3a0a9 saat lewat batas.
- **Lewat batas:** segmen merah pena terpisah mulai dari garis batas dengan lebar **over/(over+1) × 30%**, sehingga lewat 1× SLA mengisi separuh zona dan telat 6 jam terbaca berbeda dari telat 28 jam.
- **Teks:** mono di bawah batang, "sisa …" atau "lewat …"; amber saat mendekati, merah 600 saat lewat. Tanpa tenggat: teks pudar "Tanpa tenggat".

### Chip Ambang Aturan
Ambang di tabel aturan editor dibaca sebagai batas spesifikasi: nilai mono 600 di atas `surface-sunk` dengan garis batas tinta tegas 2px di sisi kiri (garis yang sama dengan pita toleransi), operator dalam Public Sans redup, beberapa ambang disambung "dan".

### Node Diagram
Kotak putih 224×72 bergaris `control-line`, radius 4px; label jenis kapital 0.75rem dengan kotak penanda 8px (biru langkah approval, amber-bar kondisi, hijau notifikasi); SLA di kanan; judul 650 dan sub redup terpotong elipsis. Terpilih memakai bingkai dan cincin biru 2px.

## Do's and Don'ts

### Do:
- **Do** gunakan warna hanya untuk status (hijau uji, amber, merah pena) dan untuk aksi utama atau state aktif (biru Mitra Prodin).
- **Do** tampilkan setiap tenggat dengan pita toleransi lengkap: garis batas 70%, tanda 75% pada 52.5%, zona arsir, dan segmen lewat batas terkompresi.
- **Do** tulis nomor, waktu, nominal, dan hitungan dalam IBM Plex Mono; semua yang lain dalam Public Sans.
- **Do** beri label isian berupa label kecil kapital (0.75rem, 650, 0.05em) di atas nilai.
- **Do** bangun peringkat di tabel lewat ketebalan dan warna redup, dengan satu ukuran huruf.
- **Do** pakai logo putih resmi dari `public/brand/` di atas biru; jangan gambar ulang.
- **Do** pasangkan teks status dengan basuhan warnanya sendiri dan penanda kotak persegi.

### Don't:
- **Don't** buat dasbor SaaS abu-abu yang tersusun dari kartu-kartu dengan satu aksen.
- **Don't** beri bayangan pada sheet, tabel, panel, atau baris; bayangan hanya untuk menu, drawer, dan dialog.
- **Don't** perkenalkan hue di luar slate, biru, hijau, amber, dan merah, termasuk untuk membedakan jenis.
- **Don't** gunakan monospace untuk judul, label, atau kalimat.
- **Don't** ganti pita toleransi dengan progress bar persentase.
- **Don't** perbesar radius melewati 4px pada wadah atau tombol.

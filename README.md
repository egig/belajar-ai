# AI Chat Sederhana

Chat sederhana dengan OpenAI-compatible API (mis. OpenRouter), streaming, dan **thread** (banyak percakapan) yang semuanya disimpan di Postgres:

- **Thread**: tiap percakapan terpisah (sidebar di kiri), bisa dibuat dan dihapus.
- **Pesan**: seluruh riwayat thread disimpan di tabel `messages` dan dikirim ke model setiap request.
- **System instruction**: pengaturan global di tabel `settings`, berlaku untuk semua thread (tombol Pengaturan).
- **Pemakaian token**: disimpan per pesan assistant; total dan terakhir dihitung per thread.

## Konfigurasi

Buat file `.env` (lihat `.env.example`):

```
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
MODEL=...
DATABASE_URL=postgres://user:password@localhost:5432/belajar_ai
```

## Menjalankan dengan Docker (disarankan)

```sh
docker compose up --build
```

Buka http://localhost:3000. Postgres ikut dijalankan otomatis dan `DATABASE_URL` di `.env` diabaikan (diarahkan ke container `db`). Data tersimpan di volume `pgdata`.

```sh
docker compose down        # stop, data tetap ada
docker compose down -v     # stop dan hapus semua data
```

## Menjalankan tanpa Docker

Butuh Node 24 dan Postgres yang sudah berjalan.

```sh
createdb belajar_ai
npm install
npm start
```

Tabel dibuat otomatis saat server start.

## API

| Method | Path | Fungsi |
| --- | --- | --- |
| GET / POST | `/api/threads` | daftar / buat thread |
| DELETE | `/api/threads/:id` | hapus thread beserta pesannya |
| GET / PUT | `/api/settings` | baca / ubah system instruction global |
| GET | `/api/chat?threadId=` | riwayat thread + pemakaian token |
| POST | `/api/chat` | kirim pesan `{ message, threadId }` (response streaming) |
| GET | `/api/model-info` | nama model dan batas konteks |

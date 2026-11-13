# AHIM AI Studio

Aplikasi AI multifungsi dengan antarmuka Islami modern, Prompt Kilat Ultimate, Cloudflare Workers AI, dan Sonex Labs Text-to-Speech.

**Live:** https://ahim-ai-studio.vercel.app

## Fitur

- Prompt Kilat Ultimate: 16 jenis prompt, 11 gaya, Auto 5 Gaya, video scene, Guru-Friendly.
- Text-to-Text: Cloudflare Llama.
- Text-to-Image: Cloudflare FLUX.
- Image-to-Text: Cloudflare Vision (perlu uji inference).
- Text-to-Voice: Sonex Labs, dengan unduhan MP3 jika API berhasil.
- Voice-to-Text: Cloudflare Whisper (perlu uji inference).
- Video-to-Text: analisis satu frame, bukan seluruh video.
- Text-to-Video dan Image-to-Video: **belum tersedia**.
- Registrasi/profil/database pengguna: **belum aktif**.

## Deploy di Vercel

Framework preset: **Other**. Root: repository root. Node.js serverless functions pada `api/`.

Buka **Project Settings → Environment Variables**, lalu tambahkan:

```env
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
SONEX_API_KEY=
```

Jangan menyimpan token, file `.env`, atau secret dalam GitHub. Atur variabel tersebut hanya di dashboard hosting.

## Pengembangan dan pengujian

```bash
npm install
npm run check
npx vercel dev
```

Pemeriksaan sintaks dan build **tidak membuktikan** kualitas output AI atau keberhasilan API provider. Gunakan tes manual untuk Prompt Kilat, chat, gambar, dan download MP3 setelah deploy.

## Catatan sinkronisasi

Repositori ini adalah **rekonstruksi source modular v4.0** dari implementasi Vercel. Source frontend/backend besar pada deployment tidak dapat diekspor secara penuh lewat konektor. Karena itu, kesetaraan byte-per-byte dengan build Vercel yang sedang online belum dapat dijamin. Jangan otomatis mengganti deployment produksi melalui Git integration tanpa pengujian.

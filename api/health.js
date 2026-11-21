export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(200).json({
    status: 'ok',
    version: '4.0.1-video-preview',
    cloudflareConfigured: !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
    sonexConfigured: !!process.env.SONEX_API_KEY,
    videoEnabled: process.env.VIDEO_AI_ENABLED === 'true' &&
      process.env.VIDEO_AI_BILLING_CONFIRMED === 'true' &&
      !!process.env.VIDEO_AI_ACCESS_CODE &&
      process.env.VIDEO_AI_ACCESS_CODE.length >= 24 &&
      !!process.env.CLOUDFLARE_ACCOUNT_ID &&
      !!process.env.CLOUDFLARE_API_TOKEN,
    videoMode: '5s-480p',
    note: 'Konfigurasi provider tidak membuktikan video berhasil dibuat.'
  });
}

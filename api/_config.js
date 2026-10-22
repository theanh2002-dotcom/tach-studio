let cachedConfig = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 1 minute in-memory cache

export async function getSystemConfig() {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiry) {
    return cachedConfig;
  }

  const workerUrl = process.env.GALLERY_RESOLVER_URL || 'https://tanhbooth-api.laihoanganh456.workers.dev';
  const workerSecret = process.env.GALLERY_RESOLVER_SECRET || process.env.ADMIN_API_SECRET || 'theanh2002';

  let remoteSettings = {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/internal/settings`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${workerSecret}`,
        'X-Internal-Secret': workerSecret
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      remoteSettings = data.settings || {};
    }
  } catch (err) {
    console.warn('[config] Could not fetch settings from Cloudflare Worker, using fallback:', err?.message || err);
  }

  cachedConfig = {
    TELEGRAM_BOT_TOKEN: remoteSettings.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: remoteSettings.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: remoteSettings.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
    GOOGLE_CLIENT_ID: remoteSettings.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: remoteSettings.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_REFRESH_TOKEN: remoteSettings.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN || '',
  };
  cacheExpiry = now + CACHE_TTL_MS;

  return cachedConfig;
}

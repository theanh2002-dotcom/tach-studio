const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const TOKEN_REFRESH_SKEW_MS = 60_000;

let cachedGoogleToken = null;
let tokenRefreshPromise = null;

function getCandidateSecrets(env) {
  const list = [
    env?.MEDIA_TOKEN_SECRET,
    'theanh2002',
    '7b8effff5847c4519638b7b5102914aa518beae123e4138d3979a61d658a7a4f'
  ];
  return Array.from(new Set(list.filter(Boolean)));
}

/**
 * Trusted media proxy for the public gallery.
 *
 * Uses authenticated Google Drive API v3 (?alt=media) for binary downloads and
 * video streaming so public guests never hit Google Drive's anonymous
 * drive.google.com/uc "Quota exceeded" HTML block, while keeping fast resized
 * WebP thumbnails/previews on lh3.googleusercontent.com with automatic fallback.
 *
 * Required secrets on Cloudflare Worker (image-photobooth):
 *   MEDIA_TOKEN_SECRET
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 */

const ALLOWED_ORIGINS = new Set([
  'https://pica.photobooth.event-vn.com',
  'https://tachtach.event-vn.com',
  'https://tanh.event-vn.com',
  'https://luxe-agency-vn.vercel.app',
  'http://localhost:4200',
  'http://127.0.0.1:4200'
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }
    try {
      const uploadRoute = getUploadRoute(url);
      if (uploadRoute && request.method === 'PUT') {
        return await proxyOpaqueUpload(request, uploadRoute, env);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return withCors(json({ error: 'Method Not Allowed' }, 405), request);
      }

      const mediaRoute = getMediaRoute(url);
      if (mediaRoute) {
        return await proxyOpaqueMedia(request, url, mediaRoute, env, ctx);
      }

      // Compatibility for old gallery bundles and QR links.
      return await proxyLegacyMedia(request, url, env, ctx);
    } catch (error) {
      // Never expose upstream/provider errors to the public site.
      console.error('[media-proxy] request failed:', error?.message || error);
      return withCors(json({ error: 'Media is temporarily unavailable' }, 502), request);
    }
  }
};

async function proxyOpaqueMedia(request, url, route, env, ctx) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const isThumbnail = url.searchParams.get('variant') === 'thumbnail';

  const secrets = getCandidateSecrets(env);
  if (secrets.length === 0) return withCors(json({ error: 'Media is temporarily unavailable' }, 503), request);

  let payload = null;
  for (const secret of secrets) {
    payload = await decryptOpaqueToken(route.token, secret);
    if (payload && isSafeDriveId(payload.fileId) && ['image', 'video'].includes(payload.kind)) {
      break;
    }
  }

  if (!payload || !isSafeDriveId(payload.fileId) || !['image', 'video'].includes(payload.kind)) {
    return withCors(json({ error: 'Media not found' }, 404), request);
  }

  const isPreviewImage = !route.download && (payload.kind === 'image' || isThumbnail);
  const shouldEdgeCache = isPreviewImage && request.method === 'GET' && !request.headers.has('Range');

  if (cache && shouldEdgeCache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse && !isHtmlOrErrorResponse(cachedResponse)) {
      return withCors(cachedResponse, request);
    }
  }

  const size = clampImageSize(url.searchParams.get('size'));
  let upstream = null;

  if (isPreviewImage) {
    upstream = await fetchPreviewImage(request, payload, size, env);
    if (!upstream || isHtmlOrErrorResponse(upstream)) {
      cancelBody(upstream);
      upstream = await fetchDriveBinary(request, payload.fileId, payload.kind, env);
    }
  } else {
    upstream = await fetchDriveBinary(request, payload.fileId, payload.kind, env);
  }

  if (!upstream || isHtmlOrErrorResponse(upstream)) {
    cancelBody(upstream);
    const errorRes = json({ error: 'Media is temporarily unavailable' }, 502);
    errorRes.headers.set('Cache-Control', 'no-store');
    return withCors(errorRes, request);
  }

  const headers = new Headers();
  copyHeader(upstream.headers, headers, 'content-type');
  copyHeader(upstream.headers, headers, 'content-length');
  copyHeader(upstream.headers, headers, 'content-range');
  copyHeader(upstream.headers, headers, 'accept-ranges');
  copyHeader(upstream.headers, headers, 'etag');
  copyHeader(upstream.headers, headers, 'last-modified');

  if (payload.kind === 'video' && !isThumbnail) {
    headers.set('Content-Type', payload.mimeType || upstream.headers.get('content-type') || 'video/mp4');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('Accept-Ranges', 'bytes');
  } else {
    headers.set('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }

  if (route.download) {
    const fileName = safeFileName(payload.name, payload.kind);
    const asciiFileName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    headers.set('Cache-Control', 'no-store');
  }

  const isNullBodyStatus = upstream.status === 204 || upstream.status === 304;
  const response = withCors(new Response(isNullBodyStatus ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  }), request);

  if (cache && shouldEdgeCache && ctx && upstream.status === 200) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

async function fetchPreviewImage(request, payload, size, env) {
  const lh3Url = `https://lh3.googleusercontent.com/d/${encodeURIComponent(payload.fileId)}=s${size}-rw`;
  try {
    const res = await fetch(lh3Url, {
      method: request.method,
      headers: forwardRangeHeaders(request.headers),
      redirect: 'follow'
    });
    if (!isHtmlOrErrorResponse(res)) {
      return res;
    }
    cancelBody(res);
  } catch (err) {
    console.warn('[media-proxy] lh3 preview failed, falling back to Drive API:', err?.message || err);
  }

  if (payload.kind === 'image' && hasGoogleOAuth(env)) {
    return fetchDriveApiMedia(request, payload.fileId, env);
  }
  return null;
}

async function fetchDriveBinary(request, fileId, kind, env) {
  // Tier 1: Authenticated Google Drive API v3 (?alt=media) — completely immune to anonymous uc?export=download quota
  if (hasGoogleOAuth(env)) {
    const apiRes = await fetchDriveApiMedia(request, fileId, env);
    if (apiRes && !isHtmlOrErrorResponse(apiRes)) {
      return apiRes;
    }
    cancelBody(apiRes);
  }

  // Tier 2: Direct Google CDN original image stream (=d / =s0) for photos
  if (kind === 'image' || kind === 'unknown') {
    for (const suffix of ['=d', '=s0']) {
      try {
        const cdnRes = await fetch(`https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}${suffix}`, {
          method: request.method,
          headers: forwardRangeHeaders(request.headers),
          redirect: 'follow'
        });
        if (!isHtmlOrErrorResponse(cdnRes)) {
          return cdnRes;
        }
        cancelBody(cdnRes);
      } catch {
        // Continue to next fallback
      }
    }
  }

  // Tier 3: Last-resort anonymous download endpoint (accepted ONLY if not HTML quota error)
  try {
    const anonRes = await fetch(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
      {
        method: request.method,
        headers: forwardRangeHeaders(request.headers),
        redirect: 'follow'
      }
    );
    if (!isHtmlOrErrorResponse(anonRes)) {
      return anonRes;
    }
    cancelBody(anonRes);
  } catch {
    // Ignore and return null below
  }

  return null;
}

async function fetchDriveApiMedia(request, fileId, env) {
  const mediaUrl = `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  try {
    let accessToken = await getGoogleAccessToken(env, false);
    let headers = forwardRangeHeaders(request.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);

    let res = await fetch(mediaUrl, {
      method: request.method,
      headers,
      redirect: 'follow'
    });

    if (res.status === 401) {
      cancelBody(res);
      accessToken = await getGoogleAccessToken(env, true);
      headers = forwardRangeHeaders(request.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      res = await fetch(mediaUrl, {
        method: request.method,
        headers,
        redirect: 'follow'
      });
    }

    return res;
  } catch (err) {
    console.error('[media-proxy] Drive API v3 media fetch failed:', err?.message || err);
    return null;
  }
}

function hasGoogleOAuth(env) {
  return Boolean(
    env?.GOOGLE_CLIENT_ID &&
    env?.GOOGLE_CLIENT_SECRET &&
    env?.GOOGLE_REFRESH_TOKEN
  );
}

async function getGoogleAccessToken(env, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedGoogleToken && cachedGoogleToken.expiresAtMs - now > TOKEN_REFRESH_SKEW_MS) {
    return cachedGoogleToken.accessToken;
  }

  if (!forceRefresh && tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    const body = new URLSearchParams({
      client_id: String(env.GOOGLE_CLIENT_ID).trim(),
      client_secret: String(env.GOOGLE_CLIENT_SECRET).trim(),
      refresh_token: String(env.GOOGLE_REFRESH_TOKEN).trim(),
      grant_type: 'refresh_token'
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`Google OAuth token refresh failed (${response.status})`);
    }

    const data = await response.json();
    if (!data?.access_token) {
      throw new Error('Google OAuth response missing access_token');
    }

    const expiresInSec = Math.max(60, Number(data.expires_in || 3600));
    cachedGoogleToken = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + expiresInSec * 1000
    };
    return cachedGoogleToken.accessToken;
  })();

  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

function isHtmlOrErrorResponse(res) {
  if (!res) return true;
  if (res.status >= 400) return true;
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  return contentType.includes('text/html') || contentType.includes('application/xhtml');
}

function cancelBody(res) {
  try {
    res?.body?.cancel?.();
  } catch {
    // Ignore stream cancellation errors
  }
}

async function proxyOpaqueUpload(request, route, env) {
  const secrets = getCandidateSecrets(env);
  if (secrets.length === 0) return withCors(json({ error: 'Upload is temporarily unavailable' }, 503), request);

  let payload = null;
  for (const secret of secrets) {
    payload = await decryptOpaqueToken(route.token, secret);
    if (payload && payload.purpose === 'resumable' && isSafeUploadTarget(payload.uploadUrl)) {
      break;
    }
  }

  if (!payload || payload.purpose !== 'resumable' || !isSafeUploadTarget(payload.uploadUrl)) {
    return withCors(json({ error: 'Upload session is invalid or expired' }, 403), request);
  }

  const upstream = await fetch(payload.uploadUrl, {
    method: 'PUT',
    headers: forwardUploadHeaders(request.headers),
    body: request.body,
    redirect: 'manual'
  });
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'range', 'retry-after']) {
    copyHeader(upstream.headers, headers, name);
  }
  headers.set('Cache-Control', 'no-store');
  const isNullBodyStatus = upstream.status === 204 || upstream.status === 304;
  return withCors(new Response(isNullBodyStatus ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  }), request);
}

async function proxyLegacyMedia(request, url, env, ctx) {
  const isFileProxy = url.pathname.startsWith('/uc');
  if (isFileProxy) {
    const legacyId = url.searchParams.get('id');
    if (isSafeDriveId(legacyId)) {
      const upstream = await fetchDriveBinary(request, legacyId, 'unknown', env);
      if (!upstream || isHtmlOrErrorResponse(upstream)) {
        cancelBody(upstream);
        const errorRes = json({ error: 'Media is temporarily unavailable' }, 502);
        errorRes.headers.set('Cache-Control', 'no-store');
        return withCors(errorRes, request);
      }
      const headers = new Headers(upstream.headers);
      headers.delete('location');
      headers.delete('set-cookie');
      headers.set('Cache-Control', 'no-store');
      const isNullBodyStatus = upstream.status === 204 || upstream.status === 304;
      return withCors(new Response(isNullBodyStatus ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      }), request);
    }
  }

  const targetUrl = isFileProxy
    ? `https://drive.google.com${url.pathname}${url.search}`
    : `https://lh3.googleusercontent.com${url.pathname}${url.search}`;
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cacheKey = new Request(url.toString(), { method: 'GET' });

  let response = isFileProxy || !cache ? null : await cache.match(cacheKey);
  if (response && isHtmlOrErrorResponse(response)) {
    response = null;
  }

  if (!response) {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardRangeHeaders(request.headers),
      redirect: 'follow'
    });
    if (isHtmlOrErrorResponse(upstream)) {
      cancelBody(upstream);
      const errorRes = json({ error: 'Media is temporarily unavailable' }, 502);
      errorRes.headers.set('Cache-Control', 'no-store');
      return withCors(errorRes, request);
    }

    const headers = new Headers(upstream.headers);
    headers.delete('location');
    headers.delete('set-cookie');
    headers.set('Cache-Control', isFileProxy
      ? 'no-store'
      : 'public, max-age=2592000, s-maxage=2592000');
    const isNullBodyStatus = upstream.status === 204 || upstream.status === 304;
    response = new Response(isNullBodyStatus ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });

    if (!isFileProxy && cache && ctx && request.method === 'GET' && !request.headers.has('Range') && upstream.status === 200) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
  }

  return withCors(response, request);
}

function getMediaRoute(url) {
  const match = url.pathname.match(/^\/media\/([^/]+)(\/download)?$/);
  if (!match) return null;
  let token;
  try {
    token = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return { token, download: Boolean(match[2]) };
}

function getUploadRoute(url) {
  const match = url.pathname.match(/^\/upload\/([^/]+)$/);
  if (!match) return null;
  let token;
  try {
    token = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return { token };
}

async function decryptOpaqueToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;

  const iv = decodeBase64Url(parts[1]);
  const tag = decodeBase64Url(parts[2]);
  const ciphertext = decodeBase64Url(parts[3]);
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext) return null;

  const trimmedSecret = String(secret || '').trim().replace(/^["']|["']$/g, '');
  const secretBytes = /^[0-9a-f]{64}$/i.test(trimmedSecret)
    ? hexToBytes(trimmedSecret)
    : new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(trimmedSecret)));
  if (!secretBytes || secretBytes.length !== 32) return null;

  const key = await crypto.subtle.importKey('raw', secretBytes, 'AES-GCM', false, ['decrypt']);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);

  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, combined);
    const payload = JSON.parse(new TextDecoder().decode(plain));
    if (payload.exp && Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function forwardRangeHeaders(headers) {
  const output = new Headers();
  for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
    const value = headers.get(name);
    if (value) output.set(name, value);
  }
  return output;
}

function forwardUploadHeaders(headers) {
  const output = new Headers();
  for (const name of ['content-type', 'content-length', 'content-range', 'x-goog-upload-command', 'x-goog-upload-offset']) {
    const value = headers.get(name);
    if (value) output.set(name, value);
  }
  return output;
}

function copyHeader(source, target, name) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && (
      hostname === 'event-vn.com' ||
      hostname.endsWith('.event-vn.com') ||
      hostname.endsWith('.vercel.app')
    );
  } catch {
    return false;
  }
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  } else {
    headers.set('Access-Control-Allow-Origin', '*');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, If-Range, If-None-Match, If-Modified-Since, Content-Type, Content-Range, X-Upload-Content-Type, X-Upload-Content-Length');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');

  const isNullBodyStatus = response.status === 204 || response.status === 304;
  return new Response(isNullBodyStatus ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function isSafeDriveId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{3,256}$/.test(value);
}

function isSafeUploadTarget(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'www.googleapis.com' || url.hostname.endsWith('.googleapis.com'))
      && url.pathname === '/upload/drive/v3/files';
  } catch {
    return false;
  }
}

function clampImageSize(value) {
  const size = Number.parseInt(value || '1080', 10);
  if (!Number.isFinite(size)) return 1080;
  return Math.min(Math.max(size, 200), 2560);
}

function safeFileName(value, kind) {
  const fallback = kind === 'video' ? 'event-video.mp4' : 'event-photo.jpg';
  const name = String(value || fallback).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
  return name.slice(0, 180) || fallback;
}

function decodeBase64Url(value) {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(normalized);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hexToBytes(value) {
  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i++) output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return output;
}

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
 * The Worker is allowed to know the Google Drive implementation. The public
 * gallery is not: new requests use /media/<encrypted-token>, so Drive ids and
 * provider URLs never need to be returned by the gallery API.
 *
 * Required secret:
 *   MEDIA_TOKEN_SECRET = the same 32-byte secret used by api/_media-token.js
 *
 * Legacy /uc and /d requests are kept temporarily so older QR links continue
 * to work while the gallery frontend migrates to encrypted media tokens.
 */

const ALLOWED_ORIGINS = new Set([
  'https://tanh.event-vn.com',
  'https://tachtach.event-vn.com',
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

      // Compatibility for old gallery bundles and QR links. This branch may
      // still contain a Drive id because it is deliberately transitional.
      return await proxyLegacyMedia(request, url, ctx);
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
  const shouldCache = !route.download && request.method === 'GET' && !request.headers.has('Range');

  if (cache && shouldCache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return withCors(cachedResponse, request);
    }
  }

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

  const size = clampImageSize(url.searchParams.get('size'));
  const isThumbnail = url.searchParams.get('variant') === 'thumbnail';
  const targetUrl = buildOpaqueTarget(payload, route.download, isThumbnail, size);
  const upstreamHeaders = forwardRangeHeaders(request.headers);
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'follow'
  });

  const headers = new Headers();
  copyHeader(upstream.headers, headers, 'content-type');
  copyHeader(upstream.headers, headers, 'content-length');
  copyHeader(upstream.headers, headers, 'content-range');
  copyHeader(upstream.headers, headers, 'accept-ranges');
  copyHeader(upstream.headers, headers, 'etag');
  copyHeader(upstream.headers, headers, 'last-modified');

  if (payload.kind === 'video' && !isThumbnail) {
    headers.set('Content-Type', payload.mimeType || 'video/mp4');
    headers.set('Cache-Control', 'no-store');
    headers.set('Accept-Ranges', 'bytes');
  } else {
    headers.set('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }

  if (route.download) {
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(payload.name, payload.kind))}`);
    headers.set('Cache-Control', 'no-store');
  }

  const response = withCors(new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  }), request);

  if (cache && shouldCache && ctx && upstream.status === 200) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
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
  return withCors(new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  }), request);
}

function buildOpaqueTarget(payload, download, isThumbnail, size) {
  if (payload.kind === 'video' || download) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(payload.fileId)}`;
  }
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(payload.fileId)}=s${size}-rw`;
}

async function proxyLegacyMedia(request, url, ctx) {
  const isFileProxy = url.pathname.startsWith('/uc');
  const targetUrl = isFileProxy
    ? `https://drive.google.com${url.pathname}${url.search}`
    : `https://lh3.googleusercontent.com${url.pathname}${url.search}`;
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });

  let response = isFileProxy ? null : await cache.match(cacheKey);
  if (!response) {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardRangeHeaders(request.headers),
      redirect: 'follow'
    });
    const headers = new Headers(upstream.headers);
    headers.delete('location');
    headers.delete('set-cookie');
    headers.set('Cache-Control', isFileProxy
      ? 'no-store'
      : 'public, max-age=2592000, s-maxage=2592000');
    response = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });

    if (!isFileProxy && request.method === 'GET' && !request.headers.has('Range') && upstream.status === 200) {
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

function withCors(response, request) {
  const origin = request.headers.get('Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  } else {
    response.headers.set('Access-Control-Allow-Origin', '*');
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Range, If-Range, If-None-Match, If-Modified-Since, Content-Type, Content-Range, X-Upload-Content-Type, X-Upload-Content-Length');
  response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
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

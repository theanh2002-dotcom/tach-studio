import { fetchWithTimeout, getGoogleAccessToken } from './_google-oauth.js';
import { createMediaToken, createStableMediaId } from './_media-token.js';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY;
const MEDIA_PROXY_URL = process.env.PUBLIC_MEDIA_PROXY_URL || 'https://image-photobooth.laihoanganh456.workers.dev';
const GALLERY_RESOLVER_URL = process.env.GALLERY_RESOLVER_URL || 'https://tanhbooth-api.laihoanganh456.workers.dev';
const GALLERY_RESOLVER_SECRET = process.env.GALLERY_RESOLVER_SECRET || 'theanh2002';
const ALLOWED_ORIGINS = new Set([
  'https://tanh.event-vn.com',
  'https://luxe-agency-vn.vercel.app',
  'http://localhost:4200',
  'http://127.0.0.1:4200'
]);

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const requestedId = firstQueryValue(req.query?.id ?? req.query?.publicId ?? req.query?.folderId);
  const legacyQueryValue = firstQueryValue(req.query?.m);
  const sessionPublicId = firstQueryValue(req.query?.s);
  const cursor = firstQueryValue(req.query?.cursor);
  if ((!isSafeId(requestedId) && !isSafeId(legacyQueryValue)) || (legacyQueryValue && !isSafeId(legacyQueryValue))) {
    res.status(400).json({ error: 'Gallery identifier is invalid' });
    return;
  }
  if (sessionPublicId && !isSessionPublicId(sessionPublicId)) {
    res.status(400).json({ error: 'Session identifier is invalid' });
    return;
  }
  if (sessionPublicId && !isEventPublicId(requestedId)) {
    res.status(400).json({ error: 'Session filter requires an event identifier' });
    return;
  }
  if (sessionPublicId && legacyQueryValue) {
    res.status(400).json({ error: 'Session and legacy manifest filters cannot be combined' });
    return;
  }
  if (cursor && (!isCursor(cursor) || sessionPublicId || legacyQueryValue || !isEventPublicId(requestedId))) {
    res.status(400).json({ error: 'Gallery cursor is invalid' });
    return;
  }

  try {
    const source = await resolveGallerySource(requestedId, legacyQueryValue, sessionPublicId, cursor);
    if (source.status === 'PENDING') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        mode: sessionPublicId ? 'SESSION' : 'EVENT',
        status: 'PENDING',
        event: requestedId,
        session: sessionPublicId || null,
        items: [],
        pollAfterMs: 5000,
        nextCursor: null
      });
      return;
    }
    const mode = legacyQueryValue || !isEventPublicId(requestedId) ? 'LEGACY' : (sessionPublicId ? 'SESSION' : 'EVENT');
    let sessions = [];
    let media = [];

    if (mode === 'EVENT' && source.files) {
      sessions = buildSessionGroups(source.files);
      // Trang sự kiện ở ngoài: chỉ lấy các ảnh final làm ảnh bìa cho từng phiên
      media = sessions.map(s => s.finalPhoto).filter(Boolean);
    } else {
      media = source.files
        ? source.files.map(file => toPublicMedia(file, parseSessionMediaName(file?.name)))
        : normalizeManifest(source.manifest).map(item => toPublicMedia(item));
    }

    // Giữ polling tối đa 5 giây nhưng cho phép browser cache cùng response,
    // tránh gọi lại API vô ích giữa các lần render trên mobile.
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5, stale-while-revalidate=10');
    const status = mode === 'SESSION' && media.length === 0 ? 'PENDING' : 'READY';
    res.status(200).json({
      mode,
      status,
      event: isEventPublicId(requestedId) ? requestedId : null,
      session: sessionPublicId || null,
      sessions,
      items: media,
      pollAfterMs: status === 'PENDING' ? 5000 : null,
      nextCursor: source.nextCursor || null
    });
  } catch (error) {
    console.error('[gallery] gallery request failed:', error?.message || error);
    res.status(502).json({ error: 'Gallery is temporarily unavailable' });
  }
}

async function resolveGallerySource(requestedId, legacyQueryValue, sessionPublicId, cursor) {
  if (legacyQueryValue) {
    return { manifest: await readDriveJson(legacyQueryValue), nextCursor: null };
  }
  if (!isSafeId(requestedId)) throw new Error('Gallery folder is invalid');
  if (isEventPublicId(requestedId)) {
    const resolved = await resolveEventFolder(requestedId);
    if (resolved.status !== 'READY') return { status: 'PENDING' };
    const page = await listMediaFiles(resolved.driveFolderId, sessionPublicId || null, true, cursor || null, true, true);
    return { status: 'READY', files: page.files, nextCursor: page.nextCursor };
  }
  const page = await listMediaFiles(requestedId, null, false, null, true);
  return { files: page.files, nextCursor: null };
}

async function resolveEventFolder(eventPublicId) {
  const secret = (GALLERY_RESOLVER_SECRET || '').trim();
  if (secret && GALLERY_RESOLVER_URL) {
    try {
      const response = await fetchWithTimeout(
        `${GALLERY_RESOLVER_URL.replace(/\/$/, '')}/v1/gallery/events/${encodeURIComponent(eventPublicId)}/folder`,
        {
          headers: {
            Authorization: `Bearer ${secret}`,
            Accept: 'application/json'
          }
        }
      );
      if (response.ok) {
        const payload = await response.json();
        if (payload?.status === 'PENDING') return { status: 'PENDING' };
        if (payload?.status === 'READY' && isSafeId(payload?.driveFolderId)) {
          return { status: 'READY', driveFolderId: payload.driveFolderId };
        }
      } else {
        console.warn(`[gallery] Resolver worker returned ${response.status}, falling back to direct Drive search.`);
      }
    } catch (err) {
      console.warn('[gallery] Resolver worker error, falling back to direct Drive search:', err?.message || err);
    }
  }

  // Fallback: Direct Google Drive search for folder SB_Event_{eventPublicId}
  try {
    const folderName = `SB_Event_${eventPublicId}`;
    const query = `name = '${escapeDriveLiteral(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchResult = await driveList(query, 'files(id,name)', null, false);
    if (searchResult?.files && searchResult.files.length > 0) {
      const folderId = searchResult.files[0]?.id;
      if (isSafeId(folderId)) {
        return { status: 'READY', driveFolderId: folderId };
      }
    }
  } catch (driveErr) {
    console.error('[gallery] Direct Drive search failed:', driveErr?.message || driveErr);
  }

  return { status: 'PENDING' };
}

async function listMediaFiles(folderId, sessionPublicId = null, canonicalOnly = true, cursor = null, loadAllPages = false, showAllEventMedia = true) {
  const prefix = sessionPublicId ? `SB_${sessionPublicId}_` : null;
  const query = [
    `'${escapeDriveLiteral(folderId)}' in parents`,
    'trashed = false',
    `(mimeType contains 'image/' or mimeType contains 'video/')`,
    ...(prefix ? [`name contains '${escapeDriveLiteral(prefix)}'`] : [])
  ].join(' and ');
  const page = await driveList(query, 'files(id,name,mimeType,size,createdTime,modifiedTime)', cursor, loadAllPages);
  const filtered = !canonicalOnly ? page.files : page.files.filter(file => {
    if (sessionPublicId) {
      return isCanonicalSessionMedia(file?.name, sessionPublicId);
    }
    return showAllEventMedia ? isCanonicalEventMedia(file?.name) : isCanonicalEventFinal(file?.name);
  });

  // Deduplicate files by name to prevent duplicate displays
  const seenNames = new Set();
  const uniqueFiles = [];
  for (const f of filtered) {
    const normName = (f.name || '').toLowerCase().trim();
    if (!seenNames.has(normName)) {
      seenNames.add(normName);
      uniqueFiles.push(f);
    }
  }
  return { files: uniqueFiles.sort(compareMediaItems), nextCursor: page.nextCursor };
}

async function readDriveJson(fileId) {
  const response = await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`);
  if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
  return response.json();
}

async function driveList(query, fields, initialCursor = null, loadAllPages = false) {
  const result = [];
  let pageToken = initialCursor || '';
  do {
    const pageFields = `nextPageToken,${fields}`;
    const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(pageFields)}&orderBy=createdTime desc&pageSize=100${page}`;
    const response = await driveFetch(url);
    if (!response.ok) throw new Error(`Drive list failed (${response.status})`);
    const data = await response.json();
    if (Array.isArray(data.files)) result.push(...data.files);
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
  } while (loadAllPages && pageToken && result.length < 1000);
  return { files: result, nextCursor: loadAllPages ? null : (pageToken || null) };
}

async function driveFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (hasOAuthConfiguration()) {
    const accessToken = await getGoogleAccessToken();
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetchWithTimeout(url, { ...options, headers });
  }

  if (!DRIVE_API_KEY) throw new Error('Missing Google Drive authentication');
  const separator = url.includes('?') ? '&' : '?';
  return fetchWithTimeout(`${url}${separator}key=${encodeURIComponent(DRIVE_API_KEY)}`, {
    ...options,
    headers
  });
}

function hasOAuthConfiguration() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

function normalizeManifest(manifest) {
  const items = Array.isArray(manifest) ? manifest : [];
  const sessionItems = items.filter(item =>
    item?.fileId && ['final', 'photo', 'video'].includes(String(item.type || '').toLowerCase())
  );
  if (sessionItems.length > 0) return sessionItems.sort(compareMediaItems);

  // Event manifests historically contain one final file per session.
  return items
    .filter(item => item?.type === 'session' && item?.fileId)
    .map(item => ({
      fileId: item.fileId,
      type: 'final',
      name: `Session ${item.sessionId || ''}`.trim(),
      createdTime: item.createdTime
    }))
    .sort(compareMediaItems);
}

function parseSessionMediaName(name) {
  const match = /^SB_(ses_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15})_(final|shot_([1-9][0-9]*)|bts)\.(jpe?g|png|webp|mp4|m4v|webm|mov)$/i.exec(String(name || ''));
  if (!match) return null;
  const sessionId = match[1];
  const roleType = match[2].toLowerCase();
  const role = roleType.startsWith('shot_') ? 'shot' : roleType;
  const slotIndex = match[3] ? parseInt(match[3], 10) : null;

  let timestamp = 0;
  try {
    const hex = sessionId.slice(4, 16);
    timestamp = parseInt(hex, 16);
  } catch {
    timestamp = 0;
  }
  return { sessionId, role, slotIndex, timestamp };
}

function buildSessionGroups(files) {
  const sessionMap = new Map();

  for (const file of files) {
    const meta = parseSessionMediaName(file?.name);
    if (!meta) continue;

    if (!sessionMap.has(meta.sessionId)) {
      sessionMap.set(meta.sessionId, {
        sessionId: meta.sessionId,
        timestamp: meta.timestamp || parseMediaTime(file),
        finalPhoto: null,
        shots: [],
        btsVideo: null,
        otherMedia: []
      });
    }

    const group = sessionMap.get(meta.sessionId);
    const publicMedia = toPublicMedia(file, meta);

    if (meta.role === 'final') {
      group.finalPhoto = publicMedia;
    } else if (meta.role === 'shot') {
      group.shots.push(publicMedia);
    } else if (meta.role === 'bts') {
      group.btsVideo = publicMedia;
    } else {
      group.otherMedia.push(publicMedia);
    }
  }

  // Sắp xếp các phiên mới nhất lên đầu
  const sortedSessions = Array.from(sessionMap.values()).sort((a, b) => b.timestamp - a.timestamp);

  return sortedSessions.map((s, index) => {
    s.shots.sort((a, b) => (a.slotIndex || 0) - (b.slotIndex || 0));

    const coverPhoto = s.finalPhoto || s.shots[0] || s.btsVideo;
    const allMedia = [];
    if (s.finalPhoto) allMedia.push(s.finalPhoto);
    allMedia.push(...s.shots);
    if (s.btsVideo) allMedia.push(s.btsVideo);
    allMedia.push(...s.otherMedia);

    let timeFormatted = '';
    if (s.timestamp) {
      const d = new Date(s.timestamp);
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      timeFormatted = `${hours}:${mins}`;
    }

    const sessionNumber = sortedSessions.length - index;

    // Đảm bảo coverPhoto có thông tin tóm tắt của phiên
    const finalPhoto = s.finalPhoto || coverPhoto;
    if (finalPhoto) {
      finalPhoto.sessionInfo = {
        sessionId: s.sessionId,
        sessionNumber,
        timeFormatted,
        shotCount: s.shots.length,
        hasBts: Boolean(s.btsVideo),
        totalMediaCount: allMedia.length
      };
    }

    return {
      sessionId: s.sessionId,
      sessionNumber,
      timestamp: s.timestamp,
      timeFormatted,
      finalPhoto,
      shots: s.shots,
      btsVideo: s.btsVideo,
      allMedia,
      mediaCount: allMedia.length
    };
  });
}

function toPublicMedia(item, roleMeta = null) {
  const fileId = item.fileId || item.id;
  const mimeType = item.mimeType || inferMimeType(item.type, item.name);
  const kind = mimeType.startsWith('video/') || String(item.type || '').toLowerCase() === 'video'
    ? 'video'
    : 'image';

  let defaultName = kind === 'video' ? 'Video sự kiện' : 'Ảnh sự kiện';
  if (roleMeta) {
    if (roleMeta.role === 'final') defaultName = 'Ảnh in sự kiện';
    else if (roleMeta.role === 'shot') defaultName = `Ảnh chụp ${roleMeta.slotIndex || ''}`.trim();
    else if (roleMeta.role === 'bts') defaultName = 'Video hậu trường';
  }

  const mediaToken = createMediaToken({
    fileId,
    kind,
    mimeType,
    name: sanitizeName(item.name || defaultName)
  });
  const mediaBase = `${MEDIA_PROXY_URL.replace(/\/$/, '')}/media/${mediaToken}`;

  return {
    id: createStableMediaId({ fileId, kind }),
    name: sanitizeName(item.name || defaultName),
    kind,
    mimeType,
    role: roleMeta?.role || (kind === 'video' ? 'bts' : 'image'),
    slotIndex: roleMeta?.slotIndex || null,
    sessionId: roleMeta?.sessionId || null,
    createdAt: item.createdTime || item.modifiedTime || new Date().toISOString(),
    thumbnailUrl: kind === 'video' ? mediaBase : `${mediaBase}?variant=image&size=2560`,
    mediaUrl: kind === 'video' ? mediaBase : `${mediaBase}?variant=image&size=2560`,
    lightboxUrl: kind === 'video' ? mediaBase : `${mediaBase}?variant=image&size=2560`,
    downloadUrl: `${mediaBase}/download`
  };
}

function compareMediaItems(left, right) {
  const leftMeta = parseSessionMediaName(left?.name);
  const rightMeta = parseSessionMediaName(right?.name);

  // 1. Nếu cả 2 file cùng thuộc một phiên chụp
  if (leftMeta && rightMeta && leftMeta.sessionId === rightMeta.sessionId) {
    const roleRank = role => (role === 'final' ? 1 : (role === 'shot' ? 2 : (role === 'bts' ? 3 : 4)));
    const rankDiff = roleRank(leftMeta.role) - roleRank(rightMeta.role);
    if (rankDiff !== 0) return rankDiff;
    if (leftMeta.role === 'shot' && rightMeta.role === 'shot') {
      return (leftMeta.slotIndex || 0) - (rightMeta.slotIndex || 0);
    }
  }

  // 2. Sắp xếp giữa các phiên khác nhau theo timestamp giảm dần (mới nhất lên đầu)
  const leftTime = leftMeta?.timestamp || parseMediaTime(left);
  const rightTime = rightMeta?.timestamp || parseMediaTime(right);
  if (leftTime !== rightTime) return rightTime - leftTime;

  // 3. Fallback theo tên file
  return String(left?.name || '').localeCompare(String(right?.name || ''));
}

function parseMediaTime(item) {
  const raw = item?.createdTime || item?.createdAt || item?.modifiedTime;
  const value = Date.parse(raw || '');
  return Number.isNaN(value) ? 0 : value;
}

function inferMimeType(type, name) {
  if (String(type || '').toLowerCase() === 'video' || /\.(mp4|m4v|webm|mov|ogg)$/i.test(name || '')) {
    return 'video/mp4';
  }
  return 'image/jpeg';
}

function sanitizeName(value) {
  return String(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 180) || 'Media';
}

function escapeDriveLiteral(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isSafeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{3,256}$/.test(value);
}

function isCursor(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~+/=-]{1,2048}$/.test(value);
}

function isEventPublicId(value) {
  return typeof value === 'string' && /^evt_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/.test(value);
}

function isSessionPublicId(value) {
  return typeof value === 'string' && /^ses_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/.test(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCanonicalSessionMedia(name, sessionPublicId) {
  const prefix = escapeRegExp(`SB_${sessionPublicId}_`);
  return new RegExp(`^${prefix}(?:final|shot_[1-9][0-9]*|bts)\\.(?:jpe?g|png|webp|mp4|m4v|webm|mov)$`, 'i').test(String(name || ''));
}

function isCanonicalEventFinal(name) {
  return /^SB_ses_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}_final\.(?:jpe?g|png|webp)$/i.test(String(name || ''));
}

function isCanonicalEventMedia(name) {
  return /^SB_ses_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}_(?:final|shot_[1-9][0-9]*|bts)\.(?:jpe?g|png|webp|mp4|m4v|webm|mov)$/i.test(String(name || ''));
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

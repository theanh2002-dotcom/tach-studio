import { fetchWithTimeout, getGoogleAccessToken } from './_google-oauth.js';
import { createResumableUploadToken, decryptUploadToken } from './_upload-token.js';
import { getSystemConfig } from './_config.js';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const RAW_EXTENSIONS = new Set([
  '3fr', 'arw', 'cr2', 'cr3', 'dcr', 'dng', 'erf', 'iiq', 'k25', 'kdc',
  'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'raf', 'raw', 'rw2',
  'rwl', 'sr2', 'srf', 'srw', 'x3f'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { uploadSessionToken, fileName, mimeType, fileSize } = req.body || {};
  if (!uploadSessionToken || !fileName || !isSupportedImage(fileName, mimeType)
      || !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
    return res.status(400).json({ error: 'Invalid upload metadata' });
  }

  try {
    const uploadSession = decryptUploadToken(uploadSessionToken);
    const folderId = uploadSession?.folderId;
    if (uploadSession?.purpose !== 'folder' || !folderId) {
      return res.status(403).json({ error: 'Upload session is invalid or expired' });
    }

    const origin = getAllowedOrigin(req);
    if (!origin) {
      return res.status(403).json({ error: 'Upload origin is not allowed' });
    }

    const accessToken = await getGoogleAccessToken();
    const config = await getSystemConfig();
    const rootFolderId = config.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (!rootFolderId || !await isAllowedUploadFolder(folderId, rootFolderId, accessToken)) {
      return res.status(403).json({ error: 'Upload folder is not allowed' });
    }

    const safeFileName = sanitizeFileName(fileName);
    const driveResponse = await fetchWithTimeout(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(fileSize),
          Origin: origin
        },
        body: JSON.stringify({ name: safeFileName, parents: [folderId] })
      }
    );

    if (!driveResponse.ok) {
      const details = await driveResponse.text();
      console.error('[create-upload-session] storage provider rejected upload session:', details);
      return res.status(502).json({ error: 'Could not prepare upload' });
    }

    const uploadUrl = driveResponse.headers.get('location');
    if (!uploadUrl) {
      return res.status(502).json({ error: 'Could not prepare upload' });
    }

    const proxyBaseUrl = process.env.PUBLIC_MEDIA_PROXY_URL || 'https://image-photobooth.laihoanganh456.workers.dev';
    const uploadProxyToken = createResumableUploadToken({ uploadUrl, mimeType, fileSize });
    return res.status(200).json({
      uploadUrl: `${proxyBaseUrl.replace(/\/$/, '')}/upload/${uploadProxyToken}`
    });
  } catch (error) {
    console.error('[create-upload-session] failed:', error?.message || error);
    return res.status(500).json({ error: 'Could not prepare upload' });
  }
}

function isSupportedImage(fileName, mimeType) {
  if (ALLOWED_IMAGE_TYPES.has(mimeType)) return true;
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return RAW_EXTENSIONS.has(extension)
    && (mimeType === 'application/octet-stream' || mimeType === '');
}

async function isAllowedUploadFolder(folderId, rootFolderId, accessToken) {
  const response = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=mimeType,parents,trashed`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) return false;

  const folder = await response.json();
  return folder.mimeType === 'application/vnd.google-apps.folder'
    && folder.trashed === false
    && folder.parents?.includes(rootFolderId);
}

function sanitizeFileName(value) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'image';
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;

  try {
    const originUrl = new URL(origin);
    const requestHost = req.headers['x-forwarded-host'] || req.headers.host;
    const isLocal = originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost';
    const validProtocol = originUrl.protocol === 'https:' || (isLocal && originUrl.protocol === 'http:');
    return validProtocol && originUrl.host === requestHost ? origin : null;
  } catch {
    return null;
  }
}

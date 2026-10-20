import { fetchWithTimeout, getGoogleAccessToken } from './_google-oauth.js';
import { createUploadToken } from './_upload-token.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { name, phone } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Missing name or phone number' });
  }

  const phoneRegex = /^0\d{9}$/;
  if (!phoneRegex.test(phone.trim())) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ (phải bắt đầu bằng số 0 và có đúng 10 chữ số).' });
  }

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    return res.status(500).json({ error: 'Storage configuration is missing' });
  }

  try {
    const accessToken = await getGoogleAccessToken();
    const dateStr = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date()).replace(/\//g, '-');

    const folderMetadata = {
      name: `${phone} - ${dateStr}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId]
    };

    const storageResponse = await fetchWithTimeout('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(folderMetadata)
    });

    if (!storageResponse.ok) {
      const errorText = await storageResponse.text();
      console.error('[create-upload-folder] storage provider rejected folder creation:', errorText);
      return res.status(502).json({ error: 'Could not prepare storage folder' });
    }

    const folderData = await storageResponse.json();
    if (!folderData.id) {
      return res.status(502).json({ error: 'Storage folder was not created' });
    }

    // The browser only receives a short-lived opaque capability. The actual
    // storage folder id stays inside server-side state and Telegram delivery.
    const uploadSessionToken = createUploadToken({ purpose: 'folder', folderId: folderData.id });
    return res.status(200).json({ uploadSessionToken });
  } catch (error) {
    console.error('[create-upload-folder] failed:', error?.message || error);
    return res.status(500).json({ error: 'Could not prepare storage folder' });
  }
}

const SOFTWARE_DOWNLOAD_URL = process.env.SOFTWARE_DOWNLOAD_URL || 'https://tanhbooth-api.laihoanganh456.workers.dev/download/latest';
const LEGACY_SOFTWARE_FILE_ID = '17YxcpKz7c4LiwS9Drmlz9oy8Sw_3RgIj';

export default async function handler(req, res) {
  const requestedFileId = req.query?.id || LEGACY_SOFTWARE_FILE_ID;

  try {
    const fileId = requestedFileId;
    const initUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
    
    const response = await fetch(initUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const disposition = response.headers.get('content-disposition');
    if (disposition) {
      res.setHeader('Location', initUrl);
      res.status(302).end();
      return;
    }

    const html = await response.text();
    const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
    if (uuidMatch && uuidMatch[1]) {
      const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t&uuid=${uuidMatch[1]}`;
      res.setHeader('Location', directUrl);
      res.status(302).end();
      return;
    }

    // Fallback if UUID not found
    const fallbackUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    res.setHeader('Location', fallbackUrl);
    res.status(302).end();
  } catch (error) {
    console.error('[download-software] resolver error:', error);
    res.setHeader('Location', `https://drive.google.com/uc?export=download&id=${LEGACY_SOFTWARE_FILE_ID}`);
    res.status(302).end();
  }
}

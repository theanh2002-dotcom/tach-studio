const SOFTWARE_DOWNLOAD_URL = process.env.SOFTWARE_DOWNLOAD_URL || 'https://tanhbooth-api.laihoanganh456.workers.dev/download/latest';

export default async function handler(req, res) {
  const requestedFileId = typeof req.query?.id === 'string' ? req.query.id.trim() : '';

  if (!requestedFileId) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', SOFTWARE_DOWNLOAD_URL);
    res.status(302).end();
    return;
  }

  try {
    const initUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(requestedFileId)}&export=download`;
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
      const directUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(requestedFileId)}&export=download&confirm=t&uuid=${uuidMatch[1]}`;
      res.setHeader('Location', directUrl);
      res.status(302).end();
      return;
    }

    res.setHeader('Location', `https://drive.usercontent.google.com/download?id=${encodeURIComponent(requestedFileId)}&export=download&confirm=t`);
    res.status(302).end();
  } catch (error) {
    console.error('[download-software] resolver error:', error);
    res.setHeader('Location', SOFTWARE_DOWNLOAD_URL);
    res.status(302).end();
  }
}

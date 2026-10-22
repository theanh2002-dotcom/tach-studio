import { decryptUploadToken } from './_upload-token.js';
import { getSystemConfig } from './_config.js';

export default async function handler(req, res) {
  // CORS Headers
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

  const { name, phone, quantity, uniquePhotos, uploadSessionToken, photos } = req.body;
  if (!name || !phone || quantity === undefined || uniquePhotos === undefined || !uploadSessionToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const phoneRegex = /^0\d{9}$/;
  if (!phoneRegex.test(phone.trim())) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ (phải bắt đầu bằng số 0 và có đúng 10 chữ số).' });
  }

  const numPhotos = parseInt(quantity, 10);
  const numUnique = parseInt(uniquePhotos, 10);
  if (isNaN(numPhotos) || numPhotos <= 0 || isNaN(numUnique) || numUnique <= 0) {
    return res.status(400).json({ error: 'Invalid photo quantity' });
  }

  const uploadSession = decryptUploadToken(uploadSessionToken);
  const folderId = uploadSession?.folderId;
  if (uploadSession?.purpose !== 'folder' || !folderId) {
    return res.status(403).json({ error: 'Upload session is invalid or expired' });
  }
  const folderLink = `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;

  const config = await getSystemConfig();
  const botToken = config.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = config.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ error: 'Missing Telegram configuration' });
  }

  // Calculate pricing (Server-side validation)
  const unitPrice = numPhotos > 5 ? 15000 : 20000;
  const totalPrice = numPhotos * unitPrice;

  // Format currency in VND
  const formatVND = (amount) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  };

  const pricingNote = numPhotos > 5 ? ' (Áp dụng giá in ưu đãi > 5 ảnh)' : '';

  // Escape HTML helper
  const escapeHTML = (text) => {
    return text.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  const safeName = escapeHTML(name);
  const safePhone = escapeHTML(phone);

  let photosList = '';
  if (Array.isArray(photos) && photos.length > 0) {
    photosList = '\n📋 <b>Chi tiết in ảnh:</b>\n' + photos.map((p, idx) => {
      const safeFileName = escapeHTML(p.name);
      return `${idx + 1}. <code>${safeFileName}</code> x <b>${p.quantity} bản</b>`;
    }).join('\n') + '\n--------------------------------------\n';
  }

  const htmlMessage = `<b>📸 ĐƠN IN ẢNH MỚI!</b>
--------------------------------------
👤 <b>Khách hàng:</b> ${safeName}
📞 <b>Điện thoại:</b> ${safePhone}
${photosList}🖼️ <b>Số lượng file:</b> ${numUnique} ảnh độc bản
🖨️ <b>Tổng số bản in:</b> ${numPhotos} bản in
💰 <b>Đơn giá:</b> ${formatVND(unitPrice)} / ảnh${pricingNote}
💵 <b>Tổng thanh toán:</b> <b>${formatVND(totalPrice)}</b>
📁 <b>Thư mục ảnh Google Drive:</b> <a href="${folderLink}">Xem ảnh tại đây</a>`;

  try {
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: 'Failed to send Telegram message', details: errorText });
    }

    const resData = await response.json();
    return res.status(200).json({ success: true, totalPrice, unitPrice, messageId: resData.result.message_id });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}

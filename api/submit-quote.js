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

  const { name, phone, service, note, date, timeSlot, backdrop, peopleCount } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Missing required fields (name or phone)' });
  }

  const phoneRegex = /^0\d{9}$/;
  if (!phoneRegex.test(phone.trim())) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ (phải bắt đầu bằng số 0 và có đúng 10 chữ số).' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ error: 'Missing Telegram configuration' });
  }

  const escapeHTML = (text) => {
    return (text || '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  const safeName = escapeHTML(name);
  const safePhone = escapeHTML(phone);
  const safeService = escapeHTML(service || 'Photobooth Studio');
  const safeDate = date ? escapeHTML(date) : '';
  const safeTime = timeSlot ? escapeHTML(timeSlot) : '';
  const safeBackdrop = backdrop ? escapeHTML(backdrop) : '';
  const safePeople = peopleCount ? escapeHTML(peopleCount) : '';
  const safeNote = escapeHTML(note);

  let detailsBlock = '';
  if (safeDate || safeTime || safeBackdrop || safePeople) {
    detailsBlock = `
📅 <b>Ngày chụp:</b> ${safeDate || 'Chưa chọn'}
⏰ <b>Khung giờ:</b> ${safeTime || 'Chưa chọn'}
👥 <b>Số người:</b> ${safePeople || '1-2 người'}
🎨 <b>Phông nền:</b> ${safeBackdrop || 'Tách Tách Signature'}`;
  }

  const text = `📸 <b>CÓ LỊCH ĐẶT PHÒNG TÁCH TÁCH MỚI!</b>
--------------------------------------
👤 <b>Khách hàng:</b> ${safeName}
📞 <b>Điện thoại:</b> ${safePhone}
🎁 <b>Gói dịch vụ:</b> <b>${safeService}</b>${detailsBlock}
📝 <b>Ghi chú:</b> ${safeNote || '<i>Không có</i>'}
--------------------------------------
✨ <i>Vui lòng liên hệ lại khách hàng sớm để xác nhận giữ slot!</i>`;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: 'Failed to send Telegram message', details: errorText });
    }

    const resData = await response.json();
    return res.status(200).json({ success: true, messageId: resData.result.message_id });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}

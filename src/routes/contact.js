const router = require('express').Router();
const { get } = require('../db');

const sanitize = (str, max = 2000) => String(str || '').replace(/<[^>]*>/g, '').trim().slice(0, max);

// POST /api/contact/send
// Frontend faqat {name, phone, subject, message} yuboradi
// Backend o'zi DB dan token/chatId ni oladi
router.post('/send', async (req, res) => {
  const { name, phone, subject, message } = req.body;
  if (!name?.trim() || !phone?.trim() || !message?.trim())
    return res.status(400).json({ error: "Barcha maydonlarni to'ldiring" });

  try {
    // DB dan Telegram ma'lumotlarini olish
    const tokenRow  = await get("SELECT value FROM settings WHERE key='telegram_bot_token'");
    const chatRow   = await get("SELECT value FROM settings WHERE key='telegram_chat_id'");
    const token  = tokenRow?.value?.trim();
    const chatId = chatRow?.value?.trim();

    if (!token || !chatId) {
      // Bot sozlanmagan — baribir muvaffaqiyat deb qaytaramiz
      console.log('[Contact] Telegram sozlanmagan, xabar saqlanmadi');
      return res.json({ ok: true, saved: false });
    }

    const text = [
      `📩 <b>ALOQA FORMASI</b>`,
      ``,
      `👤 <b>Ism:</b> ${sanitize(name, 100)}`,
      `📞 <b>Telefon:</b> ${sanitize(phone, 30)}`,
      `📋 <b>Mavzu:</b> ${sanitize(subject || 'Boshqa', 100)}`,
      ``,
      `💬 <b>Xabar:</b>`,
      sanitize(message, 1000),
    ].join('\n');

    const fetch = require('node-fetch');
    const tgRes = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        timeout: 12000,
      }
    );
    const data = await tgRes.json();

    if (data.ok) {
      return res.json({ ok: true, saved: true });
    } else {
      console.error('[Contact Telegram]', data.description);
      // Telegram xato bo'lsa ham foydalanuvchiga muvaffaqiyat deb aytamiz
      return res.json({ ok: true, saved: false, _err: data.description });
    }
  } catch (e) {
    console.error('[Contact error]', e.message);
    // Tarmoq xatosi bo'lsa ham muvaffaqiyat
    return res.json({ ok: true, saved: false });
  }
});

module.exports = router;

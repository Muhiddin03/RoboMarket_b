const router = require('express').Router();
const { run, get, all } = require('../db');
const authMiddleware = require('../middleware/auth');

const genNum = () => {
  const d = new Date();
  return `RS-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.floor(1000+Math.random()*9000)}`;
};

const fmt = (n) => Number(n || 0).toLocaleString('uz-UZ');

// Telegram xabar yuborish (ishonchli)
const sendTelegram = async (token, chatId, text) => {
  if (!token || !chatId) return;
  try {
    const fetch = require('node-fetch');
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      timeout: 10000,
    });
    const data = await r.json();
    if (!data.ok) console.error('[Telegram]', data.description);
  } catch (e) {
    console.error('[Telegram error]', e.message);
  }
};

// POST /api/orders
router.post('/', async (req, res) => {
  try {
    const { customer_name, customer_phone, delivery_type, customer_city,
            customer_address, payment_method, note, items } = req.body;

    if (!customer_name?.trim()) return res.status(400).json({ error: 'Ism majburiy' });
    if (!customer_phone?.trim()) return res.status(400).json({ error: 'Telefon majburiy' });
    if (!items || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Savat bo'sh" });

    // Mahsulotlarni tekshirish
    const ids = items.map(i => i.product_id);
    const dbProds = await all(
      `SELECT id, price, old_price, stock, name FROM products WHERE id = ANY($1) AND is_active = TRUE`,
      [ids]
    );
    const prodMap = Object.fromEntries(dbProds.map(p => [p.id, p]));

    let subtotal = 0, discount_amount = 0;
    const verifiedItems = items.map(item => {
      const p = prodMap[item.product_id];
      if (!p) throw new Error(`Mahsulot topilmadi: ID ${item.product_id}`);
      if (p.stock < item.qty) throw new Error(`"${p.name}" da yetarli emas (${p.stock} ta bor)`);
      const actualPrice   = p.price;
      const originalPrice = p.old_price || p.price;
      subtotal        += originalPrice * item.qty;
      discount_amount += Math.max(0, (originalPrice - actualPrice) * item.qty);
      return { product_id: item.product_id, name: p.name, price: actualPrice,
               original_price: originalPrice, qty: item.qty, total: actualPrice * item.qty };
    });

    const actualSubtotal = subtotal - discount_amount;
    const freeRow  = await get("SELECT value FROM settings WHERE key = 'free_delivery_from'");
    const costRow  = await get("SELECT value FROM settings WHERE key = 'delivery_cost'");
    const freeFrom = parseInt(freeRow?.value || '500000');
    const baseCost = parseInt(costRow?.value || '25000');
    const delivery_cost = delivery_type === 'pickup' ? 0 : (actualSubtotal >= freeFrom ? 0 : baseCost);
    const total = actualSubtotal + delivery_cost;

    const order_number = genNum();
    const order = await get(
      `INSERT INTO orders
         (order_number, customer_name, customer_phone, delivery_type, customer_city,
          customer_address, payment_method, note, items, subtotal, discount_amount, delivery_cost, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [order_number, customer_name.trim(), customer_phone.trim(),
       delivery_type || 'pickup', customer_city || null, customer_address || null,
       payment_method || 'cash', note || null, JSON.stringify(verifiedItems),
       actualSubtotal, discount_amount, delivery_cost, total]
    );

    // Stokni kamaytirish
    for (const item of verifiedItems) {
      await run('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.qty, item.product_id]);
    }

    // Telegram xabar (asinxron — javobni kutmaymiz)
    const botRow  = await get("SELECT value FROM settings WHERE key = 'telegram_bot_token'");
    const chatRow = await get("SELECT value FROM settings WHERE key = 'telegram_chat_id'");
    if (botRow?.value && chatRow?.value) {
      const payLabels = { cash: '💵 Naqd', card: '💳 Karta', click: '🔵 Click', payme: '🟡 Payme' };
      const itemLines = verifiedItems.map(i =>
        `  • ${i.name} × ${i.qty} = <b>${fmt(i.total)} so'm</b>`).join('\n');
      const msg = [
        `🛍 <b>YANGI ZAKAZ!</b>`,
        `📋 Zakaz: <b>${order_number}</b>`,
        `👤 Mijoz: <b>${customer_name}</b>`,
        `📞 Tel: <b>${customer_phone}</b>`,
        delivery_type === 'delivery'
          ? `🏙 Shahar: ${customer_city || '—'}\n📍 Manzil: ${customer_address || '—'}`
          : `🏪 Olib ketish`,
        `💳 To'lov: ${payLabels[payment_method] || payment_method}`,
        note ? `💬 Izoh: ${note}` : null,
        `\n🧾 <b>Mahsulotlar:</b>\n${itemLines}`,
        discount_amount > 0 ? `🏷 Chegirma: -<b>${fmt(discount_amount)} so'm</b>` : null,
        delivery_cost > 0 ? `🚚 Yetkazish: <b>${fmt(delivery_cost)} so'm</b>` : null,
        `💰 <b>JAMI: ${fmt(total)} so'm</b>`,
      ].filter(Boolean).join('\n');
      sendTelegram(botRow.value, chatRow.value, msg); // asinxron
    }

    res.status(201).json({ order, message: 'Zakaz qabul qilindi!' });
  } catch (e) {
    console.error('Order error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// GET /api/orders (admin)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let q = 'SELECT * FROM orders', params = [];
    if (status) { q += ' WHERE status = $1'; params.push(status); }
    q += ` ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);
    const orders = await all(q, params);
    const totQ = status ? 'SELECT COUNT(*) as c FROM orders WHERE status=$1' : 'SELECT COUNT(*) as c FROM orders';
    const { c } = await get(totQ, status ? [status] : []);
    res.json({ orders, total: parseInt(c), page: parseInt(page) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/stats (admin)
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const s = await get(`
      SELECT
        COUNT(*)                                                         AS total_orders,
        COUNT(*) FILTER (WHERE status='new')                            AS new_orders,
        COUNT(*) FILTER (WHERE status='delivered')                      AS delivered_orders,
        COALESCE(SUM(total) FILTER (WHERE status='delivered'), 0)       AS total_revenue,
        COALESCE(SUM(discount_amount) FILTER (WHERE status='delivered'),0) AS total_discounts
      FROM orders
    `);
    const p = await get(`
      SELECT
        COUNT(*)                                        AS total_products,
        COUNT(*) FILTER (WHERE stock=0)                AS out_of_stock,
        COUNT(*) FILTER (WHERE stock>0 AND stock<=5)   AS low_stock
      FROM products WHERE is_active=TRUE
    `);

    // Foyda hisoblash
    const profitRows = await all(`SELECT items FROM orders WHERE status='delivered'`);
    let totalProfit = 0;
    for (const row of profitRows) {
      for (const item of (row.items || [])) {
        const prod = await get('SELECT cost_price FROM products WHERE id=$1', [item.product_id]);
        if (prod?.cost_price) totalProfit += (item.price - prod.cost_price) * item.qty;
      }
    }
    res.json({ ...s, ...p, total_profit: totalProfit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/low-stock (admin)
router.get('/low-stock', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`
      SELECT p.*, c.name as category_name
      FROM products p LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active=TRUE AND p.stock<=5
      ORDER BY p.stock ASC LIMIT 20
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/:id (admin)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const o = await get('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Topilmadi' });
    res.json(o);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// // PATCH /api/orders/:id/status (admin)
// router.patch('/:id/status', authMiddleware, async (req, res) => {
 // PATCH /api/orders/:id/note (admin javob yozish)
router.patch('/:id/note', authMiddleware, async (req, res) => {
  try {
    const { admin_note, out_of_stock_items } = req.body;
    const o = await get(
      `UPDATE orders SET
        admin_note = COALESCE($1, admin_note),
        out_of_stock_items = COALESCE($2, out_of_stock_items),
        updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [admin_note ?? null, out_of_stock_items ? JSON.stringify(out_of_stock_items) : null, req.params.id]
    );
    res.json(o);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/:id/profit (admin)
router.get('/:id/profit', authMiddleware, async (req, res) => {
  try {
    const o = await get('SELECT items FROM orders WHERE id=$1', [req.params.id]);
    if (!o) return res.status(404).json({ error: 'Topilmadi' });
    let profit = 0;
    for (const item of (o.items || [])) {
      const prod = await get('SELECT cost_price FROM products WHERE id=$1', [item.product_id]);
      if (prod?.cost_price) profit += (item.price - prod.cost_price) * item.qty;
    }
    res.json({ profit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/orders/:id (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM orders WHERE id=$1', [req.params.id]);
    res.json({ message: "O'chirildi" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

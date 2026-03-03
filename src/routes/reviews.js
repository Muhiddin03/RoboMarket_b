const router = require('express').Router();
const { run, get, all } = require('../db');
const authMiddleware = require('../middleware/auth');

const sanitize = (str, maxLen = 500) =>
  !str ? '' : String(str).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);

// GET /api/reviews?product_id=X
router.get('/', async (req, res) => {
  try {
    const { product_id } = req.query;
    if (!product_id) return res.status(400).json({ error: 'product_id kerak' });
    const reviews = await all(
      `SELECT id, author, rating, text, created_at FROM reviews
       WHERE product_id=$1 AND is_approved=TRUE
       ORDER BY created_at DESC LIMIT 50`,
      [product_id]
    );
    const stats = await get(
      `SELECT COUNT(*)::int as count, ROUND(AVG(rating)::numeric,1)::float as avg_rating
       FROM reviews WHERE product_id=$1 AND is_approved=TRUE`,
      [product_id]
    );
    res.json({ reviews, stats: { count: stats.count || 0, avg_rating: stats.avg_rating || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/reviews
router.post('/', async (req, res) => {
  try {
    const { product_id, author, rating, text } = req.body;
    if (!product_id || !author || !text)
      return res.status(400).json({ error: "Barcha maydonlarni to'ldiring" });

    const safeAuthor = sanitize(author, 50);
    const safeText   = sanitize(text, 1000);
    const safeRating = Math.min(5, Math.max(1, parseInt(rating) || 5));

    if (safeAuthor.length < 2) return res.status(400).json({ error: 'Ism juda qisqa' });
    if (safeText.length < 5)   return res.status(400).json({ error: 'Sharh juda qisqa' });

    const prod = await get('SELECT id FROM products WHERE id=$1 AND is_active=TRUE', [product_id]);
    if (!prod) return res.status(404).json({ error: 'Mahsulot topilmadi' });

    const row = await get(
      `INSERT INTO reviews (product_id, author, rating, text, is_approved)
       VALUES ($1,$2,$3,$4,FALSE) RETURNING id`,
      [product_id, safeAuthor, safeRating, safeText]
    );
    res.status(201).json({ id: row.id, message: "Sharh qabul qilindi. Admin tasdiqlashidan keyin ko'rinadi." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/reviews/admin (admin)
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    const rows = await all(`
      SELECT r.id, r.author, r.rating, r.text, r.is_approved, r.created_at,
             p.name as product_name, r.product_id
      FROM reviews r LEFT JOIN products p ON r.product_id = p.id
      ORDER BY r.created_at DESC LIMIT 500
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/reviews/:id/approve (admin)
router.patch('/:id/approve', authMiddleware, async (req, res) => {
  try {
    const r = await get('UPDATE reviews SET is_approved=TRUE WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true, id: r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/reviews/:id (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM reviews WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

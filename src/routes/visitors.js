const router = require('express').Router();
const { run, get, all } = require('../db');
const authMiddleware = require('../middleware/auth');

router.post('/track', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await run(
      `INSERT INTO visitors (date, count) VALUES ($1, 1)
       ON CONFLICT (date) DO UPDATE SET count = visitors.count + 1`,
      [today]
    );
    const { total } = await get('SELECT COALESCE(SUM(count),0)::int as total FROM visitors');
    res.json({ ok: true, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/total', async (req, res) => {
  try {
    const { total } = await get('SELECT COALESCE(SUM(count),0)::int as total FROM visitors');
    res.json({ total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/daily', authMiddleware, async (req, res) => {
  try {
    const rows = await all('SELECT date, count FROM visitors ORDER BY date DESC LIMIT 30');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

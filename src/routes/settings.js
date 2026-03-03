const router = require('express').Router();
const { run, get, all } = require('../db');
const authMiddleware = require('../middleware/auth');
const { upload, uploadToImageKit } = require('../middleware/upload');

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings');
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings (admin)
router.put('/', authMiddleware, async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await run(
        'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        [k, String(v)]
      );
    }
    res.json({ message: 'Saqlandi' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/settings/upload — rasm yuklash (ImageKit)
router.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Rasm kerak' });
    const result = await uploadToImageKit(req.file.buffer, req.file.originalname, 'settings');
    res.json({ url: result.url, fileId: result.fileId });
  } catch (e) {
    console.error('Settings upload error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/settings/hero-cards
router.get('/hero-cards', async (req, res) => {
  try {
    const row = await get("SELECT value FROM settings WHERE key='hero_cards'");
    if (!row) return res.json([
      { id: 1, title: 'Arduino Uno R3', subtitle: "89,000 so'm", image_url: '', icon: 'CircuitBoard' },
      { id: 2, title: 'ESP32 WiFi',     subtitle: "65,000 so'm", image_url: '', icon: 'Wifi' },
      { id: 3, title: 'Sensor Kit',     subtitle: "185,000 so'm", image_url: '', icon: 'Layers' },
      { id: 4, title: 'Servo SG90',     subtitle: "25,000 so'm", image_url: '', icon: 'Wrench' },
    ]);
    res.json(JSON.parse(row.value));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/hero-cards (admin)
router.put('/hero-cards', authMiddleware, async (req, res) => {
  try {
    const cards = req.body;
    await run(
      'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
      ['hero_cards', JSON.stringify(cards)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

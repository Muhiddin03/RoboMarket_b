const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Parol kerak' });
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) return res.status(500).json({ error: 'Admin parol sozlanmagan. /api/auth/setup dan foydalaning.' });
    const ok = await bcrypt.compare(password, hash);
    if (!ok) return res.status(401).json({ error: "Parol noto'g'ri" });
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ role: 'admin' });
});

router.post('/setup', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: 'Kamida 4 ta belgi' });
    const hash = await bcrypt.hash(password, 12);
    res.json({ message: "backend/.env fayliga qo'ying:", hash, env_line: `ADMIN_PASSWORD_HASH=${hash}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

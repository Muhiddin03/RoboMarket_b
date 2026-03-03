const router = require('express').Router();
const { run, get, all } = require('../db');
const authMiddleware = require('../middleware/auth');
const { upload, uploadToImageKit, deleteFromImageKit } = require('../middleware/upload');

const slugify = (t) =>
  (t || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'category';

// GET /api/categories
router.get('/', async (req, res) => {
  try {
    const rows = await all(
      `SELECT c.*, COUNT(p.id) AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active = TRUE
       GROUP BY c.id ORDER BY c.name`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/categories/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await get('SELECT * FROM categories WHERE id=$1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Topilmadi' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/categories (admin)
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { name, description, image_url: urlFromBody } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom majburiy' });

    let image_url = urlFromBody || null;
    let image_file_id = null;

    if (req.file) {
      const result = await uploadToImageKit(req.file.buffer, req.file.originalname, 'categories');
      image_url      = result.url;
      image_file_id  = result.fileId;
    }

    const row = await get(
      'INSERT INTO categories (name, slug, description, image_url) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, slugify(name), description || null, image_url]
    );
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/categories/:id (admin)
router.put('/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const existing = await get('SELECT * FROM categories WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Topilmadi' });

    const { name, description, image_url: urlFromBody } = req.body;

    let image_url = urlFromBody !== undefined ? (urlFromBody || null) : existing.image_url;

    if (req.file) {
      // Eski rasmni o'chirish
      if (existing.image_file_id) await deleteFromImageKit(existing.image_file_id);
      const result = await uploadToImageKit(req.file.buffer, req.file.originalname, 'categories');
      image_url = result.url;
    }

    const row = await get(
      'UPDATE categories SET name=$1, slug=$2, description=$3, image_url=$4 WHERE id=$5 RETURNING *',
      [name || existing.name, slugify(name || existing.name),
       description ?? existing.description, image_url, req.params.id]
    );
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/categories/:id (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM categories WHERE id=$1', [req.params.id]);
    res.json({ message: "O'chirildi" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

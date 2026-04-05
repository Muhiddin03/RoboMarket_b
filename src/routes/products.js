const router = require('express').Router();
const { run, get, all } = require('../db');
const authMiddleware = require('../middleware/auth');
const { upload, uploadToImageKit, deleteFromImageKit } = require('../middleware/upload');

const slugify = (t) =>
  (t || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const { category, search, sort = 'id', order = 'desc', page = 1, limit = 600, badge } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conds = ['p.is_active = TRUE'];
    const params = [];
    let i = 1;

    if (category) { conds.push(`c.slug = $${i++}`); params.push(category); }
    if (search) {
  const words = search.trim().split(/\s+/).filter(Boolean);
  const wordConds = words.map(w => {
    params.push(`%${w}%`);
    const idx = i++;
    return `(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`;
  });
  conds.push(`(${wordConds.join(' OR ')})`);
}
    if (badge)    { conds.push(`p.badge = $${i++}`); params.push(badge); }

    const cols = { id: 'p.id', price: 'p.price', name: 'p.name', stock: 'p.stock', created_at: 'p.created_at' };
    const sortCol = cols[sort] || 'p.id';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';
    const where = `WHERE ${conds.join(' AND ')}`;

    const products = await all(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       ${where} ORDER BY ${sortCol} ${sortDir}
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, parseInt(limit), offset]
    );

    const totRow = await get(
      `SELECT COUNT(*) as c FROM products p LEFT JOIN categories c ON p.category_id = c.id ${where}`,
      params
    );

    res.json({
      products,
      total: parseInt(totRow.c),
      page: parseInt(page),
      pages: Math.ceil(parseInt(totRow.c) / parseInt(limit))
    });
  } catch (e) {
    console.error('Products GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const p = await get(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1 AND p.is_active = TRUE`,
      [req.params.id]
    );
    if (!p) return res.status(404).json({ error: 'Topilmadi' });
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/products (admin)
router.post('/', authMiddleware, upload.array('images', 5), async (req, res) => {
  try {
    const { name, description, price, old_price, cost_price, stock, category_id, specs, badge, image_urls } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Nom va narx majburiy' });

    let images = [];

    // Tashqi URL lar (ImageKit yoki boshqa)
    if (image_urls) {
      const urls = Array.isArray(image_urls) ? image_urls : [image_urls];
      images = urls.filter(u => u).map(u => ({ url: u, fileId: 'url_' + Date.now(), filename: null }));
    }

    // Yuklangan fayllar → ImageKit ga
    if (req.files?.length) {
      const uploaded = await Promise.all(
        req.files.map(f => uploadToImageKit(f.buffer, f.originalname, 'products'))
      );
      images = [...images, ...uploaded];
    }

    const slug = slugify(name) + '-' + Date.now();
    const specsArr = specs ? (typeof specs === 'string' ? JSON.parse(specs) : specs) : [];

    const row = await get(
      `INSERT INTO products (name, slug, description, price, old_price, cost_price, stock, category_id, images, specs, badge)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, slug, description || null, parseInt(price),
       old_price ? parseInt(old_price) : null,
       cost_price ? parseInt(cost_price) : null,
       parseInt(stock) || 0,
       category_id || null,
       JSON.stringify(images),
       JSON.stringify(specsArr),
       badge || null]
    );
    res.status(201).json(row);
  } catch (e) {
    console.error('Product POST error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/products/:id (admin)
router.put('/:id', authMiddleware, upload.array('images', 5), async (req, res) => {
  try {
    const existing = await get('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Topilmadi' });

    const { name, description, price, old_price, cost_price, stock,
            category_id, specs, badge, is_active, remove_images, image_urls } = req.body;

    let images = existing.images || [];

    // O'chiriladigan rasmlar
    if (remove_images) {
      const toRm = typeof remove_images === 'string' ? JSON.parse(remove_images) : remove_images;
      const removing = images.filter(i => toRm.includes(i.fileId) || toRm.includes(i.filename));
      await Promise.all(removing.map(i => deleteFromImageKit(i.fileId)));
      images = images.filter(i => !toRm.includes(i.fileId) && !toRm.includes(i.filename));
    }

    // Yangi URL lar
    if (image_urls) {
      const urls = Array.isArray(image_urls) ? image_urls : [image_urls];
      images = [...images, ...urls.filter(u => u).map(u => ({ url: u, fileId: 'url_' + Date.now(), filename: null }))];
    }

    // Yangi fayllar → ImageKit ga
    if (req.files?.length) {
      const uploaded = await Promise.all(
        req.files.map(f => uploadToImageKit(f.buffer, f.originalname, 'products'))
      );
      images = [...images, ...uploaded];
    }

    const specsArr = specs ? (typeof specs === 'string' ? JSON.parse(specs) : specs) : existing.specs;
    const slug = name ? slugify(name) + '-' + req.params.id : existing.slug;
    const activeVal = is_active !== undefined ? (is_active === 'true' || is_active === true) : existing.is_active;

    const row = await get(
      `UPDATE products SET
        name=$1, slug=$2, description=$3, price=$4, old_price=$5, cost_price=$6,
        stock=$7, category_id=$8, images=$9, specs=$10, badge=$11, is_active=$12,
        updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [name || existing.name, slug, description ?? existing.description,
       price ? parseInt(price) : existing.price,
       old_price !== undefined ? (old_price ? parseInt(old_price) : null) : existing.old_price,
       cost_price !== undefined ? (cost_price ? parseInt(cost_price) : null) : existing.cost_price,
       stock !== undefined ? parseInt(stock) : existing.stock,
       category_id ?? existing.category_id,
       JSON.stringify(images), JSON.stringify(specsArr),
       badge ?? existing.badge, activeVal, req.params.id]
    );
    res.json(row);
  } catch (e) {
    console.error('Product PUT error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/products/:id (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const p = await get('SELECT images FROM products WHERE id = $1', [req.params.id]);
    if (p?.images) {
      await Promise.all((p.images || []).map(i => deleteFromImageKit(i.fileId)));
    }
    await run('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ message: "O'chirildi" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

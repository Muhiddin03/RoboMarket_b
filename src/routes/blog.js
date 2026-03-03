const router = require('express').Router();
const { run, get, all } = require('../db');
const authMiddleware = require('../middleware/auth');
const { upload, uploadFiles, uploadToImageKit, deleteFromImageKit } = require('../middleware/upload');
const path = require('path');

const sanitize = (str, maxLen = 100000) =>
  !str ? '' : String(str).trim().slice(0, maxLen);

const safeJSON = (val, fallback) => {
  if (Array.isArray(val) || (val && typeof val === 'object')) return val;
  try { return JSON.parse(val || JSON.stringify(fallback)); } catch { return fallback; }
};

// GET /api/blog (public)
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const posts = await all(
      `SELECT id, title, description, cover_image, video_url, tags, views, created_at, updated_at
       FROM blog_posts WHERE is_published=TRUE ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );
    const { total } = await get('SELECT COUNT(*)::int as total FROM blog_posts WHERE is_published=TRUE');
    res.json({ posts, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/blog/admin/all (admin)
router.get('/admin/all', authMiddleware, async (req, res) => {
  try {
    const posts = await all('SELECT * FROM blog_posts ORDER BY created_at DESC');
    res.json(posts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/blog/:id (public)
router.get('/:id', async (req, res) => {
  try {
    const p = await get('SELECT * FROM blog_posts WHERE id=$1 AND is_published=TRUE', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Topilmadi' });
    await run('UPDATE blog_posts SET views=views+1 WHERE id=$1', [req.params.id]);
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/blog (admin)
router.post('/', authMiddleware,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'media_images', maxCount: 10 }]),
  async (req, res) => {
    try {
      const { title, description, content, video_url, tags, links, is_published } = req.body;
      if (!title) return res.status(400).json({ error: 'Sarlavha majburiy' });

      // Cover rasm — ImageKit
      let cover_image = req.body.cover_url || null;
      if (req.files?.cover?.[0]) {
        const f = req.files.cover[0];
        const r = await uploadToImageKit(f.buffer, f.originalname, 'blog');
        cover_image = r.url;
      }

      // Media rasmlar — ImageKit
      let media = [];
      if (req.files?.media_images) {
        const uploaded = await Promise.all(
          req.files.media_images.map(f => uploadToImageKit(f.buffer, f.originalname, 'blog'))
        );
        media = uploaded.map(r => ({ type: 'image', url: r.url, fileId: r.fileId, name: r.filename }));
      }
      if (req.body.media_json) {
        try { media = [...media, ...safeJSON(req.body.media_json, [])]; } catch {}
      }

      const safeTags  = JSON.stringify(
        (tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : []).filter(Boolean)
      );
      const safeLinks = JSON.stringify(safeJSON(links, []));

      const row = await get(
        `INSERT INTO blog_posts (title, description, content, cover_image, video_url, tags, links, media, is_published)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [sanitize(title, 300), sanitize(description, 500), sanitize(content || ''),
         cover_image, video_url || null, safeTags, safeLinks, JSON.stringify(media),
         is_published === '0' ? false : true]
      );
      res.status(201).json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// PUT /api/blog/:id (admin)
router.put('/:id', authMiddleware,
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'media_images', maxCount: 10 }]),
  async (req, res) => {
    try {
      const existing = await get('SELECT * FROM blog_posts WHERE id=$1', [req.params.id]);
      if (!existing) return res.status(404).json({ error: 'Topilmadi' });

      const { title, description, content, video_url, tags, links, is_published } = req.body;

      // Cover rasm
      let cover_image = req.body.cover_url !== undefined ? (req.body.cover_url || null) : existing.cover_image;
      if (req.files?.cover?.[0]) {
        const f = req.files.cover[0];
        const r = await uploadToImageKit(f.buffer, f.originalname, 'blog');
        cover_image = r.url;
      }

      // Media
      let media = safeJSON(existing.media, []);
      if (req.files?.media_images) {
        const uploaded = await Promise.all(
          req.files.media_images.map(f => uploadToImageKit(f.buffer, f.originalname, 'blog'))
        );
        media = [...media, ...uploaded.map(r => ({ type: 'image', url: r.url, fileId: r.fileId, name: r.filename }))];
      }
      if (req.body.media_json) {
        try { media = [...media, ...safeJSON(req.body.media_json, [])]; } catch {}
      }
      if (req.body.remove_media) {
        const rm = safeJSON(req.body.remove_media, []);
        const removing = media.filter(m => rm.includes(m.url));
        await Promise.all(removing.map(m => m.fileId ? deleteFromImageKit(m.fileId) : Promise.resolve()));
        media = media.filter(m => !rm.includes(m.url));
      }

      const safeTags  = tags
        ? JSON.stringify((Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())).filter(Boolean))
        : JSON.stringify(existing.tags || []);
      const safeLinks = links !== undefined ? JSON.stringify(safeJSON(links, [])) : JSON.stringify(existing.links || []);

      const row = await get(
        `UPDATE blog_posts SET title=$1, description=$2, content=$3, cover_image=$4, video_url=$5,
         tags=$6, links=$7, media=$8, is_published=$9, updated_at=NOW() WHERE id=$10 RETURNING *`,
        [sanitize(title || existing.title, 300),
         sanitize(description !== undefined ? description : existing.description || '', 500),
         sanitize(content !== undefined ? content : existing.content || ''),
         cover_image,
         video_url !== undefined ? video_url : existing.video_url,
         safeTags, safeLinks, JSON.stringify(media),
         is_published !== undefined ? (is_published === '0' ? false : true) : existing.is_published,
         req.params.id]
      );
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// POST /api/blog/:id/files (admin) — fayllar ham ImageKit ga
router.post('/:id/files', authMiddleware, uploadFiles.array('files', 5), async (req, res) => {
  try {
    const post = await get('SELECT * FROM blog_posts WHERE id=$1', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Topilmadi' });
    if (!req.files?.length) return res.status(400).json({ error: 'Fayl kerak' });

    const existing = safeJSON(post.files, []);
    const uploaded = await Promise.all(
      req.files.map(f => uploadToImageKit(f.buffer, f.originalname, 'blog/files'))
    );
    const newFiles = uploaded.map((r, idx) => ({
      name: req.files[idx].originalname,
      url:    r.url,
      fileId: r.fileId,
      size:   req.files[idx].size,
      type:   path.extname(req.files[idx].originalname).slice(1).toLowerCase(),
    }));
    const allFiles = [...existing, ...newFiles];
    await run('UPDATE blog_posts SET files=$1 WHERE id=$2', [JSON.stringify(allFiles), req.params.id]);
    res.json({ files: allFiles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/blog/:id/files (admin)
router.delete('/:id/files', authMiddleware, async (req, res) => {
  try {
    const { file_url } = req.body;
    const post = await get('SELECT files FROM blog_posts WHERE id=$1', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Topilmadi' });
    const allFiles = safeJSON(post.files, []);
    const removing = allFiles.find(f => f.url === file_url);
    if (removing?.fileId) await deleteFromImageKit(removing.fileId);
    const files = allFiles.filter(f => f.url !== file_url);
    await run('UPDATE blog_posts SET files=$1 WHERE id=$2', [JSON.stringify(files), req.params.id]);
    res.json({ files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/blog/:id (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM blog_posts WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

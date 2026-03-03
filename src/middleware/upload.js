const multer   = require('multer');
const path     = require('path');
const ImageKit = require('imagekit');

// ── ImageKit sozlamasi ───────────────────────────────────────────────────────
const imagekit = new ImageKit({
  publicKey:   process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey:  process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// ── Ruxsat etilgan turlar ────────────────────────────────────────────────────
const ALLOWED_IMAGES = /jpeg|jpg|png|gif|webp/;
const ALLOWED_FILES  = /jpeg|jpg|png|gif|webp|pdf|zip|rar|txt|md|ino|py|js|cpp|c|h|json/;

const imageFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  if (ALLOWED_IMAGES.test(ext) && file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Faqat rasm fayllar (jpg, png, webp, gif)'));
  }
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  if (ALLOWED_FILES.test(ext)) cb(null, true);
  else cb(new Error('Bu fayl turi ruxsat etilmagan'));
};

// Multer — diskka emas, xotiraga (buffer) oladi
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFilter,
});

const uploadFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: fileFilter,
});

// ── ImageKit ga yuklash ──────────────────────────────────────────────────────
const uploadToImageKit = async (fileBuffer, originalName, folder = 'uploads') => {
  const ext      = path.extname(originalName).toLowerCase();
  const baseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${Date.now()}_${baseName}${ext}`;

  const result = await imagekit.upload({
    file:              fileBuffer,
    fileName:          fileName,
    folder:            `/robomarket/${folder}`,
    useUniqueFileName: false,
  });

  return {
    url:      result.url,
    fileId:   result.fileId,
    filename: result.name,
  };
};

// ── ImageKit dan o'chirish ───────────────────────────────────────────────────
const deleteFromImageKit = async (fileId) => {
  if (!fileId || fileId.startsWith('url_')) return;
  try {
    await imagekit.deleteFile(fileId);
  } catch (e) {
    console.error('[ImageKit delete error]', e.message);
  }
};

// Eski kod bilan mos kelish uchun
const deleteLocalFile = () => {};

module.exports = { upload, uploadFiles, uploadToImageKit, deleteFromImageKit, deleteLocalFile, imagekit };

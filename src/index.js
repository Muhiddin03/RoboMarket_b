require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const { initDB } = require('./db');

const app = express();

// Xavfsizlik
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));

// CORS
const allowedOrigins = ['http://localhost:3000', 'http://localhost:3001', process.env.FRONTEND_URL].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    if (allowedOrigins.some(o => origin === o || origin.startsWith(o))) return cb(null, true);
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    return cb(new Error('CORS: ruxsat yo\'q'));
  },
  credentials: true,
}));

// Rate limiter
const rateLimits = {};
const rateLimit = (maxReq, windowMs) => (req, res, next) => {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown').trim();
  const now = Date.now();
  if (!rateLimits[ip]) rateLimits[ip] = [];
  rateLimits[ip] = rateLimits[ip].filter(t => now - t < windowMs);
  if (rateLimits[ip].length >= maxReq)
    return res.status(429).json({ error: "Juda ko'p so'rov. 1 daqiqadan keyin qayta urining." });
  rateLimits[ip].push(now);
  next();
};
setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimits).forEach(ip => {
    rateLimits[ip] = (rateLimits[ip] || []).filter(t => now - t < 3600000);
    if (!rateLimits[ip].length) delete rateLimits[ip];
  });
}, 300000);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


// Routes
app.use('/api/auth',       rateLimit(15,  60000), require('./routes/auth'));
app.use('/api/products',   rateLimit(600, 60000), require('./routes/products'));
app.use('/api/categories', rateLimit(300, 60000), require('./routes/categories'));
app.use('/api/orders',     rateLimit(150, 60000), require('./routes/orders'));
app.use('/api/settings',   rateLimit(300, 60000), require('./routes/settings'));
app.use('/api/contact',    rateLimit(10,  60000), require('./routes/contact'));
app.use('/api/reviews',    rateLimit(200, 60000), require('./routes/reviews'));
app.use('/api/blog',       rateLimit(400, 60000), require('./routes/blog'));
app.use('/api/visitors',   rateLimit(600, 60000), require('./routes/visitors'));
app.use('/api/report',     rateLimit(30,  60000), require('./routes/report'));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), service: 'RoboMarket API v10' }));

app.use((req, res) => res.status(404).json({ error: 'Endpoint topilmadi' }));

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fayl juda katta (max 10MB)' });
  res.status(500).json({ error: 'Server xatosi. Qayta urining.' });
});

const PORT = process.env.PORT || 5000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`\n✅ RoboMarket API: http://localhost:${PORT}/api\n`));
}).catch(err => { console.error('❌ DB xatosi:', err.message); process.exit(1); });

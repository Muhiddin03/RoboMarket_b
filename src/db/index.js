const { Pool } = require('pg');

// PostgreSQL ulanish
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB Pool Error]', err.message);
});

// Qulay yordamchi funksiyalar
const query = (sql, params = []) => pool.query(sql, params);

const run = async (sql, params = []) => {
  const r = await pool.query(sql, params);
  return { lastID: r.rows[0]?.id ?? null, changes: r.rowCount };
};

const get = async (sql, params = []) => {
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
};

const all = async (sql, params = []) => {
  const r = await pool.query(sql, params);
  return r.rows;
};

// Ma'lumotlar bazasini boshlash
const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      slug      TEXT UNIQUE NOT NULL,
      description TEXT,
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,
      description TEXT,
      price       INTEGER NOT NULL,
      old_price   INTEGER,
      cost_price  INTEGER,
      stock       INTEGER DEFAULT 0,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      images      JSONB DEFAULT '[]',
      specs       JSONB DEFAULT '[]',
      badge       TEXT,
      is_active   BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id               SERIAL PRIMARY KEY,
      order_number     TEXT UNIQUE NOT NULL,
      customer_name    TEXT NOT NULL,
      customer_phone   TEXT NOT NULL,
      delivery_type    TEXT DEFAULT 'pickup',
      customer_city    TEXT,
      customer_address TEXT,
      payment_method   TEXT DEFAULT 'cash',
      note             TEXT,
      items            JSONB NOT NULL DEFAULT '[]',
      subtotal         INTEGER NOT NULL,
      discount_amount  INTEGER DEFAULT 0,
      delivery_cost    INTEGER DEFAULT 0,
      total            INTEGER NOT NULL,
      status           TEXT DEFAULT 'new',
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id         SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      author     TEXT NOT NULL,
      rating     INTEGER DEFAULT 5,
      text       TEXT NOT NULL,
      is_approved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id           SERIAL PRIMARY KEY,
      title        TEXT NOT NULL,
      description  TEXT,
      content      TEXT,
      cover_image  TEXT,
      video_url    TEXT,
      tags         JSONB DEFAULT '[]',
      links        JSONB DEFAULT '[]',
      files        JSONB DEFAULT '[]',
      media        JSONB DEFAULT '[]',
      is_published BOOLEAN DEFAULT TRUE,
      views        INTEGER DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS visitors (
      id    SERIAL PRIMARY KEY,
      date  DATE UNIQUE NOT NULL,
      count INTEGER DEFAULT 0
    )
  `);

  // Indekslar (tezlik uchun)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, is_approved)`).catch(() => {});

  // Default kategoriyalar (faqat birinchi marta)
  const { rows } = await pool.query('SELECT COUNT(*) as c FROM categories');
  if (parseInt(rows[0].c) === 0) {
    const cats = [
      ['Arduino & Mikrokontrollerlar', 'arduino', 'Arduino Uno, Mega, Nano, ESP32'],
      ['Sensorlar', 'sensors', 'Ultratovush, IR, harorat sensorlari'],
      ['Motorlar & Servo', 'motors', 'DC motor, servo, stepper motorlar'],
      ["Elektr ta'minoti", 'power', 'Batareyalar, zaryadlovchilar'],
      ['Displeylar', 'display', 'LCD, OLED, TFT ekranlar'],
      ["Asboblar & To'plamlar", 'tools', 'Breadboard, jumper, starter kit'],
      ['Simsiz modullar', 'wireless', 'Bluetooth, WiFi, radio modullar'],
      ['Komponentlar', 'components', 'Rezistorlar, kondensatorlar, LED'],
    ];
    for (const [n, s, d] of cats) {
      await pool.query(
        'INSERT INTO categories (name,slug,description) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING',
        [n, s, d]
      );
    }
  }

  console.log('✅ PostgreSQL DB tayyor');
};

module.exports = { pool, query, run, get, all, initDB };

const router = require('express').Router();
const { all } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone || phone.trim().length < 9)
      return res.status(400).json({ error: 'Telefon raqam kerak' });

    const clean = phone.replace(/\D/g, '');

    const orders = await all(
      `SELECT id, order_number, status, total, subtotal, discount_amount,
              delivery_cost, delivery_type, customer_name, created_at, updated_at,
              items, payment_method, note
       FROM orders
       WHERE REGEXP_REPLACE(customer_phone, '[^0-9]', '', 'g') LIKE $1
       ORDER BY created_at DESC`,
      [`%${clean.slice(-9)}`]
    );

    res.json({ orders, total: orders.length });
  } catch (e) {
    console.error('Customer orders error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
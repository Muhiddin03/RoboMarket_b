const router = require('express').Router();
const { all, get } = require('../db');
const authMiddleware = require('../middleware/auth');
const PDFDocument = require('pdfkit');

const fmt = (n) => Number(n || 0).toLocaleString('uz-UZ') + " so'm";

function getDateRange(type) {
  const now = new Date();
  const end = new Date(now); end.setHours(23,59,59,999);
  if (type === 'weekly') {
    const start = new Date(now); start.setDate(now.getDate()-6); start.setHours(0,0,0,0);
    return { start, end, label: 'Haftalik hisobot (oxirgi 7 kun)' };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1); start.setHours(0,0,0,0);
  return { start, end, label: `Oylik hisobot (${now.toLocaleString('uz-UZ',{month:'long',year:'numeric'})})` };
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const type = req.query.type || 'weekly';
    const { start, end, label } = getDateRange(type);

    const orders = await all(
      `SELECT * FROM orders WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at ASC`,
      [start.toISOString(), end.toISOString()]
    );

    const delivered = orders.filter(o => o.status === 'delivered');
    const totalRevenue = delivered.reduce((s,o) => s+(o.total||0), 0);
    const totalDiscount = delivered.reduce((s,o) => s+(o.discount_amount||0), 0);

    let totalProfit = 0;
    for (const order of delivered) {
      for (const item of (order.items||[])) {
        const prod = await get('SELECT cost_price FROM products WHERE id=$1', [item.product_id]);
        if (prod?.cost_price) totalProfit += (item.price - prod.cost_price) * item.qty;
      }
    }

    const productSales = {};
    for (const order of delivered) {
      for (const item of (order.items||[])) {
        if (!productSales[item.name]) productSales[item.name] = { qty:0, revenue:0 };
        productSales[item.name].qty += item.qty;
        productSales[item.name].revenue += item.total;
      }
    }
    const topProducts = Object.entries(productSales).sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,10);

    const cityStats = {};
    for (const o of orders) {
      if (o.customer_city) cityStats[o.customer_city] = (cityStats[o.customer_city]||0)+1;
    }

    const addedProducts = await get(
      `SELECT COUNT(*)::int as c FROM products WHERE created_at >= $1 AND created_at <= $2`,
      [start.toISOString(), end.toISOString()]
    );

    // PDF
    const doc = new PDFDocument({ margin:45, size:'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="robomarket_${type}.pdf"`);
    doc.pipe(res);

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#7c3aed').text('RoboMarket', 45, 45);
    doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(label, 45, 70);
    doc.font('Helvetica').fontSize(9).fillColor('#94a3b8')
      .text(`${start.toLocaleDateString('ru-RU')} — ${end.toLocaleDateString('ru-RU')}`, 45, 83);
    doc.moveTo(45,100).lineTo(550,100).strokeColor('#e2e8f0').stroke();

    let y = 115;
    const statBoxes = [
      ['Jami zakazlar', orders.length.toString()],
      ['Yetkazilgan', delivered.length.toString()],
      ['Daromad', fmt(totalRevenue)],
      ['Chegirma', fmt(totalDiscount)],
      ['Sof foyda', fmt(totalProfit)],
      ["Qo'shilgan mahsulot", (addedProducts?.c||0).toString()],
    ];
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1e293b').text("UMUMIY KO'RSATKICHLAR", 45, y);
    y += 18;
    const boxW=120, boxH=52, gap=10;
    statBoxes.forEach(([l,v],i) => {
      const col=i%4, row=Math.floor(i/4);
      const bx=45+col*(boxW+gap), by=y+row*(boxH+gap);
      doc.rect(bx,by,boxW,boxH).fillAndStroke('#f8fafc','#e2e8f0');
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(l,bx+8,by+9);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#7c3aed').text(v,bx+8,by+24,{width:boxW-16});
    });
    y += Math.ceil(statBoxes.length/4)*(boxH+gap)+20;

    // Top products
    if (y > 650) { doc.addPage(); y=45; }
    doc.moveTo(45,y).lineTo(550,y).strokeColor('#e2e8f0').stroke(); y+=12;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1e293b').text("ENG KO'P SOTILGAN", 45, y); y+=15;
    doc.rect(45,y,505,18).fill('#f1f5f9');
    ['#','Mahsulot','Soni','Daromad'].forEach((h,i) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569').text(h, 45+[0,25,315,395][i]+4, y+5);
    });
    y+=18;
    topProducts.forEach(([name,d],idx) => {
      if(y>700){doc.addPage();y=45;}
      if(idx%2===0) doc.rect(45,y,505,18).fill('#fafafa');
      [String(idx+1),name,d.qty+' ta',fmt(d.revenue)].forEach((v,i) => {
        doc.font('Helvetica').fontSize(8).fillColor('#334155').text(v, 45+[0,25,315,395][i]+4, y+5, {width:[21,286,76,106][i]});
      });
      y+=18;
    });
    y+=15;

    // Barcha zakazlar
    if(y>650){doc.addPage();y=45;}
    doc.moveTo(45,y).lineTo(550,y).strokeColor('#e2e8f0').stroke(); y+=12;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1e293b').text('BARCHA ZAKAZLAR', 45, y); y+=15;
    doc.rect(45,y,505,18).fill('#f1f5f9');
    ['Zakaz','Mijoz','Tel','Shahar','Narx','Sana','Holat'].forEach((h,i) => {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#475569').text(h, 45+[0,85,185,270,340,410,465][i]+3, y+6);
    });
    y+=18;
    for(const [idx,o] of orders.entries()) {
      if(y>740){doc.addPage();y=45;}
      if(idx%2===0) doc.rect(45,y,505,16).fill('#fafafa');
      [o.order_number||'',o.customer_name||'',o.customer_phone||'',
       o.customer_city||'Olib ketish', fmt(o.total),
       new Date(o.created_at).toLocaleDateString('ru-RU'), o.status||''].forEach((v,i) => {
        doc.font('Helvetica').fontSize(7).fillColor('#334155').text(String(v), 45+[0,85,185,270,340,410,465][i]+3, y+5, {width:[82,97,82,67,67,52,40][i]});
      });
      y+=16;
    }

    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
      .text(`Hisobot ${new Date().toLocaleString('ru-RU')} da yaratildi — RoboMarket`, 45, 790, {align:'center'});
    doc.end();
  } catch (e) {
    console.error('Report error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;

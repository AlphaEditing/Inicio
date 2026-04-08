const path = require("path");
const fs = require("fs");
const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { authMiddleware, requireUser, requireRoles, signToken } = require("../middleware");

function categoryToWorkerRole(category) {
  if (category === "graphic") return "graphic_designer";
  if (category === "video") return "video_editor";
  if (category === "config") return "config_tech";
  return null;
}

function registerRoutes(app, { db, jwtSecret }) {
  const authFactory = authMiddleware(jwtSecret);
  const authOptional = authFactory(false);
  const authRequired = authFactory(true);
  const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./uploads");
  ["quotes", "portfolio", "announcements", "results"].forEach((s) =>
    fs.mkdirSync(path.join(uploadRoot, s), { recursive: true })
  );

  const workerUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, path.join(uploadRoot, "results")),
      filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname || ""))
    }),
    limits: { fileSize: 500 * 1024 * 1024, files: 1 }
  });

  const quoteUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, path.join(uploadRoot, "quotes")),
      filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname || ""))
    }),
    limits: { fileSize: 15 * 1024 * 1024, files: 5 }
  });

  const portfolioUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, path.join(uploadRoot, "portfolio")),
      filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname || ""))
    }),
    limits: { fileSize: 80 * 1024 * 1024, files: 1 }
  });

  app.use("/uploads", express.static(uploadRoot));

  app.post("/api/auth/register", authOptional, (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name)
      return res.status(400).json({ error: "Email, contraseña y nombre requeridos" });
    if (password.length < 8) return res.status(400).json({ error: "Mínimo 8 caracteres" });
    try {
      const hash = bcrypt.hashSync(password, 12);
      const info = db
        .prepare(
          `INSERT INTO users (email, password_hash, name, role, worker_role) VALUES (?,?,?,'client',NULL)`
        )
        .run(email.trim().toLowerCase(), hash, name.trim());
      const user = db
        .prepare(`SELECT id, email, name, role, worker_role FROM users WHERE id = ?`)
        .get(info.lastInsertRowid);
      const token = signToken(jwtSecret, user);
      res.status(201).json({ token, user: stripUser(user) });
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Email ya registrado" });
      throw e;
    }
  });

  app.post("/api/auth/login", authOptional, (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Credenciales incompletas" });
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.trim().toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: "Email o contraseña incorrectos" });
    const pub = { id: user.id, email: user.email, name: user.name, role: user.role, worker_role: user.worker_role };
    res.json({ token: signToken(jwtSecret, pub), user: stripUser(pub) });
  });

  app.get("/api/auth/me", authRequired, requireUser, (req, res) => {
    const user = db
      .prepare(`SELECT id, email, name, role, worker_role, created_at FROM users WHERE id = ?`)
      .get(req.user.id);
    res.json(stripUser(user));
  });

  app.get("/api/services", (req, res) => {
    const rows = db
      .prepare(`SELECT id, slug, name_es, name_en, category, price_eur, price_type FROM services WHERE active = 1 ORDER BY category, id`)
      .all();
    res.json(rows);
  });

  app.get("/api/cart", authRequired, requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.service_id as serviceId, c.quantity, s.slug, s.name_es, s.name_en, s.category, s.price_eur, s.price_type
         FROM cart_items c JOIN services s ON s.id = c.service_id WHERE c.user_id = ?`
      )
      .all(req.user.id);
    res.json(rows);
  });

  app.post("/api/cart", authRequired, requireUser, (req, res) => {
    if (req.user.role !== "client") return res.status(403).json({ error: "Solo clientes usan el carrito" });
    const { serviceId, quantity = 1 } = req.body || {};
    const sid = parseInt(serviceId, 10);
    const q = Math.max(1, parseInt(quantity, 10) || 1);
    const svc = db.prepare(`SELECT id FROM services WHERE id = ? AND active = 1`).get(sid);
    if (!svc) return res.status(404).json({ error: "Servicio no disponible" });
    db.prepare(
      `INSERT INTO cart_items (user_id, service_id, quantity) VALUES (?,?,?)
       ON CONFLICT(user_id, service_id) DO UPDATE SET quantity = quantity + excluded.quantity`
    ).run(req.user.id, sid, q);
    res.json({ ok: true });
  });

  app.patch("/api/cart/:serviceId", authRequired, requireUser, (req, res) => {
    const sid = parseInt(req.params.serviceId, 10);
    const q = Math.max(1, parseInt(req.body.quantity, 10) || 1);
    const r = db.prepare(`UPDATE cart_items SET quantity = ? WHERE user_id = ? AND service_id = ?`).run(q, req.user.id, sid);
    if (r.changes === 0) return res.status(404).json({ error: "Ítem no encontrado" });
    res.json({ ok: true });
  });

  app.delete("/api/cart/:serviceId", authRequired, requireUser, (req, res) => {
    const sid = parseInt(req.params.serviceId, 10);
    db.prepare(`DELETE FROM cart_items WHERE user_id = ? AND service_id = ?`).run(req.user.id, sid);
    res.json({ ok: true });
  });

  app.post("/api/orders/checkout", authRequired, requireUser, (req, res) => {
    if (req.user.role !== "client") return res.status(403).json({ error: "Solo clientes pueden pedir" });
    const { couponCode } = req.body || {};
    const items = db
      .prepare(
        `SELECT c.service_id, c.quantity, s.price_eur, s.name_es, s.category, s.price_type
         FROM cart_items c JOIN services s ON s.id = c.service_id WHERE c.user_id = ?`
      )
      .all(req.user.id);
    if (!items.length) return res.status(400).json({ error: "Carrito vacío" });

    let subtotal = 0;
    for (const it of items) subtotal += it.price_eur * it.quantity;

    let discount = 0;
    let appliedCode = null;
    if (couponCode && String(couponCode).trim()) {
      const code = String(couponCode).trim().toUpperCase();
      const c = db.prepare(`SELECT * FROM coupons WHERE UPPER(code) = ? AND active = 1`).get(code);
      if (c) {
        const exp = c.expires_at ? new Date(c.expires_at) : null;
        const okExp = !exp || exp > new Date();
        const okUses = c.max_uses == null || c.used_count < c.max_uses;
        if (okExp && okUses) {
          appliedCode = c.code;
          if (c.discount_type === "percent") discount = Math.min(subtotal, (subtotal * c.discount_value) / 100);
          else discount = Math.min(subtotal, c.discount_value);
        }
      }
    }

    const total = Math.max(0, subtotal - discount);
    const year = new Date().getFullYear();
    let createdOrderId;

    const tx = db.transaction(() => {
      const o = db
        .prepare(
          `INSERT INTO orders (user_id, status, subtotal_eur, discount_eur, total_eur, coupon_code, invoice_number)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(req.user.id, "pending", subtotal, discount, total, appliedCode, `TMP`);
      const orderId = o.lastInsertRowid;
      createdOrderId = orderId;
      const inv = `AVS-${year}-${String(orderId).padStart(5, "0")}`;
      db.prepare(`UPDATE orders SET invoice_number = ? WHERE id = ?`).run(inv, orderId);

      const insItem = db.prepare(
        `INSERT INTO order_items (order_id, service_id, quantity, unit_price_eur, title_snapshot) VALUES (?,?,?,?,?)`
      );
      const insTask = db.prepare(
        `INSERT INTO tasks (order_id, order_item_id, title, category, status, worker_role_needed) VALUES (?,?,?,?, 'pending', ?)`
      );
      for (const it of items) {
        const r = insItem.run(orderId, it.service_id, it.quantity, it.price_eur, it.name_es);
        const oid = r.lastInsertRowid;
        const wr = categoryToWorkerRole(it.category);
        insTask.run(orderId, oid, it.name_es + (it.quantity > 1 ? ` ×${it.quantity}` : ""), it.category, wr);
      }

      db.prepare(`DELETE FROM cart_items WHERE user_id = ?`).run(req.user.id);
      if (appliedCode) {
        db.prepare(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ?`).run(appliedCode);
      }
      db.prepare(`INSERT INTO notifications (user_id, body) VALUES (?,?)`).run(
        req.user.id,
        `Pedido ${inv} creado. Total ${total.toFixed(2)} €. Estado: pendiente de pago.`
      );
    });

    try {
      tx();
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "No se pudo completar el pedido" });
    }

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(createdOrderId);
    res.status(201).json(order);
  });

  app.get("/api/orders/me", authRequired, requireUser, (req, res) => {
    if (req.user.role !== "client") return res.json([]);
    const orders = db.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC`).all(req.user.id);
    res.json(orders);
  });

  app.get("/api/orders/:id", authRequired, requireUser, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
    if (!order) return res.status(404).json({ error: "No encontrado" });
    if (order.user_id !== req.user.id && req.user.role !== "admin") return res.status(403).json({ error: "Sin acceso" });
    const lineItems = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(id);
    res.json({ ...order, items: lineItems });
  });

  app.post(
    "/api/quotes",
    authOptional,
    quoteUpload.array("files", 5),
    (req, res) => {
      const email = (req.body.email || "").trim();
      const name = (req.body.name || "").trim();
      const service_type = (req.body.service_type || "").trim();
      const message = (req.body.message || "").trim();
      if (!email || !name || !service_type || !message)
        return res.status(400).json({ error: "Completa todos los campos obligatorios" });
      const paths = (req.files || []).map((f) => path.relative(uploadRoot, f.path).replace(/\\/g, "/"));
      const uid = req.user ? req.user.id : null;
      const info = db
        .prepare(
          `INSERT INTO quotes (user_id, email, name, service_type, message, attachment_paths) VALUES (?,?,?,?,?,?)`
        )
        .run(uid, email, name, service_type, message, JSON.stringify(paths));
      if (req.user) {
        db.prepare(`INSERT INTO notifications (user_id, body) VALUES (?,?)`).run(
          req.user.id,
          "Presupuesto enviado. Te contactaremos pronto."
        );
      }
      res.status(201).json({ id: info.lastInsertRowid, ok: true });
    }
  );

  app.post("/api/tickets", authOptional, (req, res) => {
    const { email, subject, body } = req.body || {};
    if (!email || !subject || !body) return res.status(400).json({ error: "Datos incompletos" });
    const uid = req.user ? req.user.id : null;
    const info = db
      .prepare(`INSERT INTO tickets (user_id, email, subject, body) VALUES (?,?,?,?)`)
      .run(uid, email.trim(), subject.trim(), body.trim());
    res.status(201).json({ id: info.lastInsertRowid, ok: true });
  });

  app.get("/api/portfolio", (req, res) => {
    const rows = db
      .prepare(
        `SELECT id, title, media_type, file_path, thumb_path, sort_order FROM portfolio_items WHERE published = 1 ORDER BY sort_order, id DESC`
      )
      .all();
    res.json(rows.map(publicPortfolioUrl));
  });

  app.get("/api/schedule", (req, res) => {
    const row = db.prepare(`SELECT label_es, label_en, json_hours FROM work_schedule WHERE id = 1`).get();
    if (!row) return res.json({ label_es: "", label_en: "", json_hours: {} });
    let hours;
    try {
      hours = JSON.parse(row.json_hours);
    } catch {
      hours = {};
    }
    res.json({ label_es: row.label_es, label_en: row.label_en, json_hours: hours });
  });

  app.get("/api/announcements", (req, res) => {
    const rows = db
      .prepare(`SELECT id, title, body, created_at FROM announcements WHERE published = 1 ORDER BY id DESC LIMIT 20`)
      .all();
    res.json(rows);
  });

  app.get("/api/notifications", authRequired, requireUser, (req, res) => {
    const rows = db
      .prepare(`SELECT id, body, read_flag, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`)
      .all(req.user.id);
    res.json(rows);
  });

  app.post("/api/notifications/:id/read", authRequired, requireUser, (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.prepare(`UPDATE notifications SET read_flag = 1 WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  });

  /* ——— Admin ——— */
  app.get("/api/admin/stats", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const clients = db.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'client'`).get().n;
    const ordersTotal = db.prepare(`SELECT COUNT(*) as n FROM orders`).get().n;
    const revenue = db.prepare(`SELECT COALESCE(SUM(total_eur),0) as s FROM orders WHERE status != 'cancelled'`).get().s;
    const pendingTasks = db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status != 'done'`).get().n;
    const openTickets = db.prepare(`SELECT COUNT(*) as n FROM tickets WHERE status = 'open'`).get().n;
    res.json({ clients, ordersTotal, revenue, pendingTasks, openTickets });
  });

  app.get("/api/admin/users", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const rows = db
      .prepare(`SELECT id, email, name, role, worker_role, created_at FROM users ORDER BY id DESC`)
      .all();
    res.json(rows.map(stripUser));
  });

  app.post("/api/admin/users", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const { email, password, name, role, worker_role } = req.body || {};
    if (!email || !password || !name || !role)
      return res.status(400).json({ error: "Faltan campos" });
    if (!["client", "worker", "admin"].includes(role)) return res.status(400).json({ error: "Rol inválido" });
    if (role === "worker" && worker_role && !["video_editor", "graphic_designer", "config_tech"].includes(worker_role))
      return res.status(400).json({ error: "worker_role inválido" });
    const hash = bcrypt.hashSync(password, 12);
    try {
      const info = db
        .prepare(
          `INSERT INTO users (email, password_hash, name, role, worker_role) VALUES (?,?,?,?,?)`
        )
        .run(email.trim().toLowerCase(), hash, name.trim(), role, role === "worker" ? worker_role || null : null);
      const user = db.prepare(`SELECT id, email, name, role, worker_role FROM users WHERE id = ?`).get(info.lastInsertRowid);
      res.status(201).json(stripUser(user));
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Email duplicado" });
      throw e;
    }
  });

  app.get("/api/admin/coupons", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    res.json(db.prepare(`SELECT * FROM coupons ORDER BY id DESC`).all());
  });

  app.post("/api/admin/coupons", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const { code, discount_type, discount_value, max_uses, expires_at, active = 1 } = req.body || {};
    if (!code || !discount_type || discount_value == null)
      return res.status(400).json({ error: "Código y descuento requeridos" });
    try {
      const info = db
        .prepare(
          `INSERT INTO coupons (code, discount_type, discount_value, max_uses, expires_at, active) VALUES (?,?,?,?,?,?)`
        )
        .run(String(code).toUpperCase(), discount_type, Number(discount_value), max_uses || null, expires_at || null, active ? 1 : 0);
      res.status(201).json(db.prepare(`SELECT * FROM coupons WHERE id = ?`).get(info.lastInsertRowid));
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Código duplicado" });
      throw e;
    }
  });

  app.patch("/api/admin/coupons/:id", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const c = db.prepare(`SELECT * FROM coupons WHERE id = ?`).get(id);
    if (!c) return res.status(404).json({ error: "No encontrado" });
    const { discount_value, max_uses, expires_at, active } = req.body || {};
    db.prepare(
      `UPDATE coupons SET discount_value = COALESCE(?, discount_value), max_uses = COALESCE(?, max_uses),
       expires_at = COALESCE(?, expires_at), active = COALESCE(?, active) WHERE id = ?`
    ).run(
      discount_value != null ? Number(discount_value) : null,
      max_uses !== undefined ? max_uses : null,
      expires_at !== undefined ? expires_at : null,
      active !== undefined ? (active ? 1 : 0) : null,
      id
    );
    res.json(db.prepare(`SELECT * FROM coupons WHERE id = ?`).get(id));
  });

  app.delete("/api/admin/coupons/:id", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    db.prepare(`DELETE FROM coupons WHERE id = ?`).run(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  app.get("/api/admin/orders", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT o.*, u.email as user_email, u.name as user_name FROM orders o
         JOIN users u ON u.id = o.user_id ORDER BY o.id DESC`
      )
      .all();
    res.json(rows);
  });

  app.patch("/api/admin/orders/:id", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    const allowed = ["pending", "paid", "in_progress", "completed", "cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Estado inválido" });
    db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(status, id);
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
    db.prepare(`INSERT INTO notifications (user_id, body) VALUES (?,?)`).run(
      order.user_id,
      `Tu pedido ${order.invoice_number} está ahora: ${status}.`
    );
    res.json(order);
  });

  app.get("/api/admin/tasks", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, u.email as worker_email, o.invoice_number
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_worker_id
         JOIN orders o ON o.id = t.order_id
         ORDER BY t.id DESC`
      )
      .all();
    res.json(rows);
  });

  app.patch("/api/admin/tasks/:id", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { assigned_worker_id, status, commission_percentage, deadline_at, admin_feedback } = req.body || {};
    const task = db.prepare(`SELECT t.*, oi.unit_price_eur FROM tasks t JOIN order_items oi ON oi.id = t.order_item_id WHERE t.id = ?`).get(id);
    if (!task) return res.status(404).json({ error: "No encontrado" });
    if (assigned_worker_id !== undefined) {
      if (assigned_worker_id === null) {
        db.prepare(`UPDATE tasks SET assigned_worker_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
      } else {
        const w = db
          .prepare(`SELECT id FROM users WHERE id = ? AND role = 'worker'`)
          .get(parseInt(assigned_worker_id, 10));
        if (!w) return res.status(400).json({ error: "Trabajador no válido" });
        db.prepare(`UPDATE tasks SET assigned_worker_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
          assigned_worker_id,
          id
        );
        db.prepare(`INSERT INTO notifications (user_id, body) VALUES (?,?)`).run(
          assigned_worker_id,
          `Nueva tarea asignada: ${task.title} (pedido ${task.order_id}).`
        );
      }
    }
    if (status) {
      const ok = ["pending", "in_progress", "done"].includes(status);
      if (!ok) return res.status(400).json({ error: "Estado inválido" });
      db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
    }
    if (commission_percentage !== undefined) {
       const pct = commission_percentage === null ? null : parseFloat(commission_percentage);
       const price = task.unit_price_eur || 0;
       const earnings = pct === null ? null : (price * pct / 100);
       db.prepare(`UPDATE tasks SET commission_percentage = ?, earnings_eur = ?, updated_at = datetime('now') WHERE id = ?`).run(pct, earnings, id);
    }
    if (deadline_at !== undefined) {
      db.prepare(`UPDATE tasks SET deadline_at = ?, updated_at = datetime('now') WHERE id = ?`).run(deadline_at || null, id);
    }
    if (admin_feedback !== undefined) {
      db.prepare(`UPDATE tasks SET admin_feedback = ?, updated_at = datetime('now') WHERE id = ?`).run(admin_feedback || null, id);
    }
    res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id));
  });

  app.post("/api/admin/tasks/:id/source", authRequired, requireUser, requireRoles("admin"), workerUpload.single("file"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    if (!task) return res.status(404).json({ error: "No encontrado" });
    if (!req.file) return res.status(400).json({ error: "No se adjuntó archivo" });
    
    const rel = path.relative(uploadRoot, req.file.path).replace(/\\/g, "/");
    db.prepare(`UPDATE tasks SET source_file_path = ?, updated_at = datetime('now') WHERE id = ?`).run(rel, id);
    res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id));
  });

  app.put("/api/admin/schedule", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const { label_es, label_en, json_hours } = req.body || {};
    if (!json_hours) return res.status(400).json({ error: "json_hours requerido" });
    const json = typeof json_hours === "string" ? json_hours : JSON.stringify(json_hours);
    db.prepare(`UPDATE work_schedule SET label_es = ?, label_en = ?, json_hours = ?, updated_at = datetime('now') WHERE id = 1`).run(
      label_es || null,
      label_en || null,
      json
    );
    res.json({ ok: true });
  });

  app.get("/api/admin/portfolio", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    res.json(db.prepare(`SELECT * FROM portfolio_items ORDER BY sort_order, id DESC`).all().map(publicPortfolioUrl));
  });

  app.post(
    "/api/admin/portfolio",
    authRequired,
    requireUser,
    requireRoles("admin"),
    portfolioUpload.single("file"),
    (req, res) => {
      const { title, media_type } = req.body || {};
      if (!req.file || !title || !media_type) return res.status(400).json({ error: "Archivo y datos requeridos" });
      if (!["image", "video"].includes(media_type)) return res.status(400).json({ error: "media_type image|video" });
      const rel = path.relative(uploadRoot, req.file.path).replace(/\\/g, "/");
      const info = db
        .prepare(
          `INSERT INTO portfolio_items (title, media_type, file_path, thumb_path, sort_order, published) VALUES (?,?,?,?,0,1)`
        )
        .run(title, media_type, rel, null);
      res.status(201).json(publicPortfolioUrl(db.prepare(`SELECT * FROM portfolio_items WHERE id = ?`).get(info.lastInsertRowid)));
    }
  );

  app.delete("/api/admin/portfolio/:id", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare(`SELECT * FROM portfolio_items WHERE id = ?`).get(id);
    if (row) {
      try {
        fs.unlinkSync(path.join(uploadRoot, row.file_path));
      } catch {}
    }
    db.prepare(`DELETE FROM portfolio_items WHERE id = ?`).run(id);
    res.json({ ok: true });
  });

  app.post("/api/admin/announcements", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const { title, body, published = 1 } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "Título y cuerpo" });
    const info = db.prepare(`INSERT INTO announcements (title, body, published) VALUES (?,?,?)`).run(title, body, published ? 1 : 0);
    res.status(201).json(db.prepare(`SELECT * FROM announcements WHERE id = ?`).get(info.lastInsertRowid));
  });

  app.get("/api/admin/quotes", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    res.json(db.prepare(`SELECT * FROM quotes ORDER BY id DESC`).all());
  });

  app.get("/api/admin/tickets", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    res.json(db.prepare(`SELECT * FROM tickets ORDER BY id DESC`).all());
  });

  app.patch("/api/admin/tickets/:id", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    if (!["open", "in_progress", "closed"].includes(status)) return res.status(400).json({ error: "Estado inválido" });
    db.prepare(`UPDATE tickets SET status = ? WHERE id = ?`).run(status, id);
    res.json(db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id));
  });

  app.patch("/api/admin/services/:id", authRequired, requireUser, requireRoles("admin"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { price_eur, active } = req.body || {};
    db.prepare(`UPDATE services SET price_eur = COALESCE(?, price_eur), active = COALESCE(?, active) WHERE id = ?`).run(
      price_eur != null ? Number(price_eur) : null,
      active !== undefined ? (active ? 1 : 0) : null,
      id
    );
    res.json(db.prepare(`SELECT * FROM services WHERE id = ?`).get(id));
  });

  /* ——— Worker ——— */
  app.get("/api/worker/tasks", authRequired, requireUser, requireRoles("worker"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, o.invoice_number, o.user_id as client_id, u.name as client_name, u.email as client_email
         FROM tasks t
         JOIN orders o ON o.id = t.order_id
         JOIN users u ON u.id = o.user_id
         WHERE t.assigned_worker_id = ?
         ORDER BY t.id DESC`
      )
      .all(req.user.id);
    res.json(rows);
  });

  app.get("/api/worker/clients", authRequired, requireUser, requireRoles("worker"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.email FROM users u
         JOIN orders o ON o.user_id = u.id
         JOIN tasks t ON t.order_id = o.id
         WHERE t.assigned_worker_id = ?`
      )
      .all(req.user.id);
    res.json(rows);
  });

  app.patch("/api/worker/tasks/:id", authRequired, requireUser, requireRoles("worker"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status, progress_percentage } = req.body || {};
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    if (!task || task.assigned_worker_id !== req.user.id) return res.status(404).json({ error: "No encontrado" });
    if (status) {
      const ok = ["pending", "in_progress", "done"].includes(status);
      if (!ok) return res.status(400).json({ error: "Estado inválido" });
      db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
    }
    if (progress_percentage !== undefined && progress_percentage !== null) {
      const p = Math.min(100, Math.max(0, parseInt(progress_percentage, 10) || 0));
      db.prepare(`UPDATE tasks SET progress_percentage = ?, updated_at = datetime('now') WHERE id = ?`).run(p, id);
    }
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(task.order_id);
    db.prepare(`INSERT INTO notifications (user_id, body) VALUES (?,?)`).run(
      order.user_id,
      `Actualización en ${task.title}: ${status}.`
    );
    res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id));
  });

  app.post("/api/worker/tasks/:id/complete", authRequired, requireUser, requireRoles("worker"), workerUpload.single("file"), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    if (!task || task.assigned_worker_id !== req.user.id) return res.status(404).json({ error: "No encontrado" });
    if (!req.file) return res.status(400).json({ error: "No se adjuntó archivo" });
    
    const rel = path.relative(uploadRoot, req.file.path).replace(/\\/g, "/");
    
    db.prepare(`UPDATE tasks SET status = 'done', result_file_path = ?, result_submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(rel, id);
    res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id));
  });

  function publicPortfolioUrl(row) {
    if (!row) return row;
    const base = "/uploads/";
    return {
      ...row,
      url: base + row.file_path.replace(/^\//, ""),
      thumbUrl: row.thumb_path ? base + row.thumb_path.replace(/^\//, "") : null
    };
  }

  function stripUser(u) {
    if (!u) return u;
    const { password_hash, ...rest } = u;
    return rest;
  }

}

module.exports = { registerRoutes };

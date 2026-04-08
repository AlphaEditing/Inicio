/* eslint-disable no-console */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const root = path.join(__dirname, "..", "..");
const schemaPath = path.join(root, "database", "schema.sql");
const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(root, "database", "alphavs.db");

const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const schema = fs.readFileSync(schemaPath, "utf8");
const db = new Database(dbPath);
db.exec(schema);

const services = [
  ["logo", "Logo", "Logo", "graphic", 10, "fixed"],
  ["miniatura-youtube", "Miniatura YouTube", "YouTube thumbnail", "graphic", 15, "fixed"],
  ["diseno-streaming", "Diseño de streaming", "Streaming design", "graphic", 40, "fixed"],
  ["diseno-redes", "Diseño redes sociales", "Social media design", "graphic", 30, "fixed"],
  ["video-youtube", "Video YouTube", "YouTube video", "video", 50, "fixed"],
  ["youtube-short", "YouTube Short", "YouTube Short", "video", 20, "fixed"],
  ["tiktok", "TikTok", "TikTok", "video", 20, "fixed"],
  ["instagram", "Instagram", "Instagram", "video", 15, "fixed"],
  ["config-obs", "Configuración OBS", "OBS setup", "config", 40, "fixed"],
  ["config-discord", "Configuración Discord", "Discord setup", "config", 30, "fixed"],
  ["config-streamdeck", "Configuración Stream Deck", "Stream Deck setup", "config", 30, "fixed"],
  ["hora-diseno", "Diseño gráfico (hora)", "Graphic design (hour)", "hourly", 35, "hourly"],
  ["hora-video", "Edición de video (hora)", "Video editing (hour)", "hourly", 45, "hourly"],
  ["hora-config", "Configuraciones (hora)", "Setups (hour)", "hourly", 40, "hourly"]
];

const insertService = db.prepare(
  `INSERT OR IGNORE INTO services (slug, name_es, name_en, category, price_eur, price_type) VALUES (?,?,?,?,?,?)`
);
for (const s of services) insertService.run(...s);

db.prepare(
  `INSERT OR IGNORE INTO coupons (code, discount_type, discount_value, max_uses, used_count, active) VALUES ('WELCOME10', 'percent', 10, 100, 0, 1)`
).run();

const adminEmail = "alpha@admin";
const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
if (!exists) {
  const hash = bcrypt.hashSync("alphaadmin", 12);
  db.prepare(
    `INSERT INTO users (email, password_hash, name, role, worker_role) VALUES (?,?,?,?,NULL)`
  ).run(adminEmail, hash, "Administrador", "admin");
  console.log("Usuario admin creado:", adminEmail, "/ Admin123!  (cámbialo en producción)");
}

const sched = db.prepare("SELECT id FROM work_schedule WHERE id = 1").get();
if (!sched) {
  const json = JSON.stringify({
    timezone: "Europe/Madrid",
    days: [
      { key: "mon", es: "Lunes", en: "Monday", hours: "10:00–14:00, 16:00–20:00" },
      { key: "tue", es: "Martes", en: "Tuesday", hours: "10:00–14:00, 16:00–20:00" },
      { key: "wed", es: "Miércoles", en: "Wednesday", hours: "10:00–14:00, 16:00–20:00" },
      { key: "thu", es: "Jueves", en: "Thursday", hours: "10:00–14:00, 16:00–20:00" },
      { key: "fri", es: "Viernes", en: "Friday", hours: "10:00–14:00, 16:00–18:00" },
      { key: "sat", es: "Sábado", en: "Saturday", hours: "Cerrado / Closed" },
      { key: "sun", es: "Domingo", en: "Sunday", hours: "Cerrado / Closed" }
    ]
  });
  db.prepare(
    `INSERT INTO work_schedule (id, label_es, label_en, json_hours) VALUES (1, ?, ?, ?)`
  ).run(
    "Horario de atención (Jaén, España)",
    "Business hours (Jaén, Spain)",
    json
  );
}

db.close();
console.log("Base de datos lista en:", dbPath);

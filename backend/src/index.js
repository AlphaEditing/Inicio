require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const express = require("express");
const { openDb } = require("./db");
const { registerRoutes } = require("./routes");

const app = express();
const db = openDb();

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16) {
  console.warn("[alphavs] Define JWT_SECRET (mín. 16 caracteres) en backend/.env");
}

app.use(express.json({ limit: "2mb" }));

registerRoutes(app, { db, jwtSecret: jwtSecret || "dev-only-cambiar-en-produccion" });

const frontend = path.resolve(process.cwd(), process.env.FRONTEND_DIR || "..");
app.use(express.static(frontend));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Ruta API no encontrada" });
  }
  next();
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Alpha Visual Studio — http://localhost:${PORT}`);
});

const jwt = require("jsonwebtoken");

function authMiddleware(jwtSecret) {
  return function optionalAuth(required) {
    return (req, res, next) => {
      const h = req.headers.authorization || "";
      const m = h.match(/^Bearer\s+(.+)$/i);
      if (!m) {
        if (required) return res.status(401).json({ error: "No autorizado" });
        req.user = null;
        return next();
      }
      try {
        const payload = jwt.verify(m[1], jwtSecret);
        req.user = {
          id: payload.sub,
          role: payload.role,
          worker_role: payload.worker_role || null
        };
        next();
      } catch {
        if (required) return res.status(401).json({ error: "Token inválido" });
        req.user = null;
        next();
      }
    };
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Inicia sesión" });
  next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Inicia sesión" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Sin permiso" });
    next();
  };
}

function signToken(jwtSecret, user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      worker_role: user.worker_role
    },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

module.exports = { authMiddleware, requireUser, requireRoles, signToken };

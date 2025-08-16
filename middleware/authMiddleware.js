// RUTA: backend/middleware/authMiddleware.js (v18.3 - CORRECCIÓN SUPER ADMIN)

const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Obtenemos el usuario y sus campos clave para la validación.
      req.user = await User.findById(decoded.id).select('-password -transactions'); 

      if (!req.user) {
          res.status(401);
          throw new Error('No autorizado, el usuario del token ya no existe.');
      }

      // La barrera de seguridad ahora es simple y robusta.
      // Si el status no es 'active', se deniega el acceso.
      if (req.user.status !== 'active') {
          res.status(403); // 403 Forbidden
          throw new Error(`Acceso denegado. Estado de la cuenta: ${req.user.status}.`);
      }
      
      next();

    } catch (error) {
      const statusCode = res.statusCode !== 200 ? res.statusCode : 401;
      const message = error.message || 'No autorizado, token fallido.';
      res.status(statusCode).json({ message });
      return;
    }
  }

  if (!token) {
    res.status(401);
    throw new Error('No autorizado, no se encontró token.');
  }
});

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acceso denegado. Se requieren permisos de administrador.' });
    }
};

// --- INICIO DE LA CORRECCIÓN ---
const isSuperAdmin = (req, res, next) => {
    // CORREGIDO: Se utiliza la variable de entorno semánticamente correcta 'SUPER_ADMIN_TELEGRAM_ID'.
    if (!process.env.SUPER_ADMIN_TELEGRAM_ID) {
        console.error('CRITICAL SECURITY ALERT: SUPER_ADMIN_TELEGRAM_ID is not set.'.red.bold);
        return res.status(500).json({ message: 'Error de configuración del servidor.' });
    }
    // CORREGIDO: La comparación ahora se hace contra la variable correcta.
    if (req.user && req.user.telegramId === process.env.SUPER_ADMIN_TELEGRAM_ID) {
        next();
    } else {
        res.status(403).json({ message: 'Acceso denegado. Se requieren permisos de Super Administrador.' });
    }
};
// --- FIN DE LA CORRECCIÓN ---

module.exports = {
  protect,
  isAdmin,
  isSuperAdmin,
};
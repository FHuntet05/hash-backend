// RUTA: backend/middleware/authMiddleware.js (v18.0 - CON VALIDACIÓN DE BANEO)

const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Obtenemos el usuario completo, incluyendo el estado
      req.user = await User.findById(decoded.id).select('-password'); 

      if (!req.user) {
          res.status(401);
          throw new Error('Usuario del token ya no existe.');
      }

      // --- INICIO DE CORRECCIÓN DE SEGURIDAD CRÍTICA ---
      // Verificamos si el usuario está baneado.
      if (req.user.status === 'banned') {
          res.status(403); // 403 Forbidden es más apropiado que 401 Unauthorized
          throw new Error('Acceso denegado. Tu cuenta ha sido suspendida.');
      }
      // --- FIN DE CORRECCIÓN DE SEGURIDAD CRÍTICA ---
      
      next();

    } catch (error) {
      // Usamos el mensaje del error si es el de baneo, si no, uno genérico.
      const errorMessage = error.message.includes('suspendida') ? error.message : 'No autorizado, token fallido.';
      const statusCode = res.statusCode === 200 ? 401 : res.statusCode;
      res.status(statusCode).json({ message: errorMessage });
    }
  }

  if (!token) {
    res.status(401);
    throw new Error('No autorizado, no hay token.');
  }
});

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acceso denegado. Se requieren permisos de administrador.' });
    }
};

const isSuperAdmin = (req, res, next) => {
    if (!process.env.ADMIN_TELEGRAM_ID) {
        console.error('CRITICAL SECURITY ALERT: ADMIN_TELEGRAM_ID is not set.'.red.bold);
        return res.status(500).json({ message: 'Error de configuración del servidor.' });
    }
    if (req.user && req.user.telegramId === process.env.ADMIN_TELEGRAM_ID) {
        next();
    } else {
        res.status(403).json({ message: 'Acceso denegado. Se requieren permisos de Super Administrador.' });
    }
};

module.exports = {
  protect,
  isAdmin,
  isSuperAdmin,
};
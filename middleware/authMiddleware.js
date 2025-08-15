// RUTA: backend/middleware/authMiddleware.js (v18.1 - BANEO REFORZADO)

const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      req.user = await User.findById(decoded.id).select('-password'); 

      if (!req.user) {
          res.status(401);
          throw new Error('No autorizado, el usuario del token ya no existe.');
      }

      // --- INICIO DE CORRECCIÓN DE SEGURIDAD CRÍTICA: BARRERA FINAL DE BANEO ---
      // Esta es la barrera final para CADA petición a la API. Si un usuario es baneado
      // mientras tiene una sesión activa, será expulsado en su siguiente acción.
      if (req.user.status === 'banned') {
          res.status(403); // 403 Forbidden: Autenticado pero no tiene permiso.
          throw new Error('Acceso denegado: tu cuenta ha sido suspendida.');
      }
      // --- FIN DE CORRECCIÓN DE SEGURIDAD CRÍTICA ---
      
      next();

    } catch (error) {
      // Devolvemos el status code que hayamos seteado (401 o 403)
      const statusCode = res.statusCode !== 200 ? res.statusCode : 401;
      // Y un mensaje claro.
      const message = error.message || 'No autorizado, token fallido.';
      res.status(statusCode).json({ message });
      return; // Detenemos la ejecución
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
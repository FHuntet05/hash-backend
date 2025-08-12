// backend/middleware/authMiddleware.js (VERSIÓN v17.0 - CON SUPER ADMIN)

const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const asyncHandler = require('express-async-handler');

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // 1. Obtener el token del header
      token = req.headers.authorization.split(' ')[1];

      // 2. Verificar la firma del token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 3. Obtener el usuario del token y adjuntarlo a `req`
      const userId = decoded.id; 
      if (!userId) {
        res.status(401);
        throw new Error('Token inválido, no contiene ID de usuario.');
      }
      
      req.user = await User.findById(userId).select('-password'); 

      if (!req.user) {
          res.status(401);
          throw new Error('Usuario del token ya no existe.');
      }
      
      // Si todo va bien, pasa al siguiente middleware/controlador
      next();

    } catch (error) {
      console.error('ERROR DE AUTENTICACIÓN:', error.message);
      res.status(401);
      throw new Error('No autorizado, token fallido.');
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

/**
 * Middleware para verificar si el usuario es el Super Administrador.
 * Debe usarse SIEMPRE después de 'protect' e 'isAdmin'.
 */
const isSuperAdmin = (req, res, next) => {
    // Verificamos que la variable de entorno exista para evitar fallos de seguridad.
    if (!process.env.ADMIN_TELEGRAM_ID) {
        console.error('CRITICAL SECURITY ALERT: ADMIN_TELEGRAM_ID is not set.'.red.bold);
        return res.status(500).json({ message: 'Error de configuración del servidor.' });
    }

    // Comparamos el telegramId del usuario autenticado con la variable de entorno.
    if (req.user && req.user.telegramId === process.env.ADMIN_TELEGRAM_ID) {
        next(); // El usuario es el Super Admin, puede continuar.
    } else {
        res.status(403).json({ message: 'Acceso denegado. Se requieren permisos de Super Administrador.' });
    }
};

module.exports = {
  protect,
  isAdmin,
  isSuperAdmin,
};
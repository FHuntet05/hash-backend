// backend/routes/authRoutes.js (FINAL CON RUTA DE UPDATE DE CONTRASEÑA)
const express = require('express');
const router = express.Router();
const { 
    syncUser, 
    getUserProfile, 
    loginAdmin, 
    getAdminProfile, 
    updateAdminPassword 
} = require('../controllers/authController');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// --- Rutas de Usuario Final (Telegram Web App) ---
router.post('/sync', syncUser);
router.get('/profile', protect, getUserProfile);

// --- Rutas de Administración ---
router.post('/login/admin', loginAdmin);
router.get('/admins/profile', protect, isAdmin, getAdminProfile);
router.put('/admins/update-password', protect, isAdmin, updateAdminPassword);

module.exports = router;
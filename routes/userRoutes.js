// RUTA: backend/routes/userRoutes.js (v2.0 - FEATURE-001: RUTAS DE WALLET Y PASSWORD)

const express = require('express');
const { setWithdrawalPassword, setWithdrawalAddress } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// --- RUTA PROTEGIDA PARA LA CONTRASEÑA DE RETIRO ---
// POST /api/users/withdrawal-password
router.route('/withdrawal-password').post(protect, setWithdrawalPassword);

// --- INICIO DE NUEVA RUTA PARA FEATURE-001 ---
// RUTA PROTEGIDA PARA ESTABLECER LA WALLET DE RETIRO
// PUT /api/users/withdrawal-address
router.route('/withdrawal-address').put(protect, setWithdrawalAddress);
// --- FIN DE NUEVA RUTA ---

module.exports = router;
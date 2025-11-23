// RUTA: backend/routes/userRoutes.js

const express = require('express');
const { setWithdrawalPassword, setWithdrawalAddress } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// --- RUTA DE PASSWORD (CAMBIADO A PUT) ---
router.route('/withdrawal-password').put(protect, setWithdrawalPassword);

// --- RUTA DE WALLET (YA ESTABA PUT) ---
router.route('/withdrawal-address').put(protect, setWithdrawalAddress);

module.exports = router;
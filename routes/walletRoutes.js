// backend/routes/walletRoutes.js (VERSIÓN MEGA FÁBRICA v2.0 - SINCRONIZADA)
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect } = require('../middleware/authMiddleware');

// === RUTAS PARA EL NUEVO SISTEMA "MEGA FÁBRICA" ===

// Ruta para que el usuario compre una fábrica usando su saldo interno.
router.post('/purchase-factory', protect, walletController.purchaseFactoryWithBalance);

// Ruta para que el usuario reclame la producción de todas sus fábricas.
router.post('/claim-all-production', protect, walletController.claimAllProduction);

// Ruta para solicitar un retiro de USDT.
router.post('/request-withdrawal', protect, walletController.requestWithdrawal);

// Ruta para obtener el historial de transacciones del usuario.
router.get('/history', protect, walletController.getHistory);

module.exports = router;
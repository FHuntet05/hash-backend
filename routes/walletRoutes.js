// backend/routes/walletRoutes.js (VERSIÓN v18.0 - MEGA FÁBRICA)
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect } = require('../middleware/authMiddleware');

// === RUTAS PARA EL NUEVO SISTEMA "MEGA FÁBRICA" ===

// Ruta para que el usuario compre una fábrica usando su saldo interno.
router.post('/purchase-factory', protect, walletController.purchaseFactoryWithBalance);

// Ruta para que el usuario reclame la producción de una de sus fábricas.
router.post('/claim-production', protect, walletController.claimFactoryProduction);

// Ruta para solicitar un retiro de USDT. La lógica se mantiene.
router.post('/request-withdrawal', protect, walletController.requestWithdrawal);

// Ruta para obtener el historial de transacciones del usuario. La lógica se mantiene.
router.get('/history', protect, walletController.getHistory);


// --- RUTAS OBSOLETAS ELIMINADAS ---
// '/purchase-with-balance' -> renombrada a '/purchase-factory' para mayor claridad.
// '/create-deposit-invoice' -> Eliminada (CryptoCloud).
// '/start-mining' -> Eliminada (Lógica de Neuro Link).
// '/claim' -> renombrada a '/claim-production'.
// '/swap' -> Eliminada (No hay NTX).
// '/webhook' -> Eliminada (CryptoCloud).

module.exports = router;
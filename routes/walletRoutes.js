// backend/routes/walletRoutes.js (VERSIÓN MEGA FÁBRICA v2.1 - SINCRONIZADA FINAL)
const express = require('express');
const router = express.Router();
const { 
    purchaseFactoryWithBalance,
    claimFactoryProduction, // Se importa la función correcta
    requestWithdrawal,
    getHistory 
} = require('../controllers/walletController');
const { protect } = require('../middleware/authMiddleware');

// === RUTAS PARA EL NUEVO SISTEMA "MEGA FÁBRICA" ===

// Ruta para que el usuario compre una fábrica usando su saldo interno.
router.post('/purchase-factory', protect, purchaseFactoryWithBalance);

// Ruta para que el usuario reclame la producción de UNA fábrica específica.
// MODIFICADO: Apunta a la función y ruta correctas que espera la HomePage.
router.post('/claim-production', protect, claimFactoryProduction);

// Ruta para solicitar un retiro de USDT.
router.post('/request-withdrawal', protect, requestWithdrawal);

// Ruta para obtener el historial de transacciones del usuario.
router.get('/history', protect, getHistory);

module.exports = router;
// RUTA: backend/routes/walletRoutes.js (v1.1 - SINCRONIZADO Y ESTABLE)

const express = require('express');
const router = express.Router();

// --- INICIO DE CORRECCIÓN QUIRÚRGICA ---
// Se importan las funciones con los nombres EXACTOS que se exportan desde walletController.js
const { 
    createDepositAddress,
    purchaseFactoryWithBalance, // <-- CORREGIDO
    claimFactoryProduction,   // <-- CORREGIDO
    requestWithdrawal,
    getHistory 
} = require('../controllers/walletController');
// --- FIN DE CORRECCIÓN QUIRÚRGICA ---

const { protect } = require('../middleware/authMiddleware');

// === RUTAS PARA EL SISTEMA "MEGA FÁBRICA" ===
// Todas las rutas están protegidas y requieren un token de autenticación válido.

// POST /api/wallet/create-deposit-address
// Genera la información para que un usuario realice un depósito.
router.post('/create-deposit-address', protect, createDepositAddress);

// POST /api/wallet/purchase-factory
// Permite al usuario comprar una fábrica usando su saldo interno.
// --- INICIO DE CORRECCIÓN QUIRÚRGICA ---
router.post('/purchase-factory', protect, purchaseFactoryWithBalance); // <-- CORREGIDO
// --- FIN DE CORRECCIÓN QUIRÚRGICA ---

// POST /api/wallet/claim-production
// Permite al usuario reclamar la producción de una fábrica específica.
// --- INICIO DE CORRECCIÓN QUIRÚRGICA ---
router.post('/claim-production', protect, claimFactoryProduction); // <-- CORREGIDO
// --- FIN DE CORRECCIÓN QUIRÚRGICA ---

// POST /api/wallet/request-withdrawal
// Inicia una solicitud de retiro de fondos.
router.post('/request-withdrawal', protect, requestWithdrawal);

// GET /api/wallet/history
// Obtiene el historial de transacciones del usuario.
router.get('/history', protect, getHistory);


module.exports = router;
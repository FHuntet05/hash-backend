// RUTA: backend/routes/walletRoutes.js (v2.0 - SEMÁNTICA "MINER" INTEGRADA)

const express = require('express');
const router = express.Router();

// Las funciones del controlador ya fueron renombradas internamente, pero aquí no cambia nada
const { 
    createDepositAddress,
    purchaseFactoryWithBalance, // Mantenemos el nombre de la función por ahora
    claimFactoryProduction,   // Mantenemos el nombre de la función por ahora
    requestWithdrawal,
    getHistory 
} = require('../controllers/walletController');

const { protect } = require('../middleware/authMiddleware');

// === RUTAS DEL SISTEMA v11.0 ===
// Todas las rutas están protegidas y requieren un token de autenticación válido.

// POST /api/wallet/create-deposit-address
// Genera la información para que un usuario realice un depósito. (Sin cambios)
router.post('/create-deposit-address', protect, createDepositAddress);

// --- INICIO DE REFACTORIZACIÓN DE RUTA ---
// POST /api/wallet/purchase-miner
// Permite al usuario comprar un minero usando su saldo interno.
router.post('/purchase-miner', protect, purchaseFactoryWithBalance);
// --- FIN DE REFACTORIZACIÓN DE RUTA ---

// --- INICIO DE REFACTORIZACIÓN DE RUTA ---
// POST /api/wallet/claim-production
// Permite al usuario reclamar la producción de un minero específico.
router.post('/claim-miner', protect, claimFactoryProduction);
// --- FIN DE REFACTORIZACIÓN DE RUTA ---

// POST /api/wallet/request-withdrawal
// Inicia una solicitud de retiro de fondos. (Sin cambios)
router.post('/request-withdrawal', protect, requestWithdrawal);

// GET /api/wallet/history
// Obtiene el historial de transacciones del usuario. (Sin cambios)
router.get('/history', protect, getHistory);

// Se eliminan las rutas antiguas '/purchase-factory' y '/claim-production'
// para evitar duplicados y forzar la actualización del frontend.

module.exports = router;
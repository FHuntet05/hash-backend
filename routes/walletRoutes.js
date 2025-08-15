// RUTA: backend/routes/walletRoutes.js (SINCRONIZADO Y CORREGIDO)

const express = require('express');
const router = express.Router();

// Importamos las funciones con los nombres correctos desde el controlador actualizado
const { 
    createDepositAddress,
    purchaseFactory, // <-- CORREGIDO: Nombre cambiado
    claimProduction, // <-- CORREGIDO: Nombre cambiado
    requestWithdrawal,
    getHistory 
} = require('../controllers/walletController');
const { protect } = require('../middleware/authMiddleware');

// === RUTAS PARA EL SISTEMA "MEGA FÁBRICA" ===
// Todas las rutas están protegidas y requieren un token de autenticación válido.

// POST /api/wallet/create-deposit-address
// Genera la información para que un usuario realice un depósito.
router.post('/create-deposit-address', protect, createDepositAddress);

// POST /api/wallet/purchase-factory
// Permite al usuario comprar una fábrica usando su saldo interno.
router.post('/purchase-factory', protect, purchaseFactory); // <-- CORREGIDO: Se usa la función correcta

// POST /api/wallet/claim-production
// Permite al usuario reclamar la producción de una fábrica específica.
router.post('/claim-production', protect, claimProduction); // <-- CORREGIDO: Se usa la función correcta

// POST /api/wallet/request-withdrawal
// Inicia una solicitud de retiro de fondos.
router.post('/request-withdrawal', protect, requestWithdrawal);

// GET /api/wallet/history
// Obtiene el historial de transacciones del usuario.
router.get('/history', protect, getHistory);


module.exports = router;
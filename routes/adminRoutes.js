// RUTA: backend/routes/adminRoutes.js (v40.0 - CON PROTECCIÓN SUPER ADMIN)

const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getSettings,
    updateSettings,
    getAllUsers,
    getUserDetails,
    updateUser,
    setUserStatus,
    adjustUserBalance,
    getAllTransactions,
    createManualTransaction,
    getPendingWithdrawals,
    processWithdrawal,
    getTreasuryWalletsList,
    getWalletBalance,
    sweepFunds,
    sweepGas,
    analyzeGasNeeds,
    dispatchGas,
    getAllFactories,
    createFactory,
    updateFactory,
    deleteFactory,
    generateTwoFactorSecret,
    verifyAndEnableTwoFactor,
    sendBroadcastNotification,
    getPendingBlockchainTxs,
    cancelTransaction,
    speedUpTransaction,
    promoteUserToAdmin,
    resetAdminPassword,
    demoteAdminToUser
} = require('../controllers/adminController.js');
const { protect, isAdmin, isSuperAdmin } = require('../middleware/authMiddleware');

// Rutas de Dashboard y Configuración
router.get('/stats', protect, isAdmin, getDashboardStats);
router.route('/settings').get(protect, isAdmin, getSettings).put(protect, isAdmin, updateSettings);

// Rutas de Gestión de Usuarios
router.get('/users', protect, isAdmin, getAllUsers);
router.get('/users/:id/details', protect, isAdmin, getUserDetails);
router.put('/users/:id', protect, isAdmin, updateUser);
router.put('/users/:id/status', protect, isAdmin, setUserStatus);
router.post('/users/:id/adjust-balance', protect, isAdmin, adjustUserBalance);

// Rutas de Gestión de Permisos de Administrador (PROTEGIDAS POR SUPER ADMIN)
router.post('/users/promote', protect, isAdmin, isSuperAdmin, promoteUserToAdmin);
router.post('/users/demote', protect, isAdmin, isSuperAdmin, demoteAdminToUser);
router.post('/admins/reset-password', protect, isAdmin, isSuperAdmin, resetAdminPassword);

// Rutas de Gestión de Transacciones y Retiros
router.get('/transactions', protect, isAdmin, getAllTransactions);
router.post('/transactions/manual', protect, isAdmin, createManualTransaction);
router.get('/withdrawals/pending', protect, isAdmin, getPendingWithdrawals);
router.put('/withdrawals/:id/process', protect, isAdmin, processWithdrawal);

// Rutas de Tesorería y Dispensador
router.get('/treasury/wallets-list', protect, isAdmin, getTreasuryWalletsList);
router.post('/treasury/wallet-balance', protect, isAdmin, getWalletBalance);
router.post('/sweep-funds', protect, isAdmin, sweepFunds);
router.post('/sweep-gas', protect, isAdmin, sweepGas);
router.get('/gas-dispenser/analyze', protect, isAdmin, analyzeGasNeeds);
router.post('/gas-dispenser/dispatch', protect, isAdmin, dispatchGas);

// Rutas de Gestión de Fábricas
router.route('/factories').get(protect, isAdmin, getAllFactories).post(protect, isAdmin, createFactory);
router.route('/factories/:id').put(protect, isAdmin, updateFactory).delete(protect, isAdmin, deleteFactory);

// Rutas de 2FA
router.post('/2fa/generate', protect, isAdmin, generateTwoFactorSecret);
router.post('/2fa/verify', protect, isAdmin, verifyAndEnableTwoFactor);

// Ruta de notificaciones 
router.post('/notifications/send', protect, isAdmin, sendBroadcastNotification);

// Rutas de Monitor Blockchain
router.get('/blockchain-monitor/pending', protect, isAdmin, getPendingBlockchainTxs);
router.post('/blockchain-monitor/cancel-tx', protect, isAdmin, cancelTransaction);
router.post('/blockchain-monitor/speedup-tx', protect, isAdmin, speedUpTransaction);

module.exports = router;
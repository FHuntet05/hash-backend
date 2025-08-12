// RUTA: backend/routes/adminRoutes.js (v39.0 - CON GESTIÓN DE ADMINS)
const express = require('express');
const router = express.Router();
const { getDashboardStats, getSettings, updateSettings, getAllUsers, getUserDetails, updateUser, setUserStatus, adjustUserBalance, getAllTransactions, createManualTransaction, getPendingWithdrawals, processWithdrawal, getTreasuryWalletsList, getWalletBalance, sweepFunds, sweepGas, analyzeGasNeeds, dispatchGas, getAllFactories, createFactory, updateFactory, deleteFactory, generateTwoFactorSecret, verifyAndEnableTwoFactor, sendBroadcastNotification, getPendingBlockchainTxs, cancelTransaction, speedUpTransaction, promoteUserToAdmin, resetAdminPassword, demoteAdminToUser } = require('../controllers/adminController.js');
const { protect, isAdmin } = require('../middleware/authMiddleware');

router.get('/stats', protect, isAdmin, getDashboardStats);
router.route('/settings').get(protect, isAdmin, getSettings).put(protect, isAdmin, updateSettings);
router.get('/users', protect, isAdmin, getAllUsers);
router.get('/users/:id/details', protect, isAdmin, getUserDetails);
router.put('/users/:id', protect, isAdmin, updateUser);
router.put('/users/:id/status', protect, isAdmin, setUserStatus);
router.post('/users/:id/adjust-balance', protect, isAdmin, adjustUserBalance);
router.post('/users/promote', protect, isAdmin, promoteUserToAdmin);
router.post('/users/demote', protect, isAdmin, demoteAdminToUser);
router.post('/admins/reset-password', protect, isAdmin, resetAdminPassword);
router.get('/transactions', protect, isAdmin, getAllTransactions);
router.post('/transactions/manual', protect, isAdmin, createManualTransaction);
router.get('/withdrawals/pending', protect, isAdmin, getPendingWithdrawals);
router.put('/withdrawals/:id/process', protect, isAdmin, processWithdrawal);
router.get('/treasury/wallets-list', protect, isAdmin, getTreasuryWalletsList);
router.post('/treasury/wallet-balance', protect, isAdmin, getWalletBalance);
router.post('/sweep-funds', protect, isAdmin, sweepFunds);
router.post('/sweep-gas', protect, isAdmin, sweepGas);
router.get('/gas-dispenser/analyze', protect, isAdmin, analyzeGasNeeds);
router.post('/gas-dispenser/dispatch', protect, isAdmin, dispatchGas);
router.route('/factories').get(protect, isAdmin, getAllFactories).post(protect, isAdmin, createFactory);
router.route('/factories/:id').put(protect, isAdmin, updateFactory).delete(protect, isAdmin, deleteFactory);
router.post('/2fa/generate', protect, isAdmin, generateTwoFactorSecret);
router.post('/2fa/verify', protect, isAdmin, verifyAndEnableTwoFactor);
router.post('/notifications/send', protect, isAdmin, sendBroadcastNotification);
router.get('/blockchain-monitor/pending', protect, isAdmin, getPendingBlockchainTxs);
router.post('/blockchain-monitor/cancel-tx', protect, isAdmin, cancelTransaction);
router.post('/blockchain-monitor/speedup-tx', protect, isAdmin, speedUpTransaction);

module.exports = router;
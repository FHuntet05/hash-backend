// RUTA: backend/controllers/adminController.js (v45.7 - EXPORTS COMPLETOS Y ESTABLES)

const User = require('../models/userModel');
const Factory = require('../models/factoryModel');
const Setting = require('../models/settingsModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const mongoose = require('mongoose');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { getTemporaryPhotoUrl } = require('./userController');
const asyncHandler = require('express-async-handler');
const { sendTelegramMessage } = require('../services/notificationService');
const transactionService = require('../services/transactionService');
const gasEstimatorService = require('../services/gasEstimatorService');
const { ethers } = require('ethers');
const PendingTx = require('../models/pendingTxModel');
const qrCodeToDataURLPromise = require('util').promisify(QRCode.toDataURL);

const PLACEHOLDER_AVATAR_URL = 'https://i.postimg.cc/mD21B6r7/user-avatar-placeholder.png';
const USDT_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const USDT_ABI = ['function balanceOf(address) view returns (uint256)'];

function promiseWithTimeout(promise, ms, timeoutMessage = 'Operación excedió el tiempo de espera.') {
    const timeout = new Promise((_, reject) => {
        const id = setTimeout(() => { clearTimeout(id); reject(new Error(timeoutMessage)); }, ms);
    });
    return Promise.race([promise, timeout]);
}

async function _getBalancesForAddress(address, chain) {
    const TIMEOUT_MS = 15000;
    try {
        if (chain === 'BSC') {
            const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
            const usdtBscContract = new ethers.Contract(USDT_BSC_ADDRESS, USDT_ABI, bscProvider);
            const [usdtBalanceRaw, bnbBalanceRaw] = await Promise.all([
                promiseWithTimeout(usdtBscContract.balanceOf(address), TIMEOUT_MS),
                promiseWithTimeout(bscProvider.getBalance(address), TIMEOUT_MS)
            ]);
            const bnbFormatted = ethers.utils.formatEther(bnbBalanceRaw);
            return { usdt: parseFloat(ethers.utils.formatUnits(usdtBalanceRaw, 18)), bnb: parseFloat(bnbFormatted) };
        } else {
            throw new Error(`Cadena no soportada: ${chain}. Solo se procesa BSC.`);
        }
    } catch (error) {
        console.error(`Error al obtener saldo para ${address} en ${chain}:`, error);
        throw new Error(`Fallo al escanear ${address}. Causa: ${error.message}`);
    }
}

const getPendingWithdrawals = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const aggregationPipeline = [ { $unwind: '$transactions' }, { $match: { 'transactions.type': 'withdrawal', 'transactions.status': 'pending' } }, { $sort: { 'transactions.createdAt': -1 } }, { $group: { _id: null, total: { $sum: 1 }, items: { $push: { _id: '$transactions._id', amount: '$transactions.amount', currency: '$transactions.currency', description: '$transactions.description', status: '$transactions.status', metadata: '$transactions.metadata', createdAt: '$transactions.createdAt', user: { _id: '$_id', username: '$username', telegramId: '$telegramId', photoFileId: '$photoFileId' } } } } } ];
    const results = await User.aggregate(aggregationPipeline);
    if (!results || results.length === 0) { return res.json({ withdrawals: [], page: 1, pages: 0, total: 0 }); }
    const { total, items } = results[0];
    const paginatedItems = items.slice((page - 1) * limit, page * limit);
    const withdrawalsWithDetails = await Promise.all(paginatedItems.map(async (w) => { const photoUrl = await getTemporaryPhotoUrl(w.user.photoFileId); return { ...w, user: { ...w.user, photoUrl: photoUrl || PLACEHOLDER_AVATAR_URL } }; }));
    res.json({ withdrawals: withdrawalsWithDetails, page, pages: Math.ceil(total / limit), total });
});

const processWithdrawal = asyncHandler(async (req, res) => {
    const { status, adminNotes } = req.body;
    const { id: transactionId } = req.params;
    if (!['completed', 'rejected'].includes(status)) { res.status(400); throw new Error("El estado debe ser 'completed' o 'rejected'."); }
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const user = await User.findOne({ 'transactions._id': transactionId, 'transactions.status': 'pending' }).session(session);
        if (!user) { throw new Error('Retiro no encontrado, ya ha sido procesado, o no existe.'); }
        const withdrawal = user.transactions.id(transactionId);
        let notificationMessage = '';
        if (status === 'completed') {
            withdrawal.status = 'completed';
            withdrawal.description = `Retiro completado por el administrador.`;
            notificationMessage = `✅ <b>¡Retiro Aprobado!</b>\n\nTu solicitud de retiro por <b>${Math.abs(withdrawal.amount)} ${withdrawal.currency}</b> ha sido procesada.`;
        } else {
            user.balance.usdt += Math.abs(withdrawal.amount);
            withdrawal.status = 'rejected';
            withdrawal.description = `Retiro rechazado. Fondos devueltos al saldo.`;
            notificationMessage = `❌ <b>Retiro Rechazado</b>\n\nTu solicitud de retiro por <b>${Math.abs(withdrawal.amount)} USDT</b> ha sido rechazada.\n\n<b>Motivo:</b> ${adminNotes || 'Contacta a soporte.'}`;
        }
        withdrawal.metadata.adminNotes = adminNotes || 'N/A';
        withdrawal.metadata.processedBy = req.user.username;
        await user.save({ session });
        await session.commitTransaction();
        if (user.telegramId && notificationMessage) { await sendTelegramMessage(user.telegramId, notificationMessage); }
        res.json({ message: `Retiro marcado como '${status}' exitosamente.`, withdrawal });
    } catch (error) {
        await session.abortTransaction();
        console.error("Error en processWithdrawal:", error);
        res.status(500).json({ message: error.message || "Error del servidor al procesar el retiro." });
    } finally {
        session.endSession();
    }
});

const getUserDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); throw new Error('ID de usuario no válido.'); }
    const user = await User.findById(id).select('-password').lean();
    if (!user) { res.status(404); throw new Error('Usuario no encontrado.'); }
    const [referrals, cryptoWallets] = await Promise.all([ User.find({ referredBy: id }).select('username fullName telegramId photoFileId createdAt').lean(), CryptoWallet.find({ user: id }).lean() ]);
    const [userPhotoUrl, referralsWithPhoto] = await Promise.all([ getTemporaryPhotoUrl(user.photoFileId), Promise.all(referrals.map(async (ref) => ({ ...ref, photoUrl: await getTemporaryPhotoUrl(ref.photoFileId) || PLACEHOLDER_AVATAR_URL }))) ]);
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const allTransactions = user.transactions || [];
    const sortedTransactions = allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const paginatedTransactions = sortedTransactions.slice((page - 1) * limit, page * limit);
    const totalTransactions = sortedTransactions.length;
    res.json({ user: { ...user, photoUrl: userPhotoUrl || PLACEHOLDER_AVATAR_URL }, referrals: referralsWithPhoto, cryptoWallets, transactions: { items: paginatedTransactions, page, totalPages: Math.ceil(totalTransactions / limit), totalItems: totalTransactions } });
});

const getAllTransactions = asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const pageSize = 15;
    const typeFilter = req.query.type;
    const searchQuery = req.query.search;
    let pipeline = [];
    if (searchQuery) {
        pipeline.push({ $match: { $or: [ { username: { $regex: searchQuery, $options: 'i' } }, { telegramId: { $regex: searchQuery, $options: 'i' } } ] } });
    }
    pipeline.push({ $unwind: '$transactions' });
    if (typeFilter) {
        pipeline.push({ $match: { 'transactions.type': typeFilter } });
    }
    pipeline.push({ $sort: { 'transactions.createdAt': -1 } });
    const facetPipeline = [ ...pipeline, { $facet: { paginatedResults: [ { $skip: pageSize * (page - 1) }, { $limit: pageSize } ], totalCount: [ { $count: 'count' } ] } } ];
    const results = await User.aggregate(facetPipeline);
    const paginatedItems = results[0].paginatedResults;
    const totalTransactions = results[0].totalCount[0] ? results[0].totalCount[0].count : 0;
    const transactions = paginatedItems.map(item => ({ ...item.transactions, user: { _id: item._id, username: item.username, telegramId: item.telegramId } }));
    res.json({ transactions, page, pages: Math.ceil(totalTransactions / pageSize), totalTransactions });
});

const getDashboardStats = asyncHandler(async (req, res) => {
    const [ totalUsers, totalDepositVolume ] = await Promise.all([
        User.countDocuments(),
        User.aggregate([ { $unwind: '$transactions' }, { $match: { 'transactions.type': 'deposit' } }, { $group: { _id: null, total: { $sum: '$transactions.amount' } } } ])
    ]);
    const pendingWithdrawalsResult = await User.aggregate([ { $unwind: '$transactions' }, { $match: { 'transactions.type': 'withdrawal', 'transactions.status': 'pending' } }, { $count: 'total' } ]);
    const pendingWithdrawals = pendingWithdrawalsResult.length > 0 ? pendingWithdrawalsResult[0].total : 0;
    res.json({ totalUsers, totalDepositVolume: totalDepositVolume.length > 0 ? totalDepositVolume[0].total : 0, pendingWithdrawals });
});

const getPendingBlockchainTxs = asyncHandler(async (req, res) => { const pendingTxs = await PendingTx.find().sort({ createdAt: -1 }).limit(50); res.json(pendingTxs); });
const adjustUserBalance = asyncHandler(async (req, res) => { const { id } = req.params; const { type, currency, amount, reason } = req.body; if (!['admin_credit', 'admin_debit'].includes(type) || !['USDT'].includes(currency) || !amount || !reason) { res.status(400); throw new Error("Parámetros inválidos. Moneda debe ser USDT."); } const session = await mongoose.startSession(); try { session.startTransaction(); const user = await User.findById(id).session(session); if(!user) { throw new Error('Usuario no encontrado'); } const currencyKey = currency.toLowerCase(); if (type === 'admin_credit') { user.balance[currencyKey] = (user.balance[currencyKey] || 0) + amount; } else { if ((user.balance[currencyKey] || 0) < amount) { throw new Error('Saldo insuficiente para realizar el débito.'); } user.balance[currencyKey] -= amount; } user.transactions.push({ type, amount: type === 'admin_credit' ? amount : -amount, currency, description: reason, status: 'completed', metadata: { adminUsername: req.user.username } }); await user.save({ session }); await session.commitTransaction(); res.status(200).json({ message: 'Saldo ajustado exitosamente.', user: user.toObject() }); } catch (error) { await session.abortTransaction(); res.status(500).json({ message: error.message }); } finally { session.endSession(); } });
const getAllUsers = asyncHandler(async (req, res) => { const pageSize = 10; const page = Number(req.query.page) || 1; const filter = req.query.search ? { $or: [{ username: { $regex: req.query.search, $options: 'i' } }, { telegramId: { $regex: req.query.search, $options: 'i' } }] } : {}; const count = await User.countDocuments(filter); const users = await User.find(filter).select('username telegramId role status createdAt balance.usdt photoFileId mustPurchaseToWithdraw isBanned').sort({ createdAt: -1 }).limit(pageSize).skip(pageSize * (page - 1)).lean(); const usersWithPhotoUrl = await Promise.all(users.map(async (user) => ({ ...user, photoUrl: await getTemporaryPhotoUrl(user.photoFileId) || PLACEHOLDER_AVATAR_URL }))); res.json({ users: usersWithPhotoUrl, page, pages: Math.ceil(count / pageSize), totalUsers: count }); });
const updateUser = asyncHandler(async (req, res) => { const { username, password, balanceUsdt, mustPurchaseToWithdraw, isBanned, status, role } = req.body; const user = await User.findById(req.params.id); if (!user) { res.status(404); throw new Error('Usuario no encontrado.'); } user.username = username ?? user.username; user.balance.usdt = balanceUsdt ?? user.balance.usdt; user.status = status ?? user.status; user.role = role ?? user.role; if (mustPurchaseToWithdraw !== undefined) { user.mustPurchaseToWithdraw = mustPurchaseToWithdraw; } if (isBanned !== undefined) { user.isBanned = isBanned; user.status = isBanned ? 'banned' : 'active'; } if (password) { user.password = password; } const updatedUser = await user.save(); res.json(updatedUser); });
const setUserStatus = asyncHandler(async (req, res) => { const user = await User.findById(req.params.id); if (!user) { res.status(404); throw new Error('Usuario no encontrado.'); } if (user._id.equals(req.user._id)) { res.status(400); throw new Error('No puedes cambiar tu propio estado.'); } user.status = req.body.status; const updatedUser = await user.save(); res.json(updatedUser); });
const createManualTransaction = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad obsoleta y deshabilitada.' }); });
const getAllFactories = asyncHandler(async (req, res) => { const factories = await Factory.find({}).sort({ vipLevel: 1 }).lean(); res.json(factories); });
const createFactory = asyncHandler(async (req, res) => { const newFactory = await Factory.create(req.body); res.status(201).json(newFactory); });
const updateFactory = asyncHandler(async (req, res) => { const factory = await Factory.findByIdAndUpdate(req.params.id, req.body, { new: true }); if (!factory) return res.status(404).json({ message: 'Fábrica no encontrada.' }); res.json(factory); });
const deleteFactory = asyncHandler(async (req, res) => { const factory = await Factory.findById(req.params.id); if (!factory) return res.status(404).json({ message: 'Fábrica no encontrada.' }); await factory.deleteOne(); res.json({ message: 'Fábrica eliminada.' }); });
const getSettings = asyncHandler(async (req, res) => { const settings = await Setting.getSettings(); res.json(settings); });
const updateSettings = asyncHandler(async (req, res) => { const { maintenanceMode, withdrawalsEnabled, minWithdrawal, withdrawalFeePercent, forcePurchaseOnAllWithdrawals, commissionLevel1, commissionLevel2, commissionLevel3 } = req.body; const settingsToUpdate = { maintenanceMode, withdrawalsEnabled, minWithdrawal, withdrawalFeePercent, forcePurchaseOnAllWithdrawals, commissionLevel1, commissionLevel2, commissionLevel3 }; const updatedSettings = await Setting.findByIdAndUpdate( 'global_settings', settingsToUpdate, { new: true, upsert: true, runValidators: true } ); res.json(updatedSettings); });
const generateTwoFactorSecret = asyncHandler(async (req, res) => { const secret = speakeasy.generateSecret({ name: `MegaFabrica Admin (${req.user.username})` }); await User.findByIdAndUpdate(req.user.id, { twoFactorSecret: secret.base32 }); const data_url = await qrCodeToDataURLPromise(secret.otpauth_url); res.json({ secret: secret.base32, qrCodeUrl: data_url }); });
const verifyAndEnableTwoFactor = asyncHandler(async (req, res) => { const { token } = req.body; const user = await User.findById(req.user.id).select('+twoFactorSecret'); if (!user || !user.twoFactorSecret) return res.status(400).json({ message: 'No se ha generado un secreto 2FA.' }); const verified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token }); if (verified) { user.isTwoFactorEnabled = true; await user.save(); res.json({ message: '¡2FA habilitado!' }); } else { res.status(400).json({ message: 'Token inválido.' }); }});
const getWalletBalance = asyncHandler(async (req, res) => { const { address, chain } = req.body; if (!address || !chain) { res.status(400); throw new Error('Se requiere address y chain'); } try { const balances = await _getBalancesForAddress(address, chain); res.json({ success: true, balances }); } catch (error) { res.status(500).json({ success: false, message: error.message }); }});
const getTreasuryWalletsList = asyncHandler(async (req, res) => { const page = parseInt(req.query.page) || 1; const limit = parseInt(req.query.limit) || 15; const chain = req.query.chain || null; const search = req.query.search || ''; let query = {}; if (chain) query.chain = chain; if (search) { const userQuery = { username: { $regex: search, $options: 'i' } }; const users = await User.find(userQuery).select('_id'); const userIds = users.map(u => u._id); query.$or = [{ address: { $regex: search, $options: 'i' } }, { user: { $in: userIds } }]; } const [totalWallets, wallets] = await Promise.all([ CryptoWallet.countDocuments(query), CryptoWallet.find(query).populate('user', 'username').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean() ]); if (totalWallets === 0) { return res.json({ wallets: [], pagination: { currentPage: 1, totalPages: 0, totalWallets: 0 }, summary: { usdt: 0, bnb: 0 } }); } const walletsWithDetails = await Promise.all(wallets.map(async (wallet) => { try { const balances = await _getBalancesForAddress(wallet.address, wallet.chain); let estimatedRequiredGas = 0; if (balances.usdt > 0.000001) { try { estimatedRequiredGas = await gasEstimatorService.estimateBscSweepCost(wallet.address, balances.usdt); } catch (gasError) { console.error(`Error estimando gas para ${wallet.address}: ${gasError.message}`); estimatedRequiredGas = 0; } } return { ...wallet, usdtBalance: balances.usdt, gasBalance: balances.bnb, estimatedRequiredGas }; } catch (error) { return { ...wallet, usdtBalance: 0, gasBalance: 0, estimatedRequiredGas: 0, error: `Fallo al obtener balance: ${error.message}` }; } })); const summary = walletsWithDetails.reduce((acc, wallet) => { acc.usdt += wallet.usdtBalance || 0; acc.bnb += wallet.gasBalance || 0; return acc; }, { usdt: 0, bnb: 0 }); res.json({ wallets: walletsWithDetails, pagination: { currentPage: page, totalPages: Math.ceil(totalWallets / limit), totalWallets }, summary }); });
const sweepFunds = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const sweepGas = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const analyzeGasNeeds = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const dispatchGas = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const sendBroadcastNotification = asyncHandler(async (req, res) => { const { message, target, imageUrl, buttons } = req.body; if (!message || !target) { res.status(400); throw new Error("Mensaje y público objetivo son requeridos."); } let usersToNotify = []; if (target.type === 'all') { usersToNotify = await User.find({ status: 'active' }).select('telegramId').lean(); } else if (target.type === 'id' && target.value) { const user = await User.findOne({ telegramId: target.value }).select('telegramId').lean(); if (user) usersToNotify.push(user); } if (usersToNotify.length === 0) { return res.json({ message: "No se encontraron usuarios para notificar." }); } res.status(202).json({ message: `Enviando notificación a ${usersToNotify.length} usuarios. Este proceso puede tardar.` }); (async () => { let successCount = 0; for (const user of usersToNotify) { const result = await sendTelegramMessage(user.telegramId, message, { imageUrl, buttons }); if(result.success) successCount++; await new Promise(resolve => setTimeout(resolve, 100)); } console.log(`[Broadcast] Notificación completada. ${successCount}/${usersToNotify.length} envíos exitosos.`); })(); });
const cancelTransaction = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const speedUpTransaction = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const promoteUserToAdmin = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const resetAdminPassword = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });
const demoteAdminToUser = asyncHandler(async (req, res) => { res.status(501).json({ message: 'Funcionalidad no implementada.' }); });

module.exports = {
  getPendingWithdrawals,
  processWithdrawal,
  getAllUsers,
  updateUser,
  setUserStatus,
  getDashboardStats,
  getAllTransactions,
  createManualTransaction,
  getAllFactories,
  createFactory,
  updateFactory,
  deleteFactory,
  getUserDetails,
  getSettings,
  updateSettings,
  generateTwoFactorSecret,
  verifyAndEnableTwoFactor,
  getTreasuryWalletsList,
  getWalletBalance,
  sweepFunds,
  analyzeGasNeeds,
  dispatchGas,
  adjustUserBalance,
  sendBroadcastNotification,
  getPendingBlockchainTxs,
  cancelTransaction,
  speedUpTransaction,
  sweepGas,
  promoteUserToAdmin,
  resetAdminPassword,
  demoteAdminToUser
};
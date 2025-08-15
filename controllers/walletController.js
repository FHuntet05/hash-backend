// RUTA: backend/controllers/walletController.js (v4.3 - INTEGRADO CON SERVICIO DE COMISIONES)

const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const Factory = require('../models/factoryModel');
const Transaction = require('../models/transactionModel');
const Settings = require('../models/settingsModel');
const mongoose = require('mongoose');
const { processMultiLevelCommissions } = require('../services/referralService'); // <-- IMPORTAMOS EL NUEVO SERVICIO

/**
 * @desc    El usuario compra una fábrica.
 * @route   POST /api/wallet/purchase-factory
 * @access  Private
 */
const purchaseFactory = asyncHandler(async (req, res) => {
    const { factoryId } = req.body;
    const userId = req.user.id;
    
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const factory = await Factory.findById(factoryId).session(session);
        if (!factory) {
            throw new Error('Fábrica no encontrada.');
        }

        const user = await User.findById(userId)
            .populate('purchasedFactories.factory')
            .session(session);

        if (!user) {
            throw new Error('Usuario no encontrado.');
        }
        
        if (user.balance.usdt < factory.price) {
            res.status(400);
            throw new Error('Saldo insuficiente para comprar esta fábrica.');
        }

        // --- INICIO DE LÓGICA DE DISPARO DE COMISIÓN ---
        // 1. Verificamos si esta compra debe generar comisiones.
        const shouldTriggerCommission = !factory.isFree && !user.hasTriggeredReferralCommission;

        if (shouldTriggerCommission) {
            // Llamamos al servicio especializado para que maneje el pago.
            // Le pasamos el comprador y la sesión de la transacción.
            await processMultiLevelCommissions(user, session);

            // 2. Marcamos al usuario para que no vuelva a generar comisiones.
            user.hasTriggeredReferralCommission = true;
        }
        // --- FIN DE LÓGICA DE DISPARO DE COMISIÓN ---

        // Procedemos con la lógica de compra normal
        const purchaseDate = new Date();
        const expiryDate = new Date(purchaseDate);
        expiryDate.setDate(expiryDate.getDate() + factory.durationDays);

        user.balance.usdt -= factory.price;
        user.purchasedFactories.push({
            factory: factory._id,
            purchaseDate,
            expiryDate,
            lastClaim: purchaseDate
        });
        user.transactions.push({
            type: 'purchase',
            amount: factory.price,
            currency: 'USDT',
            description: `Compra de fábrica: ${factory.name}`,
            status: 'completed'
        });
        
        const updatedUser = await user.save({ session });

        await session.commitTransaction();

        res.status(201).json({
            message: '¡Fábrica comprada con éxito!',
            user: updatedUser
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('[Purchase Factory Error]', error);
        const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
        res.status(statusCode).json({ message: error.message });
    } finally {
        session.endSession();
    }
});


/**
 * @desc    El usuario reclama la producción de una fábrica.
 * @route   POST /api/wallet/claim-production
 * @access  Private
 */
const claimProduction = asyncHandler(async (req, res) => {
    const { purchasedFactoryId } = req.body;
    const userId = req.user.id;
    const user = await User.findById(userId).populate('purchasedFactories.factory');
    if (!user) { res.status(404); throw new Error('Usuario no encontrado.'); }
    const purchasedFactory = user.purchasedFactories.id(purchasedFactoryId);
    if (!purchasedFactory) { res.status(404); throw new Error('Fábrica comprada no encontrada en tu perfil.'); }
    const now = new Date();
    const lastClaim = new Date(purchasedFactory.lastClaim);
    const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
    if (hoursSinceLastClaim < 24) { res.status(400); throw new Error('Aún no puedes reclamar la producción de esta fábrica.'); }
    const dailyProduction = purchasedFactory.factory.dailyProduction;
    user.balance.usdt += dailyProduction;
    purchasedFactory.lastClaim = now;
    await user.save();
    res.json({ message: `+${dailyProduction.toFixed(2)} USDT reclamados.`, user });
});


/**
 * @desc    El usuario solicita un retiro de fondos.
 * @route   POST /api/wallet/request-withdrawal
 * @access  Private
 */
const requestWithdrawal = asyncHandler(async (req, res) => {
    const { amount, withdrawalAddress, withdrawalPassword } = req.body;
    const userId = req.user.id;
    const settings = await Settings.getSettings();
    const user = await User.findById(userId).select('+withdrawalPassword +isWithdrawalPasswordSet').populate('purchasedFactories.factory');
    if (!settings.withdrawalsEnabled) { res.status(403); throw new Error('Los retiros están deshabilitados temporalmente por mantenimiento.'); }
    if (!user.isWithdrawalPasswordSet) { res.status(400); throw new Error('Debe configurar su contraseña de retiro antes de poder solicitar uno.'); }
    if (!withdrawalPassword) { res.status(400); throw new Error('Debe proporcionar su contraseña de retiro.'); }
    const isPasswordMatch = await user.matchWithdrawalPassword(withdrawalPassword);
    if (!isPasswordMatch) { res.status(401); throw new Error('La contraseña de retiro es incorrecta.'); }
    const withdrawalAmount = parseFloat(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) { res.status(400); throw new Error('El monto del retiro no es válido.'); }
    if (withdrawalAmount < settings.minWithdrawal) { res.status(400); throw new Error(`El monto mínimo para retirar es de ${settings.minWithdrawal} USDT.`); }
    if (withdrawalAmount > user.balance.usdt) { res.status(400); throw new Error('Saldo insuficiente para realizar este retiro.'); }
    const hasPurchasedNonFreeFactory = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
    if (settings.forcePurchaseOnAllWithdrawals && !hasPurchasedNonFreeFactory) { res.status(403); throw new Error('Debe comprar al menos una fábrica para poder activar los retiros.'); }
    if (user.mustPurchaseToWithdraw && !hasPurchasedNonFreeFactory) { res.status(403); throw new Error('Su cuenta requiere la compra de una fábrica para poder realizar retiros. Contacte a soporte si cree que es un error.'); }
    const feeAmount = withdrawalAmount * (settings.withdrawalFeePercent / 100);
    const amountToReceive = withdrawalAmount - feeAmount;
    user.transactions.push({ type: 'withdrawal', amount: -withdrawalAmount, currency: 'USDT', status: 'pending', description: `Solicitud de retiro a: ${withdrawalAddress}`, metadata: { address: withdrawalAddress, fee: feeAmount, finalAmount: amountToReceive } });
    user.balance.usdt -= withdrawalAmount;
    await user.save();
    res.status(201).json({ message: 'Su solicitud de retiro ha sido enviada y está pendiente de aprobación.', newBalance: user.balance.usdt });
});


/**
 * @desc    Crea o recupera la dirección de depósito de un usuario.
 * @route   GET /api/wallet/create-deposit-address
 * @access  Private
 */
const createDepositAddress = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('telegramId');
    if (!user) { res.status(404); throw new Error('Usuario no encontrado'); }
    const depositAddress = `0x...placeholderAddressForUser...${user.telegramId}`;
    res.json({ address: depositAddress });
});


/**
 * @desc    Obtiene el historial de transacciones del usuario.
 * @route   GET /api/wallet/history
 * @access  Private
 */
const getHistory = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('transactions');
    if (!user) { res.status(404); throw new Error('Usuario no encontrado'); }
    const sortedTransactions = user.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(sortedTransactions);
});


module.exports = {
    purchaseFactory,
    claimProduction,
    requestWithdrawal,
    createDepositAddress,
    getHistory
};
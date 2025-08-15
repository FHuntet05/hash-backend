// RUTA: backend/controllers/walletController.js (v3.2 - UNIFICADO, ESTABLE Y CORREGIDO)

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Factory = require('../models/factoryModel');
const Setting = require('../models/settingsModel');
const { ethers } = require('ethers');
const { processMultiLevelCommissions } = require('../services/referralService');
const { getOrCreateUserBscWallet } = require('./paymentController');

const FACTORY_CYCLE_DURATION_MS = 24 * 60 * 60 * 1000;

const createDepositAddress = async (req, res) => {
    const userId = req.user.id;
    try {
        const userUniqueWalletAddress = await getOrCreateUserBscWallet(userId);
        res.status(200).json({
            paymentAddress: userUniqueWalletAddress,
            currency: 'USDT',
            network: 'BEP20 (BSC)'
        });
    } catch (error) {
        console.error('Error en createDepositAddress:', error);
        res.status(500).json({ message: 'Error al generar la dirección de depósito.' });
    }
};

const purchaseFactoryWithBalance = async (req, res) => {
    const { factoryId, quantity = 1 } = req.body;
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const factory = await Factory.findById(factoryId).session(session).lean();
        if (!factory) {
            throw new Error('La fábrica seleccionada no existe.');
        }

        const user = await User.findById(userId).session(session);
        if (!user) {
            throw new Error('Usuario no encontrado.');
        }

        const totalCost = factory.price * quantity;
        if (user.balance.usdt < totalCost) {
            return res.status(400).json({ message: 'Saldo USDT insuficiente.' });
        }
        
        const shouldTriggerCommission = !factory.isFree && !user.hasTriggeredReferralCommission;
        if (shouldTriggerCommission) {
            await processMultiLevelCommissions(user, session);
            user.hasTriggeredReferralCommission = true;
        }

        user.balance.usdt -= totalCost;
        
        if (user.mustPurchaseToWithdraw) {
            user.mustPurchaseToWithdraw = false;
        }

        const now = new Date();
        for (let i = 0; i < quantity; i++) {
            user.purchasedFactories.push({ 
                factory: factory._id, 
                purchaseDate: now, 
                expiryDate: new Date(now.getTime() + factory.durationDays * 24 * 60 * 60 * 1000),
                lastClaim: now
            });
        }
        
        user.transactions.push({
            type: 'purchase',
            amount: totalCost,
            currency: 'USDT',
            description: `Compra de ${quantity}x ${factory.name}`,
            status: 'completed',
            metadata: { factoryId }
        });

        await user.save({ session });
        await session.commitTransaction();

        const updatedUser = await User.findById(userId).populate('purchasedFactories.factory');
        res.status(200).json({ message: `¡Compra de ${quantity}x ${factory.name} exitosa!`, user: updatedUser.toObject() });
    } catch (error) {
        await session.abortTransaction();
        console.error('Error en purchaseFactoryWithBalance:', error);
        res.status(500).json({ message: error.message || 'Error al procesar la compra.' });
    } finally {
        session.endSession();
    }
};

const claimFactoryProduction = async (req, res) => {
    const { purchasedFactoryId } = req.body;
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const user = await User.findById(userId).populate('purchasedFactories.factory').session(session);
        if (!user) {
            throw new Error('Usuario no encontrado.');
        }

        const factoryInstance = user.purchasedFactories.id(purchasedFactoryId);
        if (!factoryInstance) {
            throw new Error('Fábrica no encontrada.');
        }

        const now = new Date();
        if (now.getTime() - new Date(factoryInstance.lastClaim).getTime() < FACTORY_CYCLE_DURATION_MS) {
            return res.status(400).json({ message: 'El ciclo de producción de 24 horas aún no ha terminado.' });
        }

        const production = factoryInstance.factory.dailyProduction;
        user.balance.usdt += production;
        factoryInstance.lastClaim = now;
        
        user.transactions.push({
            type: 'production_claim',
            amount: production,
            currency: 'USDT',
            description: `Reclamo de producción de ${factoryInstance.factory.name}`,
            status: 'completed',
            metadata: { purchasedFactoryId }
        });
        
        await user.save({ session });
        await session.commitTransaction();
        
        res.json({ message: `¡Has reclamado ${production.toFixed(2)} USDT!`, user: user.toObject() });
    } catch (error) {
        await session.abortTransaction();
        console.error("Error al reclamar la producción:", error);
        res.status(500).json({ message: error.message || "Error del servidor al procesar el reclamo." });
    } finally {
        session.endSession();
    }
};

const requestWithdrawal = async (req, res) => {
  const { amount, walletAddress, withdrawalPassword } = req.body;
  const userId = req.user.id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const settings = await Setting.findOne({ singleton: 'global_settings' }).session(session);
    if (!settings) {
        throw new Error('La configuración del sistema no está disponible.');
    }
    
    const user = await User.findById(userId).select('+withdrawalPassword +isWithdrawalPasswordSet').populate('purchasedFactories.factory').session(session);
    if (!user) {
        throw new Error('Usuario no encontrado.');
    }

    if (!settings.withdrawalsEnabled) {
      return res.status(403).json({ message: 'Los retiros están deshabilitados temporalmente por mantenimiento.' });
    }

    const hasPurchasedNonFreeFactory = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
    if (settings.forcePurchaseOnAllWithdrawals && !hasPurchasedNonFreeFactory) {
      return res.status(403).json({ message: 'Debes comprar al menos una fábrica para poder activar los retiros.' });
    }

    if (user.mustPurchaseToWithdraw && !hasPurchasedNonFreeFactory) {
      return res.status(403).json({ message: 'Debes comprar otra fábrica para poder retirar.' });
    }

    if (!user.isWithdrawalPasswordSet) {
        return res.status(403).json({ message: 'Debes configurar una contraseña de retiro primero.' });
    }
    if (!withdrawalPassword) {
        return res.status(400).json({ message: 'La contraseña de retiro es obligatoria.' });
    }
    const isMatch = await user.matchWithdrawalPassword(withdrawalPassword);
    if (!isMatch) {
        return res.status(401).json({ message: 'La contraseña de retiro es incorrecta.' });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ message: 'El monto del retiro no es válido.' });
    }
    if (numericAmount < settings.minimumWithdrawal) {
        return res.status(400).json({ message: `El retiro mínimo es ${settings.minimumWithdrawal} USDT.` });
    }
    if (!ethers.utils.isAddress(walletAddress)) {
        return res.status(400).json({ message: 'La dirección de billetera no es válida.' });
    }
    if (user.balance.usdt < numericAmount) {
        return res.status(400).json({ message: 'Saldo insuficiente.' });
    }

    user.balance.usdt -= numericAmount;
    
    const feeAmount = numericAmount * (settings.withdrawalFeePercent / 100);
    const netAmount = numericAmount - feeAmount;

    user.transactions.push({
        type: 'withdrawal',
        status: 'pending',
        amount: -numericAmount,
        currency: 'USDT',
        description: `Solicitud de retiro a ${walletAddress}`,
        metadata: { walletAddress, feeAmount, netAmount }
    });

    await user.save({ session });
    await session.commitTransaction();

    const updatedUser = await User.findById(userId).populate('purchasedFactories.factory');
    res.status(201).json({ message: 'Tu solicitud de retiro ha sido enviada con éxito.', user: updatedUser.toObject() });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error en requestWithdrawal:', error);
    res.status(500).json({ message: error.message || 'Error interno al procesar la solicitud.' });
  } finally {
    session.endSession();
  }
};

const getHistory = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('transactions');
    if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    const sortedTransactions = user.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(sortedTransactions);
  } catch (error) {
    console.error('Error en getHistory:', error);
    res.status(500).json({ message: 'Error al obtener el historial.' });
  }
};

module.exports = {
  createDepositAddress,
  purchaseFactoryWithBalance,
  claimFactoryProduction,
  requestWithdrawal,
  getHistory,
};
// RUTA: backend/controllers/walletController.js (VERSIÓN MEGA FÁBRICA FINAL CON RECLAMO INDIVIDUAL)

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Factory = require('../models/factoryModel');
const Transaction = require('../models/transactionModel');
const Setting = require('../models/settingsModel');
const { createTransaction } = require('../utils/transactionLogger');
const { distributeReferralCommissions } = require('../services/commissionService');
const { ethers } = require('ethers');

// CONSTANTE CLAVE: Duración del ciclo de producción de la fábrica.
const FACTORY_CYCLE_DURATION_MS = 24 * 60 * 60 * 1000;

const purchaseFactoryWithBalance = async (req, res) => {
  const { factoryId, quantity } = req.body;
  const userId = req.user.id;

  if (!factoryId || !quantity || quantity <= 0) {
    return res.status(400).json({ message: 'Datos de compra inválidos.' });
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const factory = await Factory.findById(factoryId).lean();
    if (!factory) {
      throw new Error('La fábrica seleccionada no existe.');
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new Error('Usuario no encontrado.');
    }

    const totalCost = factory.price * quantity;
    if (user.balance.usdt < totalCost) {
      return res.status(400).json({ message: 'Saldo USDT insuficiente para realizar la compra.' });
    }

    const isFirstPurchase = user.purchasedFactories.length === 0 && user.totalSpending === 0;

    const now = new Date();
    user.balance.usdt -= totalCost;
    user.totalSpending += totalCost;

    for (let i = 0; i < quantity; i++) {
        const expiryDate = new Date(now.getTime() + factory.durationDays * 24 * 60 * 60 * 1000);
        user.purchasedFactories.push({ 
            factory: factory._id, 
            purchaseDate: now, 
            expiryDate: expiryDate,
            lastClaim: now
        });
    }

    await user.save({ session });

    await createTransaction(
        userId, 
        'purchase', 
        totalCost, 
        'USDT', 
        `Compra de ${quantity}x ${factory.name}`,
        { factoryId: factory._id.toString(), quantity },
        session
    );

    if (isFirstPurchase) {
      distributeReferralCommissions(user, totalCost, session).catch(err => {
        console.error(`[CommissionService] Error en la ejecución asíncrona post-compra para ${userId}:`, err);
      });
    }

    await session.commitTransaction();

    const finalUpdatedUser = await User.findById(userId).populate('purchasedFactories.factory');
    res.status(200).json({ 
        message: `¡Compra de ${quantity}x ${factory.name} exitosa!`, 
        user: finalUpdatedUser.toObject() 
    });

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

    if (!purchasedFactoryId) {
        return res.status(400).json({ message: 'Se requiere el ID de la fábrica comprada.' });
    }
    
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const user = await User.findById(userId).populate('purchasedFactories.factory').session(session);
        if (!user) throw new Error('Usuario no encontrado.');

        const factoryInstance = user.purchasedFactories.id(purchasedFactoryId);
        if (!factoryInstance) {
            throw new Error('La fábrica especificada no pertenece a este usuario o no existe.');
        }

        const now = new Date();
        const lastClaim = new Date(factoryInstance.lastClaim);
        const timePassedMs = now.getTime() - lastClaim.getTime();

        if (timePassedMs < FACTORY_CYCLE_DURATION_MS) {
            return res.status(400).json({ message: 'El ciclo de producción de 24 horas aún no ha terminado.' });
        }

        const dailyProduction = factoryInstance.factory.dailyProduction;
        
        user.balance.usdt += dailyProduction;
        user.totalProductionClaimed += dailyProduction;
        factoryInstance.lastClaim = now;

        await user.save({ session });
        
        await createTransaction(
            userId, 
            'production_claim', 
            dailyProduction, 
            'USDT', 
            `Reclamo de producción de ${factoryInstance.factory.name}`,
            { purchasedFactoryId },
            session
        );

        await session.commitTransaction();
        
        // Devolvemos el usuario actualizado para que el frontend pueda refrescar el estado.
        res.json({
            message: `¡Has reclamado ${dailyProduction.toFixed(2)} USDT de tu ${factoryInstance.factory.name}!`,
            user: user.toObject(),
        });

    } catch (error) {
        await session.abortTransaction();
        console.error("Error al reclamar la producción de la fábrica:", error);
        res.status(500).json({ message: error.message || "Error del servidor al procesar el reclamo." });
    } finally {
        session.endSession();
    }
};

const requestWithdrawal = async (req, res) => {
  const { amount, walletAddress } = req.body;
  const userId = req.user.id;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const settings = await Setting.findOne({ singleton: 'global_settings' }).session(session);
    if (!settings) throw new Error('La configuración del sistema no está disponible.');
    
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount < settings.minimumWithdrawal) {
      return res.status(400).json({ message: `El retiro mínimo es ${settings.minimumWithdrawal} USDT.` });
    }
    if (!walletAddress || !ethers.utils.isAddress(walletAddress)) {
      return res.status(400).json({ message: 'La dirección de billetera BEP20 no es válida.' });
    }
    
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('Usuario no encontrado.');
    if (user.balance.usdt < numericAmount) {
      return res.status(400).json({ message: 'Saldo USDT insuficiente.' });
    }

    user.balance.usdt -= numericAmount;
    await user.save({ session });
    
    const feeAmount = numericAmount * (settings.withdrawalFeePercent / 100);
    const netAmount = numericAmount - feeAmount;

    await Transaction.create([{
      user: userId,
      type: 'withdrawal',
      status: 'pending',
      amount: numericAmount,
      currency: 'USDT',
      description: `Solicitud de retiro a ${walletAddress}`,
      metadata: { 
        walletAddress, 
        network: 'USDT-BEP20', 
        feePercent: settings.withdrawalFeePercent.toString(), 
        feeAmount: feeAmount.toFixed(4), 
        netAmount: netAmount.toFixed(4) 
      }
    }], { session });

    await session.commitTransaction();

    const updatedUser = await User.findById(userId).populate('purchasedFactories.factory');
    res.status(201).json({ 
      message: 'Tu solicitud de retiro ha sido enviada con éxito y está pendiente de revisión.', 
      user: updatedUser.toObject()
    });
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
    const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(100);
    res.json(transactions);
  } catch (error) {
    console.error('Error en getHistory:', error);
    res.status(500).json({ message: 'Error al obtener el historial.' });
  }
};

module.exports = {
  purchaseFactoryWithBalance,
  claimFactoryProduction,
  requestWithdrawal,
  getHistory,
};
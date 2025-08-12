// backend/controllers/walletController.js (VERSIÓN MEGA FÁBRICA v2.0 - LÓGICA DE COMISIÓN CORREGIDA)

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Factory = require('../models/factoryModel');
const Transaction = require('../models/transactionModel');
const Setting = require('../models/settingsModel');
const { createTransaction } = require('../utils/transactionLogger');
const { distributeReferralCommissions } = require('../services/commissionService');
const { ethers } = require('ethers'); // Importado para validación de wallet

/**
 * @desc    Compra una o más fábricas utilizando el saldo USDT del usuario.
 * @route   POST /api/wallet/purchase-factory
 * @access  Private
 */
const purchaseFactoryWithBalance = async (req, res) => {
  const { factoryId, quantity } = req.body;
  const userId = req.user.id;

  if (!factoryId || !quantity || quantity <= 0) {
    return res.status(400).json({ message: 'Datos de compra inválidos.' });
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const factory = await Factory.findById(factoryId).lean(); // lean() para mejor rendimiento
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

    // LÓGICA DE COMISIÓN: Determinar si es la primera compra del usuario.
    const isFirstPurchase = user.purchasedFactories.length === 0 && user.totalSpending === 0;

    const now = new Date();
    user.balance.usdt -= totalCost;
    user.totalSpending += totalCost;

    // Lógica para añadir las nuevas fábricas al usuario
    for (let i = 0; i < quantity; i++) {
        const expiryDate = new Date(now.getTime() + factory.durationDays * 24 * 60 * 60 * 1000);
        user.purchasedFactories.push({ 
            factory: factory._id, 
            purchaseDate: now, 
            expiryDate: expiryDate,
            lastProductionTimestamp: now
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

    // LÓGICA DE COMISIÓN: Llamar al servicio solo si es la primera compra.
    if (isFirstPurchase) {
      // No necesitamos esperar a que las comisiones terminen para responder al usuario.
      // Lo ejecutamos en segundo plano.
      distributeReferralCommissions(user, totalCost, session).catch(err => {
        console.error(`[CommissionService] Error en la ejecución asíncrona post-compra para ${userId}:`, err);
      });
    }

    await session.commitTransaction();

    // Enviamos el usuario actualizado con las nuevas fábricas.
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


/**
 * @desc    Reclama la producción acumulada de todas las fábricas.
 * @route   POST /api/wallet/claim-all-production
 * @access  Private
 */
const claimAllProduction = async (req, res) => {
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const user = await User.findById(userId).populate('purchasedFactories.factory').session(session);
        if (!user) throw new Error('Usuario no encontrado.');

        const now = new Date();
        let totalProductionToClaim = 0;

        // Iteramos sobre las fábricas del usuario para calcular y resetear la producción.
        user.purchasedFactories.forEach(pf => {
            if (now > pf.expiryDate) return; // Si la fábrica ha expirado, no produce.

            const secondsSinceLastUpdate = (now.getTime() - new Date(pf.lastProductionTimestamp).getTime()) / 1000;
            const dailyProduction = pf.factory.dailyProduction || 0;
            const productionPerSecond = dailyProduction / 86400; // 24 * 60 * 60
            
            const producedAmount = secondsSinceLastUpdate * productionPerSecond;
            
            // Se actualiza el balance de producción del usuario y se resetea el timestamp de la fábrica.
            user.productionBalance.usdt += producedAmount;
            pf.lastProductionTimestamp = now;
        });
        
        totalProductionToClaim = user.productionBalance.usdt;

        if (totalProductionToClaim < 0.0001) { // Umbral mínimo para evitar reclamos de polvo
            return res.status(400).json({ message: 'No hay producción suficiente para reclamar.' });
        }
        
        // Mover la producción al balance principal y resetear el balance de producción.
        user.balance.usdt += totalProductionToClaim;
        user.totalProductionClaimed += totalProductionToClaim;
        user.productionBalance.usdt = 0;

        await user.save({ session });
        
        await createTransaction(
            userId, 
            'production_claim', 
            totalProductionToClaim, 
            'USDT', 
            `Reclamo de producción de todas las fábricas`,
            {},
            session
        );

        await session.commitTransaction();
        
        res.json({
            message: `¡Has reclamado ${totalProductionToClaim.toFixed(4)} USDT de tus fábricas!`,
            user: user.toObject(),
        });

    } catch (error) {
        await session.abortTransaction();
        console.error("Error al reclamar la producción:", error);
        res.status(500).json({ message: error.message || "Error del servidor al procesar el reclamo." });
    } finally {
        session.endSession();
    }
};

/**
 * @desc    Inicia una solicitud de retiro de saldo USDT.
 * @route   POST /api/wallet/request-withdrawal
 * @access  Private
 */
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

/**
 * @desc    Obtiene el historial de transacciones del usuario.
 * @route   GET /api/wallet/history
 * @access  Private
 */
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
  claimAllProduction,
  requestWithdrawal,
  getHistory,
};
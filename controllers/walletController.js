// RUTA: backend/controllers/walletController.js (v4.2 - LÓGICA DE COMISIONES OBSOLETA ELIMINADA)

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Miner = require('../models/minerModel');
const Setting = require('../models/settingsModel');
const { ethers } = require('ethers');
// CAMBIO CRÍTICO: Se elimina la importación de la función de comisión obsoleta.
// const { processMultiLevelCommissions } = require('../services/referralService');
const { getOrCreateUserBscWallet } = require('./paymentController');

const MINER_CYCLE_DURATION_MS = 24 * 60 * 60 * 1000;

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

const purchaseFactoryWithBalance = asyncHandler(async (req, res) => {
  const { factoryId, quantity } = req.body; // factoryId es el ID del Potenciador
  const qty = parseInt(quantity) || 1;

  const user = await User.findById(req.user.id);
  const miner = await Miner.findById(factoryId); // Buscamos el potenciador

  if (!miner) { res.status(404); throw new Error('Potenciador no encontrado'); }

  const totalCost = miner.price * qty;
  if (user.balance.usdt < totalCost) {
    res.status(400); throw new Error('Saldo insuficiente');
  }

  // 1. Deducir Saldo
  user.balance.usdt -= totalCost;

  // 2. Calcular Fechas
  const now = new Date();
  const expiryDate = new Date(now);
  expiryDate.setDate(expiryDate.getDate() + miner.durationDays);

  // 3. Añadir items al inventario del usuario
  for (let i = 0; i < qty; i++) {
    user.purchasedMiners.push({
      miner: miner._id,
      purchaseDate: now,
      expiryDate: expiryDate,
      lastClaim: now // Importante para el ciclo de 12h
    });
  }

  // 4. Registrar Transacción
  user.transactions.push({
    type: 'purchase',
    amount: totalCost,
    currency: 'USDT',
    description: `Compra: ${qty}x ${miner.name}`,
    status: 'completed'
  });

  // 5. Guardar
  await user.save();

  // 6. Devolver usuario actualizado (para que el Frontend recalcule la potencia)
  // Populate necesario para que PowerDashboard lea 'dailyProduction'
  const updatedUser = await User.findById(user._id).populate('purchasedMiners.miner');
  
  res.json({
    message: '¡Potencia Aumentada Exitosamente!',
    user: updatedUser
  });
});

const claimFactoryProduction = async (req, res) => {
    const { purchasedFactoryId } = req.body;
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const user = await User.findById(userId).populate('purchasedMiners.miner').session(session);
        if (!user) { throw new Error('Usuario no encontrado.'); }
        
        const minerInstance = user.purchasedMiners.id(purchasedFactoryId);
        if (!minerInstance) { throw new Error('Instancia de minero no encontrada.'); }
        
        const now = new Date();
        if (now.getTime() - new Date(minerInstance.lastClaim).getTime() < MINER_CYCLE_DURATION_MS) {
            return res.status(400).json({ message: 'El ciclo de producción de 24 horas aún no ha terminado.' });
        }
        
        const production = minerInstance.miner.dailyProduction;
        user.balance.usdt += production;
        minerInstance.lastClaim = now;
        
        user.transactions.push({
            type: 'production_claim',
            amount: production,
            currency: 'USDT',
            description: `Reclamo de producción de ${minerInstance.miner.name}`,
            status: 'completed',
            metadata: { purchasedMinerId: purchasedFactoryId }
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
  const { amount, withdrawalPassword } = req.body;
  const userId = req.user.id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const settings = await Setting.findOne({ _id: 'global_settings' }).session(session);
    if (!settings) {
        throw new Error('La configuración del sistema no está disponible.');
    }
    const user = await User.findById(userId)
        .select('+withdrawalPassword +isWithdrawalPasswordSet +withdrawalAddress')
        .populate('purchasedMiners.miner')
        .session(session);
    if (!user) { throw new Error('Usuario no encontrado.'); }
    
    if (!user.withdrawalAddress || !user.withdrawalAddress.isSet || !user.withdrawalAddress.address) {
        res.status(400);
        throw new Error('Debe configurar su billetera de retiro antes de poder solicitar un pago.');
    }
    const destinationAddress = user.withdrawalAddress.address;
    
    const hasPurchasedNonFreeMiner = user.purchasedMiners.some(pm => pm.miner && !pm.miner.isFree);
    const unifiedErrorMessage = 'Debes comprar un minero para poder activar o reactivar los retiros.';
    if (settings.forcePurchaseOnAllWithdrawals && !hasPurchasedNonFreeMiner) {
      return res.status(403).json({ message: unifiedErrorMessage });
    }
    if (user.mustPurchaseToWithdraw && !hasPurchasedNonFreeMiner) {
      return res.status(403).json({ message: unifiedErrorMessage });
    }
    if (!settings.withdrawalsEnabled) {
      return res.status(403).json({ message: 'Los retiros están deshabilitados temporalmente por mantenimiento.' });
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
    if (numericAmount < settings.minWithdrawal) {
        return res.status(400).json({ message: `El retiro mínimo es ${settings.minWithdrawal} USDT.` });
    }
    if (user.balance.usdt < numericAmount) {
        return res.status(400).json({ message: 'Saldo insuficiente.' });
    }

    user.balance.usdt -= numericAmount;
    user.totalWithdrawal = (user.totalWithdrawal || 0) + numericAmount;

    const feeAmount = numericAmount * (settings.withdrawalFeePercent / 100);
    const netAmount = numericAmount - feeAmount;

    user.transactions.push({
        type: 'withdrawal',
        status: 'pending',
        amount: -numericAmount,
        currency: 'USDT',
        description: `Solicitud de retiro a ${destinationAddress}`,
        metadata: { walletAddress: destinationAddress, feeAmount, netAmount }
    });
    
    await user.save({ session });
    await session.commitTransaction();
    const updatedUser = await User.findById(userId).populate('purchasedMiners.miner');
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
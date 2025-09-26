// RUTA: backend/controllers/walletController.js (v4.0 - SEMÁNTICA "MINER" INTEGRADA)

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Miner = require('../models/minerModel'); // CAMBIO CRÍTICO: Referencia actualizada de 'Factory' a 'Miner'.
const Setting = require('../models/settingsModel');
const { ethers } = require('ethers');
const { processMultiLevelCommissions } = require('../services/referralService'); // Asumiendo que este servicio existe o existirá.
const { getOrCreateUserBscWallet } = require('./paymentController');

// Se actualiza el nombre de la constante para mayor claridad.
const MINER_CYCLE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Crea o recupera una dirección de depósito única para el usuario.
 */
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

/**
 * Procesa la compra de un minero utilizando el saldo del usuario.
 * NOTA: Esta función se renombrará semánticamente a "purchaseMinerWithBalance" cuando se refactoricen las rutas.
 */
const purchaseFactoryWithBalance = async (req, res) => {
    const { factoryId, quantity = 1 } = req.body; // El frontend aún podría enviar 'factoryId', lo manejamos.
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const miner = await Miner.findById(factoryId).session(session).lean(); // CAMBIO: Usa el modelo 'Miner'.
        if (!miner) {
            throw new Error('El minero seleccionado no existe.');
        }

        const user = await User.findById(userId).session(session);
        if (!user) {
            throw new Error('Usuario no encontrado.');
        }

        const totalCost = miner.price * quantity;
        if (user.balance.usdt < totalCost) {
            return res.status(400).json({ message: 'Saldo USDT insuficiente.' });
        }
        
        const shouldTriggerCommission = !miner.isFree && !user.hasTriggeredReferralCommission;
        if (shouldTriggerCommission) {
            // Lógica de comisiones se mantiene, podría necesitar revisión para comisiones porcentuales.
            await processMultiLevelCommissions(user, session); 
            user.hasTriggeredReferralCommission = true;
        }

        user.balance.usdt -= totalCost;
        
        if (user.mustPurchaseToWithdraw) {
            user.mustPurchaseToWithdraw = false;
        }

        const now = new Date();
        for (let i = 0; i < quantity; i++) {
            user.purchasedMiners.push({ // CAMBIO CRÍTICO: Usa el array 'purchasedMiners'.
                miner: miner._id, // CAMBIO CRÍTICO: Usa el campo 'miner'.
                purchaseDate: now, 
                expiryDate: new Date(now.getTime() + miner.durationDays * 24 * 60 * 60 * 1000),
                lastClaim: now
            });
        }
        
        user.transactions.push({
            type: 'purchase',
            amount: -totalCost, // El monto de la compra es negativo para el saldo.
            currency: 'USDT',
            description: `Compra de ${quantity}x Minero ${miner.name}`, // CAMBIO: Mensaje actualizado.
            status: 'completed',
            metadata: { minerId: miner._id } // CAMBIO: Metadata actualizada.
        });

        await user.save({ session });
        await session.commitTransaction();

        // Se devuelve el usuario actualizado con los nuevos mineros.
        const updatedUser = await User.findById(userId).populate('purchasedMiners.miner');
        res.status(200).json({ message: `¡Compra de ${quantity}x ${miner.name} exitosa!`, user: updatedUser.toObject() });
    } catch (error) {
        await session.abortTransaction();
        console.error('Error en la compra de minero:', error);
        res.status(500).json({ message: error.message || 'Error al procesar la compra.' });
    } finally {
        session.endSession();
    }
};

/**
 * Reclama la producción de un minero específico.
 * NOTA: Renombrar a "claimMinerProduction" cuando se refactoricen las rutas.
 */
const claimFactoryProduction = async (req, res) => {
    const { purchasedFactoryId } = req.body; // El frontend aún envía 'purchasedFactoryId'.
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const user = await User.findById(userId).populate('purchasedMiners.miner').session(session); // CAMBIO: Populate actualizado.
        if (!user) {
            throw new Error('Usuario no encontrado.');
        }

        const minerInstance = user.purchasedMiners.id(purchasedFactoryId); // CAMBIO: Busca en 'purchasedMiners'.
        if (!minerInstance) {
            throw new Error('Instancia de minero no encontrada.');
        }

        const now = new Date();
        if (now.getTime() - new Date(minerInstance.lastClaim).getTime() < MINER_CYCLE_DURATION_MS) {
            return res.status(400).json({ message: 'El ciclo de producción de 24 horas aún no ha terminado.' });
        }

        const production = minerInstance.miner.dailyProduction; // CAMBIO: Accede a través de 'miner'.
        user.balance.usdt += production;
        minerInstance.lastClaim = now;
        
        user.transactions.push({
            type: 'production_claim',
            amount: production,
            currency: 'USDT',
            description: `Reclamo de producción de ${minerInstance.miner.name}`, // CAMBIO: Mensaje actualizado.
            status: 'completed',
            metadata: { purchasedMinerId: purchasedFactoryId } // CAMBIO: Metadata actualizada.
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

/**
 * Procesa una solicitud de retiro del usuario.
 */
const requestWithdrawal = async (req, res) => {
  const { amount, walletAddress, withdrawalPassword } = req.body;
  const userId = req.user.id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const settings = await Setting.findOne({ _id: 'global_settings' }).session(session);
    if (!settings) {
        throw new Error('La configuración del sistema no está disponible.');
    }
    
    // Se popula el nuevo campo/referencia.
    const user = await User.findById(userId)
        .select('+withdrawalPassword +isWithdrawalPasswordSet')
        .populate('purchasedMiners.miner') // CAMBIO: Populate actualizado.
        .session(session);

    if (!user) { throw new Error('Usuario no encontrado.'); }

    const hasPurchasedNonFreeMiner = user.purchasedMiners.some(pm => pm.miner && !pm.miner.isFree); // CAMBIO: Lógica actualizada.
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

    // A partir de aquí, la lógica no depende de "Fábricas" vs "Mineros".
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

/**
 * Obtiene el historial de transacciones del usuario.
 */
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
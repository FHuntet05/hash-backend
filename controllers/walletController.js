// RUTA: backend/src/controllers/walletController.js (VERSIÓN CON BILLETERAS ÚNICAS)

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Factory = require('../models/factoryModel');
const Transaction = require('../models/transactionModel');
const Setting = require('../models/settingsModel');
const { ethers } = require('ethers');
// --- INICIO DE LA MODIFICACIÓN CLAVE ---
// 1. Importamos la función de generación de billeteras desde el paymentController.
const { getOrCreateUserBscWallet } = require('./paymentController'); 
// --- FIN DE LA MODIFICACIÓN CLAVE ---

const FACTORY_CYCLE_DURATION_MS = 24 * 60 * 60 * 1000;

// --- FUNCIÓN DE DEPÓSITO RECONSTRUIDA ---
const createDepositAddress = async (req, res) => {
    const userId = req.user.id;

    // ELIMINADO: Ya no necesitamos el 'amount' del body.
    // El sistema detectará cualquier cantidad que se deposite en la dirección única.

    try {
        // --- INICIO DE LA MODIFICACIÓN CLAVE ---
        // 2. Llamamos a la lógica importada para obtener/crear la billetera única del usuario.
        const userUniqueWalletAddress = await getOrCreateUserBscWallet(userId);
        
        // ELIMINADO: La creación de una transacción 'pending' aquí.
        // El treasuryController se encargará de crear la transacción 'completed'
        // cuando detecte el depósito real.

        // 3. Devolvemos la información de la billetera única al usuario.
        // El frontend ahora mostrará esta dirección para que el usuario deposite.
        res.status(200).json({
            paymentAddress: userUniqueWalletAddress,
            // NOTA: El frontend deberá adaptarse para no requerir un 'paymentAmount'.
            // Simplemente mostrará "Deposita USDT (BEP20) a la siguiente dirección:".
            currency: 'USDT',
            network: 'BEP20 (BSC)'
        });
        // --- FIN DE LA MODIFICACIÓN CLAVE ---
    } catch (error) {
        console.error('Error en createDepositAddress:'.red, error);
        res.status(500).json({ message: 'Error al generar la dirección de depósito.' });
    }
};

// --- FUNCIÓN DE COMPRA DE FÁBRICA (SIN CAMBIOS) ---
const purchaseFactoryWithBalance = async (req, res) => {
    const { factoryId, quantity = 1 } = req.body;
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const factory = await Factory.findById(factoryId).session(session).lean();
        if (!factory) throw new Error('La fábrica seleccionada no existe.');

        const user = await User.findById(userId).session(session);
        if (!user) throw new Error('Usuario no encontrado.');

        const totalCost = factory.price * quantity;
        if (user.balance.usdt < totalCost) {
            return res.status(400).json({ message: 'Saldo USDT insuficiente.' });
        }

        user.balance.usdt -= totalCost;
        const now = new Date();
        for (let i = 0; i < quantity; i++) {
            user.purchasedFactories.push({ 
                factory: factory._id, 
                purchaseDate: now, 
                expiryDate: new Date(now.getTime() + factory.durationDays * 24 * 60 * 60 * 1000),
                lastClaim: now
            });
        }
        await user.save({ session });
        await Transaction.create([{ user: userId, type: 'purchase', amount: -totalCost, currency: 'USDT', description: `Compra de ${quantity}x ${factory.name}`, metadata: { factoryId } }], { session });
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

// --- FUNCIÓN DE RECLAMO DE PRODUCCIÓN (SIN CAMBIOS) ---
const claimFactoryProduction = async (req, res) => {
    const { purchasedFactoryId } = req.body;
    const userId = req.user.id;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const user = await User.findById(userId).populate('purchasedFactories.factory').session(session);
        if (!user) throw new Error('Usuario no encontrado.');

        const factoryInstance = user.purchasedFactories.id(purchasedFactoryId);
        if (!factoryInstance) throw new Error('Fábrica no encontrada.');

        const now = new Date();
        if (now.getTime() - new Date(factoryInstance.lastClaim).getTime() < FACTORY_CYCLE_DURATION_MS) {
            return res.status(400).json({ message: 'El ciclo de producción de 24 horas aún no ha terminado.' });
        }

        const production = factoryInstance.factory.dailyProduction;
        user.balance.usdt += production;
        factoryInstance.lastClaim = now;
        await user.save({ session });
        await Transaction.create([{ user: userId, type: 'production_claim', amount: production, currency: 'USDT', description: `Reclamo de producción de ${factoryInstance.factory.name}`, metadata: { purchasedFactoryId } }], { session });
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

// --- FUNCIÓN DE SOLICITUD DE RETIRO (SIN CAMBIOS) ---
const requestWithdrawal = async (req, res) => {
  const { amount, walletAddress, withdrawalPassword } = req.body;
  const userId = req.user.id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const settings = await Setting.findOne({ singleton: 'global_settings' }).session(session);
    if (!settings) throw new Error('La configuración del sistema no está disponible.');
    
    const user = await User.findById(userId).select('+withdrawalPassword').session(session);
    if (!user) throw new Error('Usuario no encontrado.');
    if (!user.isWithdrawalPasswordSet) return res.status(403).json({ message: 'Debes configurar una contraseña de retiro primero.' });
    if (!withdrawalPassword) return res.status(400).json({ message: 'La contraseña de retiro es obligatoria.' });
    const isMatch = await user.matchWithdrawalPassword(withdrawalPassword);
    if (!isMatch) return res.status(401).json({ message: 'La contraseña de retiro es incorrecta.' });

    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount < settings.minimumWithdrawal) return res.status(400).json({ message: `El retiro mínimo es ${settings.minimumWithdrawal} USDT.` });
    if (!ethers.utils.isAddress(walletAddress)) return res.status(400).json({ message: 'La dirección de billetera no es válida.' });
    if (user.balance.usdt < numericAmount) return res.status(400).json({ message: 'Saldo insuficiente.' });

    user.balance.usdt -= numericAmount;
    await user.save({ session });
    
    const feeAmount = numericAmount * (settings.withdrawalFeePercent / 100);
    const netAmount = numericAmount - feeAmount;

    await Transaction.create([{ user: userId, type: 'withdrawal', status: 'pending', amount: -numericAmount, currency: 'USDT', description: `Solicitud de retiro a ${walletAddress}`, metadata: { walletAddress, feeAmount, netAmount } }], { session });
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

// --- FUNCIÓN DE HISTORIAL (SIN CAMBIOS) ---
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
  createDepositAddress,
  purchaseFactoryWithBalance,
  claimFactoryProduction,
  requestWithdrawal,
  getHistory,
};
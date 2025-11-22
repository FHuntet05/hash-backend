// RUTA: backend/controllers/walletController.js

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Miner = require('../models/minerModel');
const Setting = require('../models/settingsModel');
// Importamos desde paymentController para la dirección
const { getOrCreateUserBscWallet } = require('./paymentController');

const MINER_CYCLE_HOURS = 12; // Ciclo estricto de 12 Horas

// --- CREAR DIRECCIÓN DE DEPÓSITO ---
const createDepositAddress = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    try {
        // Usamos la lógica del PaymentController
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
});

// --- COMPRAR POTENCIADOR (MINERO) ---
const purchaseFactoryWithBalance = asyncHandler(async (req, res) => {
    const { factoryId, quantity } = req.body; 
    const qty = parseInt(quantity) || 1;

    const user = await User.findById(req.user.id);
    const miner = await Miner.findById(factoryId);

    if (!miner) { 
        res.status(404); 
        throw new Error('Potenciador no encontrado'); 
    }

    const totalCost = miner.price * qty;
    
    if (user.balance.usdt < totalCost) {
        res.status(400); 
        throw new Error('Saldo insuficiente'); 
    }

    // 1. Deducir Saldo
    user.balance.usdt -= totalCost;

    // 2. Calcular Fechas
    const now = new Date();
    const expiryDate = new Date(now);
    expiryDate.setDate(expiryDate.getDate() + miner.durationDays);

    // 3. Añadir items al inventario del usuario
    // IMPORTANTE: lastClaim se establece en 'now' para que empiece a contar el ciclo desde este momento
    for (let i = 0; i < qty; i++) {
        user.purchasedMiners.push({
            miner: miner._id,
            purchaseDate: now,
            expiryDate: expiryDate,
            lastClaim: now 
        });
    }

    // 4. Registrar Transacción de Compra
    user.transactions.push({
        type: 'purchase',
        amount: totalCost,
        currency: 'USDT',
        description: `Compra: ${qty}x ${miner.name}`,
        status: 'completed'
    });

    // 5. Guardar cambios
    await user.save();

    // 6. Devolver usuario actualizado con populate para el dashboard
    const updatedUser = await User.findById(user._id).populate('purchasedMiners.miner');
    
    res.json({
        message: '¡Potencia Aumentada Exitosamente!',
        user: updatedUser
    });
});

// --- RECLAMAR PRODUCCIÓN (Lógica 12H) ---
const claimFactoryProduction = asyncHandler(async (req, res) => {
    const { purchasedFactoryId } = req.body;
    const userId = req.user.id;

    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const user = await User.findById(userId).populate('purchasedMiners.miner').session(session);
        if (!user) throw new Error('Usuario no encontrado.');
        
        const minerInstance = user.purchasedMiners.id(purchasedFactoryId);
        if (!minerInstance) throw new Error('Potenciador no encontrado en tu cuenta.');
        
        // Verificar Expiración
        const now = new Date();
        if (now > new Date(minerInstance.expiryDate)) {
            throw new Error('Este potenciador ha expirado.');
        }

        // Verificar Ciclo de 12 Horas
        const lastClaimDate = new Date(minerInstance.lastClaim);
        const diffMs = now - lastClaimDate;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours < MINER_CYCLE_HOURS) {
            // Calcular tiempo restante para el mensaje de error
            const remainingMinutes = Math.ceil((MINER_CYCLE_HOURS * 60) - (diffMs / (1000 * 60)));
            const hoursLeft = Math.floor(remainingMinutes / 60);
            const minsLeft = remainingMinutes % 60;
            
            res.status(400);
            throw new Error(`Ciclo en progreso. Faltan ${hoursLeft}h ${minsLeft}m.`);
        }
        
        // Calcular Recompensa: 50% de la producción diaria (Medio día)
        const productionReward = minerInstance.miner.dailyProduction / 2;
        
        // Aplicar cambios
        user.balance.usdt += productionReward;
        minerInstance.lastClaim = now; // Reiniciar reloj
        
        // Registrar Transacción
        user.transactions.push({
            type: 'production_claim',
            amount: productionReward,
            currency: 'USDT',
            description: `Reclamo 12H - ${minerInstance.miner.name}`,
            status: 'completed',
            metadata: { purchasedMinerId: purchasedFactoryId }
        });
        
        await user.save({ session });
        await session.commitTransaction();
        
        // Respuesta final con populate
        const finalUser = await User.findById(userId).populate('purchasedMiners.miner');
        res.json({ message: `¡+${productionReward.toFixed(4)} USDT recibidos!`, user: finalUser.toObject() });

    } catch (error) {
        await session.abortTransaction();
        // Si no seteamos status previamente (ej 400), es error 500
        if (res.statusCode === 200) res.status(500);
        throw new Error(error.message || "Error al procesar el reclamo.");
    } finally {
        session.endSession();
    }
});

// --- SOLICITAR RETIRO ---
const requestWithdrawal = asyncHandler(async (req, res) => {
    const { amount, withdrawalPassword } = req.body;
    const userId = req.user.id;

    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const settings = await Setting.findOne({ _id: 'global_settings' }).session(session) || { withdrawalsEnabled: true, withdrawalFeePercent: 0, minWithdrawal: 5 };
        
        // Buscamos usuario con password seleccionado
        const user = await User.findById(userId)
            .select('+withdrawalPassword +isWithdrawalPasswordSet +withdrawalAddress')
            .populate('purchasedMiners.miner')
            .session(session);

        if (!user) throw new Error('Usuario no encontrado.');
        
        // Validaciones
        if (!settings.withdrawalsEnabled) throw new Error('Retiros en mantenimiento.');
        if (!user.isWithdrawalPasswordSet) throw new Error('Configure contraseña de retiro primero.');
        
        // Verificar Wallet Configurada
        if (!user.withdrawalAddress || !user.withdrawalAddress.isSet) {
            throw new Error('Configure su billetera de retiro.');
        }

        // Verificar Password
        if (!(await user.matchWithdrawalPassword(withdrawalPassword))) {
            res.status(401);
            throw new Error('Contraseña de retiro incorrecta.');
        }

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) throw new Error('Monto inválido.');
        if (numAmount < settings.minWithdrawal) throw new Error(`Mínimo de retiro: ${settings.minWithdrawal} USDT.`);
        if (user.balance.usdt < numAmount) throw new Error('Saldo insuficiente.');

        // Aplicar Retiro
        user.balance.usdt -= numAmount;
        user.totalWithdrawal = (user.totalWithdrawal || 0) + numAmount;

        const feeAmount = numAmount * ((settings.withdrawalFeePercent || 0) / 100);
        const netAmount = numAmount - feeAmount;

        user.transactions.push({
            type: 'withdrawal',
            status: 'pending',
            amount: -numAmount, // Negativo para indicar salida
            currency: 'USDT',
            description: `Retiro solicitado a ${user.withdrawalAddress.address}`,
            metadata: { walletAddress: user.withdrawalAddress.address, feeAmount, netAmount }
        });
        
        await user.save({ session });
        await session.commitTransaction();
        
        const updatedUser = await User.findById(userId).populate('purchasedMiners.miner');
        res.status(201).json({ message: 'Retiro solicitado con éxito.', user: updatedUser.toObject() });

    } catch (error) {
        await session.abortTransaction();
        if (res.statusCode === 200) res.status(400); // Por defecto Bad Request si fallan validaciones
        throw new Error(error.message);
    } finally {
        session.endSession();
    }
});

// --- HISTORIAL DE TRANSACCIONES ---
const getHistory = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('transactions');
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    // Ordenar: Más reciente primero
    const sortedTransactions = user.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(sortedTransactions);
});

module.exports = {
    createDepositAddress,
    purchaseFactoryWithBalance,
    claimFactoryProduction,
    requestWithdrawal,
    getHistory,
};
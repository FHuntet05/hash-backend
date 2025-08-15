// RUTA: backend/controllers/walletController.js (v4.0 - LÓGICA DE RETIRO BLINDADA)

const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const Factory = require('../models/factoryModel');
const Transaction = require('../models/transactionModel');
const Settings = require('../models/settingsModel'); // <-- Se importa el modelo de configuración global

/**
 * @desc    El usuario compra una fábrica.
 * @route   POST /api/wallet/purchase-factory
 * @access  Private
 */
const purchaseFactory = asyncHandler(async (req, res) => {
    const { factoryId } = req.body;
    const userId = req.user.id;

    const [factory, user] = await Promise.all([
        Factory.findById(factoryId),
        User.findById(userId)
    ]);

    if (!factory) {
        res.status(404);
        throw new Error('Fábrica no encontrada.');
    }

    if (user.balance.usdt < factory.price) {
        res.status(400);
        throw new Error('Saldo insuficiente para comprar esta fábrica.');
    }

    const purchaseDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(purchaseDate.getDate() + factory.durationDays);

    user.balance.usdt -= factory.price;
    user.purchasedFactories.push({
        factory: factory._id,
        purchaseDate,
        expiryDate,
        lastClaim: purchaseDate
    });

    const purchaseTransaction = {
        type: 'purchase',
        amount: factory.price,
        currency: 'USDT',
        description: `Compra de fábrica: ${factory.name}`,
        status: 'completed'
    };
    user.transactions.push(purchaseTransaction);
    
    await user.save();

    res.status(201).json({
        message: '¡Fábrica comprada con éxito!',
        user
    });
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
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado.');
    }

    const purchasedFactory = user.purchasedFactories.id(purchasedFactoryId);
    if (!purchasedFactory) {
        res.status(404);
        throw new Error('Fábrica comprada no encontrada en tu perfil.');
    }
    
    const now = new Date();
    const lastClaim = new Date(purchasedFactory.lastClaim);
    const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);

    // Asumimos un ciclo de 24h para el reclamo
    if (hoursSinceLastClaim < 24) {
        res.status(400);
        throw new Error('Aún no puedes reclamar la producción de esta fábrica.');
    }
    
    const dailyProduction = purchasedFactory.factory.dailyProduction;
    user.balance.usdt += dailyProduction;
    purchasedFactory.lastClaim = now;
    
    await user.save();

    res.json({
        message: `+${dailyProduction.toFixed(2)} USDT reclamados.`,
        user
    });
});

/**
 * @desc    El usuario solicita un retiro de fondos.
 * @route   POST /api/wallet/request-withdrawal
 * @access  Private
 */
const requestWithdrawal = asyncHandler(async (req, res) => {
    const { amount, withdrawalAddress, withdrawalPassword } = req.body;
    const userId = req.user.id;
    
    // --- INICIO DE LA CADENA DE VALIDACIÓN JERÁRQUICA ---
    const settings = await Settings.getSettings();
    const user = await User.findById(userId)
        .select('+withdrawalPassword +isWithdrawalPasswordSet') // Incluimos campos necesarios
        .populate('purchasedFactories.factory');

    // 1. Validación Global: ¿Están los retiros habilitados en el sistema?
    if (!settings.withdrawalsEnabled) {
        res.status(403); // Forbidden
        throw new Error('Los retiros están deshabilitados temporalmente por mantenimiento.');
    }

    // 2. Validación de Contraseña de Retiro
    if (!user.isWithdrawalPasswordSet) {
        res.status(400);
        throw new Error('Debe configurar su contraseña de retiro antes de poder solicitar uno.');
    }
    if (!withdrawalPassword) {
        res.status(400);
        throw new Error('Debe proporcionar su contraseña de retiro.');
    }
    const isPasswordMatch = await user.matchWithdrawalPassword(withdrawalPassword);
    if (!isPasswordMatch) {
        res.status(401); // Unauthorized
        throw new Error('La contraseña de retiro es incorrecta.');
    }

    // 3. Validación de Monto
    const withdrawalAmount = parseFloat(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
        res.status(400);
        throw new Error('El monto del retiro no es válido.');
    }
    if (withdrawalAmount < settings.minWithdrawal) {
        res.status(400);
        throw new Error(`El monto mínimo para retirar es de ${settings.minWithdrawal} USDT.`);
    }
    if (withdrawalAmount > user.balance.usdt) {
        res.status(400);
        throw new Error('Saldo insuficiente para realizar este retiro.');
    }

    // 4. Validación de "Forzar Compra" (Global e Individual)
    const hasPurchasedNonFreeFactory = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
    
    // Si la regla global está activa Y el usuario no ha comprado...
    if (settings.forcePurchaseOnAllWithdrawals && !hasPurchasedNonFreeFactory) {
         res.status(403);
         throw new Error('Debe comprar al menos una fábrica para poder activar los retiros.');
    }
    // Si la regla individual está activa Y el usuario no ha comprado...
    if (user.mustPurchaseToWithdraw && !hasPurchasedNonFreeFactory) {
        res.status(403);
        throw new Error('Su cuenta requiere la compra de una fábrica para poder realizar retiros. Contacte a soporte si cree que es un error.');
    }

    // --- FIN DE LA CADENA DE VALIDACIÓN ---

    // Si todas las validaciones pasan, procedemos.
    const feeAmount = withdrawalAmount * (settings.withdrawalFeePercent / 100);
    const amountToReceive = withdrawalAmount - feeAmount;

    // Se crea una transacción de retiro con estado 'pending'
    // Esta lógica podría variar si tiene un modelo de transacción separado.
    user.transactions.push({
        type: 'withdrawal',
        amount: -withdrawalAmount, // Registramos como negativo
        currency: 'USDT',
        status: 'pending',
        description: `Solicitud de retiro a: ${withdrawalAddress}`,
        metadata: {
            address: withdrawalAddress,
            fee: feeAmount,
            finalAmount: amountToReceive
        }
    });

    // Descontamos el saldo del usuario inmediatamente
    user.balance.usdt -= withdrawalAmount;
    await user.save();

    res.status(201).json({
        message: 'Su solicitud de retiro ha sido enviada y está pendiente de aprobación.',
        newBalance: user.balance.usdt
    });
});

/**
 * @desc    Crea o recupera la dirección de depósito de un usuario.
 * @route   GET /api/wallet/create-deposit-address
 * @access  Private
 */
const createDepositAddress = asyncHandler(async (req, res) => {
    // Aquí iría la lógica para interactuar con el servicio que genera
    // las direcciones de depósito BEP20. Por ahora, devolvemos un placeholder.
    const user = await User.findById(req.user.id).select('telegramId');
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }
    // Lógica de generación o recuperación de la dirección...
    const depositAddress = `0x...placeholderAddressForUser...${user.telegramId}`;
    
    res.json({ address: depositAddress });
});


module.exports = {
    purchaseFactory,
    claimProduction,
    requestWithdrawal,
    createDepositAddress
};
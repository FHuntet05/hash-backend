// RUTA: backend/models/userModel.js (v4.4 - VERSIÓN FINAL ESTABLE)
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const transactionSchema = new mongoose.Schema({
    type: { type: String, enum: ['deposit', 'withdrawal', 'purchase', 'referral_commission', 'task_reward'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'USDT' },
    description: { type: String, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
}, { timestamps: true });

const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, unique: true, sparse: true },
    fullName: { type: String },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    
    // --- CAMPO CORREGIDO PARA EL ERROR E11000 ---
    referralCode: {
        type: String,
        unique: true,
        // sparse: true crea un índice único pero ignora los documentos donde
        // este campo es nulo o no existe. Esto permite que múltiples usuarios
        // tengan un valor 'null' sin violar la restricción de unicidad.
        sparse: true 
    },

    status: {
        type: String,
        enum: ['active', 'banned', 'pending_verification'],
        default: 'active'
    },
    isBanned: {
        type: Boolean,
        default: false
    },

    password: { type: String, select: false },
    passwordResetRequired: { type: Boolean, default: false },
    balance: {
        usdt: { type: Number, default: 0 },
    },
    
    purchasedFactories: [{
        factory: { type: mongoose.Schema.Types.ObjectId, ref: 'Factory', required: true },
        purchaseDate: { type: Date, required: true },
        expiryDate: { type: Date, required: true },
        lastClaim: { type: Date, required: true },
    }],

    transactions: [transactionSchema],
    photoFileId: { type: String },
    language: { type: String, default: 'es' },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    
    referrals: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        level: { type: Number, required: true, enum: [1, 2, 3] }
    }],
    
    // --- CAMPO ROBUSTECIDO PARA EVITAR ERRORES DE VALIDACIÓN ---
    claimedTasks: {
        type: Map,
        of: new mongoose.Schema({
            claimed: { type: Boolean, default: true },
            referralCountAtClaim: { type: Number } 
        }, { _id: false }),
        default: {},
        required: true // Fuerza a Mongoose a aplicar el default en la creación.
    },

    telegramVisited: {
        type: Boolean,
        default: false
    },
    
    withdrawalPassword: {
        type: String,
        select: false,
    },
    isWithdrawalPasswordSet: {
        type: Boolean,
        default: false,
    },

    mustPurchaseToWithdraw: {
      type: Boolean,
      default: false
    },
    
}, { timestamps: true });

// --- HOOK PRE-SAVE PARA LÓGICA AUTOMÁTICA ---
userSchema.pre('save', async function(next) {
    // Hashear contraseñas si han sido modificadas
    if (this.isModified('password') && this.password) {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    }
    if (this.isModified('withdrawalPassword') && this.withdrawalPassword) {
        const salt = await bcrypt.genSalt(10);
        this.withdrawalPassword = await bcrypt.hash(this.withdrawalPassword, salt);
    }

    // Sincronizar el estado de baneo
    if (this.isModified('status')) {
        this.isBanned = this.status === 'banned';
    }
    
    // Generar un código de referido único si el usuario no tiene uno
    // Usar el telegramId es una excelente estrategia para asegurar unicidad
    if (!this.referralCode) {
        this.referralCode = this.telegramId;
    }

    next();
});

// --- MÉTODOS DEL MODELO ---
userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.matchWithdrawalPassword = async function(enteredPassword) {
    if (!this.withdrawalPassword) return false;
    return await bcrypt.compare(enteredPassword, this.withdrawalPassword);
};

module.exports = mongoose.model('User', userSchema);
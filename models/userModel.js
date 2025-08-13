// RUTA: backend/src/models/userModel.js (CON CONTRASEÑA DE RETIRO)

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ... (purchasedFactorySchema y transactionSchema se mantienen sin cambios)
const purchasedFactorySchema = new mongoose.Schema({
    factory: { type: mongoose.Schema.Types.ObjectId, ref: 'Factory', required: true },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    lastClaim: { type: Date },
});

const transactionSchema = new mongoose.Schema({
    type: { type: String, enum: ['deposit', 'withdrawal', 'purchase', 'swap_ntx_to_usdt', 'mining_claim', 'referral_commission', 'task_reward'], required: true },
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
    password: { type: String, select: false },
    passwordResetRequired: { type: Boolean, default: false },
    balance: {
        usdt: { type: Number, default: 0 },
        ntx: { type: Number, default: 0 },
    },
    productionBalance: {
        usdt: { type: Number, default: 0 },
        ntx: { type: Number, default: 0 },
    },
    purchasedFactories: [purchasedFactorySchema],
    transactions: [transactionSchema],
    photoFileId: { type: String },
    language: { type: String, default: 'es' },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referrals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // --- NUEVOS CAMPOS PARA CONTRASEÑA DE RETIRO ---
    withdrawalPassword: {
        type: String,
        select: false, // Nunca se envía al frontend por defecto
    },
    isWithdrawalPasswordSet: {
        type: Boolean,
        default: false, // Por defecto, el usuario no ha configurado la contraseña
    },
    // ---------------------------------------------
    
}, { timestamps: true });


// --- MIDDLEWARE Y MÉTODOS PARA CONTRASEÑA DE LOGIN ---
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// --- NUEVO MIDDLEWARE Y MÉTODO PARA CONTRASEÑA DE RETIRO ---
userSchema.pre('save', async function(next) {
    if (!this.isModified('withdrawalPassword') || !this.withdrawalPassword) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.withdrawalPassword = await bcrypt.hash(this.withdrawalPassword, salt);
    next();
});

userSchema.methods.matchWithdrawalPassword = async function(enteredPassword) {
    if (!this.withdrawalPassword) return false;
    return await bcrypt.compare(enteredPassword, this.withdrawalPassword);
};
// -------------------------------------------------------------

module.exports = mongoose.model('User', userSchema);
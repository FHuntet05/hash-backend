// RUTA: backend/models/userModel.js (v4.0 - SOPORTE PARA FORZAR COMPRA)
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
    
    claimedTasks: {
        type: Map,
        of: Boolean,
        default: {}
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

    // --- INICIO DE NUEVO CAMPO ---
    /**
     * Si es 'true', el usuario no podrá retirar hasta que compre una nueva fábrica.
     * Un administrador puede activar este flag manualmente.
     */
    mustPurchaseToWithdraw: {
      type: Boolean,
      default: false
    },
    // --- FIN DE NUEVO CAMPO ---
    
}, { timestamps: true });


// --- MIDDLEWARE Y MÉTODOS (sin cambios) ---
userSchema.pre('save', async function(next) {
    if (this.isModified('password') && this.password) {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    }
    if (this.isModified('withdrawalPassword') && this.withdrawalPassword) {
        const salt = await bcrypt.genSalt(10);
        this.withdrawalPassword = await bcrypt.hash(this.withdrawalPassword, salt);
    }
    next();
});

userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.matchWithdrawalPassword = async function(enteredPassword) {
    if (!this.withdrawalPassword) return false;
    return await bcrypt.compare(enteredPassword, this.withdrawalPassword);
};

module.exports = mongoose.model('User', userSchema);
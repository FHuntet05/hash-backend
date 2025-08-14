// RUTA: backend/src/models/userModel.js (v2.0 - SUBDOCUMENTO ELIMINADO)

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// --- INICIO DE CORRECCIÓN CRÍTICA ---
// Se elimina el `purchasedFactorySchema` como una constante separada.
// --- FIN DE CORRECCIÓN CRÍTICA ---

// El transactionSchema no causa problemas, se puede mantener.
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
        ntx: { type: Number, default: 0 }, // Mantener por si se usa en otro lado, pero se puede limpiar
    },
    productionBalance: { // Campo obsoleto, se puede limpiar en el futuro
        usdt: { type: Number, default: 0 },
        ntx: { type: Number, default: 0 },
    },
    
    // --- INICIO DE CORRECCIÓN CRÍTICA ---
    // Se define la estructura directamente aquí. Esto es más robusto.
    purchasedFactories: [{
        factory: { type: mongoose.Schema.Types.ObjectId, ref: 'Factory', required: true },
        purchaseDate: { type: Date, required: true },
        expiryDate: { type: Date, required: true },
        lastClaim: { type: Date, required: true }, // Se hace requerido para consistencia
    }],
    // --- FIN DE CORRECCIÓN CRÍTICA ---

    transactions: [transactionSchema],
    photoFileId: { type: String },
    language: { type: String, default: 'es' },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referrals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Esto debería ser un array de objetos con más info
    
    withdrawalPassword: {
        type: String,
        select: false,
    },
    isWithdrawalPasswordSet: {
        type: Boolean,
        default: false,
    },
    
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
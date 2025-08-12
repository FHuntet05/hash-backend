// backend/models/userModel.js (VERSIÓN MEGA FÁBRICA v2.1 - CON FLAG DE RESETEO)
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const purchasedFactorySchema = new mongoose.Schema({
  factory: { type: mongoose.Schema.Types.ObjectId, ref: 'Factory', required: true }, 
  purchaseDate: { type: Date, default: Date.now }, 
  expiryDate: { type: Date, required: true },
  lastProductionTimestamp: { type: Date, default: Date.now } 
}, { _id: true });

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  fullName: { type: String },
  password: { type: String, required: false, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  status: { type: String, enum: ['active', 'banned'], default: 'active' },
  
  // Flag para forzar el cambio de contraseña en el primer login de un admin.
  passwordResetRequired: { type: Boolean, default: false, select: false },

  twoFactorSecret: { type: String, select: false },
  isTwoFactorEnabled: { type: Boolean, default: false },
  language: { type: String, default: 'es' },
  photoFileId: { type: String, default: null },
  balance: { usdt: { type: Number, default: 0 } },
  productionBalance: { usdt: { type: Number, default: 0 } },
  totalRecharge: { type: Number, default: 0 },
  totalWithdrawal: { type: Number, default: 0 },
  totalProductionClaimed: { type: Number, default: 0 },
  totalSpending: { type: Number, default: 0 },
  purchasedFactories: [purchasedFactorySchema],
  referralCode: { type: String, unique: true, default: null },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referrals: [{ level: { type: Number, required: true }, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true } }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

userSchema.virtual('totalDailyProduction').get(function() {
  if (!this.purchasedFactories || this.purchasedFactories.length === 0) {
    return 0;
  }
  return this.purchasedFactories.reduce((total, pf) => {
    if (new Date() > pf.expiryDate) {
        return total;
    }
    return total + (pf.factory?.dailyProduction || 0);
  }, 0);
});

userSchema.pre('save', async function (next) {
  if (this.isNew && !this.referralCode) {
      this.referralCode = `ref_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`;
  }
  if (this.isModified('password') && this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

userSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password || !enteredPassword) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
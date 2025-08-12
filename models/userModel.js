// backend/models/userModel.js (VERSIÓN MEGA FÁBRICA v2.0 - LÓGICA DE PRODUCCIÓN DETALLADA)
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * SUB-SCHEMA PARA FÁBRICAS COMPRADAS
 * Define la estructura de cada instancia de fábrica que un usuario posee.
 * Contiene el estado individual de cada activo productivo.
 */
const purchasedFactorySchema = new mongoose.Schema({
  // MODIFICADO: La referencia ahora es al nuevo modelo 'Factory'.
  factory: { type: mongoose.Schema.Types.ObjectId, ref: 'Factory', required: true }, 
  purchaseDate: { type: Date, default: Date.now }, 
  expiryDate: { type: Date, required: true },
  
  // NUEVO: 'lastProductionTimestamp' registra el último momento exacto en que se calculó la producción.
  // Esto permite un cálculo preciso de la producción acumulada desde el último punto.
  lastProductionTimestamp: { type: Date, default: Date.now } 
}, { _id: true });


const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  fullName: { type: String },

  password: { type: String, required: false, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  status: { type: String, enum: ['active', 'banned'], default: 'active' },
  
  twoFactorSecret: { type: String, select: false },
  isTwoFactorEnabled: { type: Boolean, default: false },
  
  language: { type: String, default: 'es' },
  
  photoFileId: { type: String, default: null },

  // MODIFICADO: El balance del usuario ahora es únicamente en USDT y se mantiene separado de la producción.
  balance: { 
    usdt: { type: Number, default: 0 } 
    // ELIMINADO: balance.ntx
  },
  
  // NUEVO: Balance de producción. Aquí se acumula el USDT generado por las fábricas.
  // Este saldo no es líquido hasta que el usuario lo reclama.
  productionBalance: {
    usdt: { type: Number, default: 0 }
  },

  // NUEVO y MANTENIDO: Campos para estadísticas y trazabilidad.
  totalRecharge: { type: Number, default: 0 },
  totalWithdrawal: { type: Number, default: 0 },
  totalProductionClaimed: { type: Number, default: 0 }, // Registra todo lo que el usuario ha reclamado de sus fábricas.
  totalSpending: { type: Number, default: 0 }, // Registra el total gastado en fábricas.

  // MODIFICADO: 'activeTools' se renombra y reestructura a 'purchasedFactories'.
  purchasedFactories: [purchasedFactorySchema],
  
  // ELIMINADOS: Todos los campos relacionados con la lógica de minado de Neuro Link.
  // - baseMiningRate, effectiveMiningRate, claimedTasks, telegramVisited, miningStatus, lastMiningClaim.

  referralCode: { type: String, unique: true, default: null },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referrals: [{ 
    level: { type: Number, required: true }, 
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true } 
  }],
}, {
  timestamps: true,
  // NUEVO: Se define un método virtual para calcular la producción total diaria del usuario.
  // Esto es más eficiente que almacenarlo, ya que se calcula solo cuando se necesita.
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// VIRTUAL: Calcula la producción total diaria del usuario en USDT.
userSchema.virtual('totalDailyProduction').get(function() {
  if (!this.purchasedFactories || this.purchasedFactories.length === 0) {
    return 0;
  }
  // Se necesita popular 'purchasedFactories.factory' para que esto funcione.
  return this.purchasedFactories.reduce((total, pf) => {
    // Si la fábrica ha expirado, no produce.
    if (new Date() > pf.expiryDate) {
        return total;
    }
    // Asegurarse de que el campo dailyProduction esté disponible (requiere .populate())
    return total + (pf.factory.dailyProduction || 0);
  }, 0);
});

/**
 * Hook 'pre-save' unificado. Se mantiene sin cambios en su lógica interna.
 * Ejecuta la generación de código de referido y el hasheo de contraseña.
 */
userSchema.pre('save', async function (next) {
  // 1. Lógica de generación de código de referido
  if (this.isNew && !this.referralCode) {
      this.referralCode = `ref_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`;
  }

  // 2. Lógica de hasheo de contraseña
  if (this.isModified('password') && this.password) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  
  next();
});

/**
 * Método para comparar contraseñas. Se mantiene sin cambios.
 */
userSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password || !enteredPassword) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
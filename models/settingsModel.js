// RUTA: backend/models/settingsModel.js (v3.0 - CON REGLA GLOBAL DE RETIRO)

const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  singleton: { type: String, default: 'global_settings', unique: true },
  maintenanceMode: { type: Boolean, default: false },
  maintenanceMessage: { type: String, trim: true, default: 'La aplicación está en mantenimiento. Vuelve más tarde.' },
  minimumWithdrawal: { type: Number, default: 1.0 },
  withdrawalFeePercent: { type: Number, default: 0 },
  swapFeePercent: { type: Number, default: 0 },
  minimumSwap: { type: Number, default: 10000 },
  adminTelegramId: { type: String, trim: true, default: '' },
  bnbAlertThreshold: { type: Number, default: 0.05 },
  trxAlertThreshold: { type: Number, default: 100 },
  withdrawalsEnabled: {
    type: Boolean,
    default: true,
  },

  // --- INICIO DE NUEVO CAMPO ---
  /**
   * Controla globalmente si TODOS los usuarios deben comprar una nueva fábrica para poder retirar.
   * Si es 'true', esta regla se aplica a todos, ignorando el ajuste individual del usuario.
   */
  forcePurchaseOnAllWithdrawals: {
    type: Boolean,
    default: false
  }
  // --- FIN DE NUEVO CAMPO ---

}, { timestamps: true });

module.exports = mongoose.model('Setting', settingsSchema);
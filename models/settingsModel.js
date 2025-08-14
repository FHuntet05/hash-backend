// RUTA: backend/models/settingsModel.js (v2.0 - SOPORTE PARA CONTROL DE RETIROS)
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

  // --- INICIO DE NUEVO CAMPO ---
  /**
   * Controla globalmente si los usuarios pueden solicitar retiros.
   * Si es 'false', todas las solicitudes de retiro serán bloqueadas.
   */
  withdrawalsEnabled: {
    type: Boolean,
    default: true,
  },
  // --- FIN DE NUEVO CAMPO ---

}, { timestamps: true });

module.exports = mongoose.model('Setting', settingsSchema);
// RUTA: backend/models/settingsModel.js (v2.0 - FEATURE-002: COMISIONES PORCENTUALES)

const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    _id: {
        type: String,
        default: 'global_settings'
    },
    maintenanceMode: {
        type: Boolean,
        default: false
    },
    withdrawalsEnabled: {
        type: Boolean,
        default: true
    },
    minWithdrawal: {
        type: Number,
        default: 10
    },
    withdrawalFeePercent: {
        type: Number,
        default: 5,
        min: 0,
        max: 100
    },
    forcePurchaseOnAllWithdrawals: {
        type: Boolean,
        default: false
    },

    // --- INICIO DE MODIFICACIÓN CRÍTICA PARA FEATURE-002 ---
    // Los campos de comisión fija han sido reemplazados por un objeto
    // que almacena los porcentajes para cada nivel de referido.
    referralPercentages: {
        level1: { type: Number, default: 10, min: 0 }, // 10% por defecto
        level2: { type: Number, default: 5, min: 0 },  // 5% por defecto
        level3: { type: Number, default: 3, min: 0 }   // 3% por defecto
    }
    // --- FIN DE MODIFICACIÓN CRÍTICA ---

}, {
    versionKey: false,
    timestamps: false
});

settingsSchema.statics.getSettings = async function() {
    let settings = await this.findById('global_settings');
    if (!settings) {
        // Si no existen settings, se crea el documento inicial.
        settings = await this.create({ _id: 'global_settings' });
    }
    return settings;
};

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;
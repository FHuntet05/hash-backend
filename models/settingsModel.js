// RUTA: backend/models/settingsModel.js (v1.2 - COMISIONES FIJAS MULTINIVEL)

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

    // --- INICIO DE NUEVOS CAMPOS PARA COMISIONES FIJAS ---
    // Comisión en USDT para el referente de Nivel 1 (padre directo).
    commissionLevel1: {
        type: Number,
        default: 0.30,
        min: 0
    },
    // Comisión en USDT para el referente de Nivel 2 (abuelo).
    commissionLevel2: {
        type: Number,
        default: 0.20,
        min: 0
    },
    // Comisión en USDT para el referente de Nivel 3 (bisabuelo).
    commissionLevel3: {
        type: Number,
        default: 0.10,
        min: 0
    }
    // --- FIN DE NUEVOS CAMPOS ---

}, {
    versionKey: false,
    timestamps: false
});

settingsSchema.statics.getSettings = async function() {
    const settings = await this.findById('global_settings');
    if (settings) {
        return settings;
    }
    return this.create({ _id: 'global_settings' });
};

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;
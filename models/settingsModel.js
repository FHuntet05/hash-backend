// RUTA: backend/models/settingsModel.js

const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    _id: {
        type: String,
        required: true, // Siempre 'global_settings'
        default: 'global_settings'
    },
    // --- CONTROLES GENERALES ---
    maintenanceMode: {
        type: Boolean,
        default: false
    },
    maintenanceMessage: {
        type: String,
        default: "Mantenimiento programado. Volvemos pronto."
    },
    withdrawalsEnabled: {
        type: Boolean,
        default: true
    },
    forcePurchaseOnAllWithdrawals: {
        type: Boolean,
        default: false
    },

    // --- PARÁMETROS FINANCIEROS ---
    minWithdrawal: {
        type: Number,
        default: 5.0
    },
    withdrawalFeePercent: {
        type: Number,
        default: 2.0 // 2% default
    },

    // --- SISTEMA DE REFERIDOS (NUEVO) ---
    referralPercentages: {
        level1: { type: Number, default: 5 }, // 5% default
        level2: { type: Number, default: 2 }, // 2% default
        level3: { type: Number, default: 1 }  // 1% default
    }

}, { timestamps: true });

// Método helper estático para garantizar que siempre exista una configuración
settingsSchema.statics.getSettings = async function() {
    let settings = await this.findOne({ _id: 'global_settings' });
    if (!settings) {
        // Si no existe, creamos uno por defecto
        settings = await this.create({ 
            _id: 'global_settings',
            referralPercentages: { level1: 5, level2: 2, level3: 1 }
        });
    }
    return settings;
};

const Settings = mongoose.model('Settings', settingsSchema);
module.exports = Settings;
// RUTA: backend/models/settingsModel.js (NUEVO ARCHIVO)

const mongoose = require('mongoose');

/**
 * Define el esquema para las configuraciones globales de la aplicación.
 * Este modelo está diseñado para tener un único documento, lo que permite
 * una gestión centralizada de las reglas de negocio y estados de la plataforma.
 */
const settingsSchema = new mongoose.Schema({
    // Utilizamos un _id fijo y predecible ('global_settings') para asegurar que solo
    // pueda existir un documento de configuración en la colección. Esto simplifica
    // enormemente las operaciones de lectura y escritura, ya que siempre sabemos
    // qué documento buscar.
    _id: {
        type: String,
        default: 'global_settings'
    },
    
    // Controla si la aplicación está accesible para los usuarios.
    // Si es 'true', el middleware de autenticación bloqueará el acceso.
    maintenanceMode: {
        type: Boolean,
        default: false
    },

    // Habilita o deshabilita la función de retiros en toda la plataforma.
    // Esta es la primera verificación en la cadena de validación de retiros.
    withdrawalsEnabled: {
        type: Boolean,
        default: true
    },

    // Define la cantidad mínima de USDT que un usuario puede solicitar en un retiro.
    minWithdrawal: {
        type: Number,
        default: 10
    },

    // La comisión de retiro como un porcentaje. Por ejemplo, un valor de 5 representa un 5%.
    withdrawalFeePercent: {
        type: Number,
        default: 5,
        min: 0,
        max: 100
    },

    // Una regla de negocio global crítica.
    // Si se establece en 'true', TODOS los usuarios (sin excepción) deben haber
    // comprado al menos una fábrica (no gratuita) para poder solicitar un retiro.
    // Esto anula cualquier configuración individual del usuario.
    forcePurchaseOnAllWithdrawals: {
        type: Boolean,
        default: false
    }
}, {
    // Desactivamos la creación del campo '__v' (versionKey) en este modelo específico
    // ya que no es necesario para un documento de configuración único.
    versionKey: false,
    // Timestamps no son necesarios para este modelo.
    timestamps: false
});

/**
 * Método estático para obtener la configuración de forma segura y consistente.
 * Este método busca el documento de configuración. Si no lo encuentra
 * (por ejemplo, en el primer arranque de la aplicación), lo crea con los
 * valores por defecto definidos en el esquema. Esto asegura que la aplicación
 * siempre tenga acceso a un objeto de configuración válido.
 * 
 * @returns {Promise<Document>} El documento de configuración global.
 */
settingsSchema.statics.getSettings = async function() {
    // 'this' se refiere al modelo 'Settings'
    const settings = await this.findById('global_settings');
    if (settings) {
        return settings;
    }
    // Si no existe, lo crea y lo devuelve.
    return this.create({ _id: 'global_settings' });
};

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;
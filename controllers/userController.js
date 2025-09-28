// RUTA: backend/controllers/userController.js (v2.2 - VALIDACIÓN HÍBRIDA Y DEFINITIVA)

const asyncHandler = require('express-async-handler');
const axios = require('axios');
const User = require('../models/userModel');

// Se importa el validador, manejando el caso de que falle.
let WAValidator;
try {
    WAValidator = require('wallet-address-validator');
    // En algunos entornos de módulos, la exportación principal está en .default
    if (WAValidator && WAValidator.default) {
        WAValidator = WAValidator.default;
    }
} catch (e) {
    console.warn("ADVERTENCIA: El paquete 'wallet-address-validator' no se pudo cargar. Se usará la validación de formato como fallback.", e.message);
}

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// --- INICIO DE NUEVA FUNCIÓN DE VALIDACIÓN DE FORMATO ---
/**
 * Valida el formato estructural de una dirección de billetera para las redes más comunes.
 * @param {string} address - La dirección a validar.
 * @returns {boolean} - True si el formato es correcto, false en caso contrario.
 */
const isAddressFormatValid = (address) => {
    if (!address || typeof address !== 'string') return false;
    // Expresión regular para direcciones tipo Ethereum (BEP20, ERC20, etc.)
    const ethRegex = /^0x[a-fA-F0-9]{40}$/;
    // Expresión regular para direcciones tipo Tron (TRC20)
    const tronRegex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

    return ethRegex.test(address) || tronRegex.test(address);
};
// --- FIN DE NUEVA FUNCIÓN ---

const getTemporaryPhotoUrl = async (photoFileId) => {
    if (!photoFileId) return null;
    try {
        const fileInfoResponse = await axios.get(`${TELEGRAM_API_URL}/getFile`, { params: { file_id: photoFileId } });
        if (!fileInfoResponse.data.ok) { return null; }
        const filePath = fileInfoResponse.data.result.file_path;
        return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
    } catch (error) {
        console.error(`[PHOTO] CATCH: Error al resolver la foto de Telegram para el file_id ${photoFileId}:`, error.message);
        return null;
    }
};

const setWithdrawalPassword = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    const user = await User.findById(userId).select('+withdrawalPassword +isWithdrawalPasswordSet');
    if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    if (user.isWithdrawalPasswordSet) {
        if (!currentPassword) {
            return res.status(400).json({ message: 'La contraseña actual es obligatoria para realizar el cambio.' });
        }
        const isMatch = await user.matchWithdrawalPassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ message: 'La contraseña actual es incorrecta.' });
        }
    }
    user.withdrawalPassword = newPassword;
    user.isWithdrawalPasswordSet = true;
    await user.save();
    const updatedUser = await User.findById(userId).populate('purchasedMiners.miner');
    res.status(200).json({
        message: 'Contraseña de retiro actualizada con éxito.',
        user: updatedUser
    });
});

const setWithdrawalAddress = asyncHandler(async (req, res) => {
    const { address } = req.body;

    if (!address) {
        res.status(400);
        throw new Error('La dirección de la billetera es requerida.');
    }

    // --- INICIO DE NUEVA LÓGICA DE VALIDACIÓN HÍBRIDA ---
    let isValid = false;
    // Paso 1: Intentar validar con la librería si está disponible.
    if (WAValidator) {
        isValid = WAValidator.validate(address);
    }
    // Paso 2: Si la librería no está disponible o falla, usar nuestra validación de formato como fallback.
    if (!isValid) {
        isValid = isAddressFormatValid(address);
    }
    
    if (!isValid) {
        res.status(400);
        throw new Error('La dirección de billetera proporcionada no es válida o no tiene un formato correcto.');
    }
    // --- FIN DE NUEVA LÓGICA DE VALIDACIÓN HÍBRIDA ---

    const user = await User.findById(req.user.id);
    if (user) {
        user.withdrawalAddress = {
            address: address,
            isSet: true,
            updatedAt: new Date()
        };
        const savedUser = await user.save();
        const updatedUser = await User.findById(savedUser._id).populate('purchasedMiners.miner');
        res.status(200).json({
            message: 'Billetera de retiro guardada con éxito.',
            user: updatedUser
        });
    } else {
        res.status(404);
        throw new Error('Usuario no encontrado.');
    }
});

module.exports = {
    getTemporaryPhotoUrl,
    setWithdrawalPassword,
    setWithdrawalAddress,
};
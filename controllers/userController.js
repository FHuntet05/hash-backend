// RUTA: backend/controllers/userController.js (v2.1 - VALIDACIÓN ROBUSTA Y A PRUEBA DE FALLOS)

const asyncHandler = require('express-async-handler');
const axios = require('axios');
const User = require('../models/userModel');

// --- INICIO DE MODIFICACIÓN CRÍTICA ---
// Se importa el validador con una comprobación inmediata.
let WAValidator;
try {
    WAValidator = require('wallet-address-validator');
} catch (e) {
    console.error("CRITICAL ERROR: El paquete 'wallet-address-validator' no se pudo cargar.", e);
    // Si el paquete no se carga, WAValidator será 'undefined', lo cual manejaremos más adelante.
}
// --- FIN DE MODIFICACIÓN CRÍTICA ---

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const getTemporaryPhotoUrl = async (photoFileId) => {
    if (!photoFileId) return null;
    try {
        const fileInfoResponse = await axios.get(`${TELEGRAM_API_URL}/getFile`, { params: { file_id: photoFileId } });
        if (!fileInfoResponse.data.ok) {
            console.error(`[PHOTO] Error: Telegram API no pudo obtener info del archivo para file_id: ${photoFileId}.`, fileInfoResponse.data);
            return null;
        }
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
    // --- INICIO DE MODIFICACIÓN CRÍTICA ---
    // 1. Verificar si el validador se cargó correctamente al inicio.
    if (!WAValidator) {
        console.error("ERROR FATAL EN EJECUCIÓN: WAValidator no está disponible.");
        res.status(500);
        throw new Error("Error interno del servidor: El servicio de validación de billeteras no está operativo.");
    }
    // --- FIN DE MODIFICACIÓN CRÍTICA ---

    const { address } = req.body;

    if (!address) {
        res.status(400);
        throw new Error('La dirección de la billetera es requerida.');
    }

    // --- INICIO DE MODIFICACIÓN CRÍTICA ---
    // 2. Simplificar la validación a un método más genérico y robusto.
    // Esto valida la estructura criptográfica de la dirección para las redes más comunes (BTC, ETH/BEP20, TRON/TRC20, etc.).
    const isValid = WAValidator.validate(address);
    if (!isValid) {
        res.status(400);
        throw new Error('La dirección de billetera proporcionada no es válida o no tiene un formato correcto.');
    }
    // --- FIN DE MODIFICACIÓN CRÍTICA ---

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
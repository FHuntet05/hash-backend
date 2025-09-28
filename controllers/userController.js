// RUTA: backend/controllers/userController.js (v2.0 - FEATURE-001: GUARDAR WALLET)

const asyncHandler = require('express-async-handler');
const axios = require('axios');
const User = require('../models/userModel');
const WAValidator = require('wallet-address-validator'); // Importar el validador

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * @desc    Obtiene la URL de descarga temporal de una foto de perfil de Telegram.
 * @param   {string} photoFileId - El file_id permanente de la foto.
 * @returns {Promise<string|null>} La URL temporal o null si falla.
 */
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

/**
 * @desc    Establece o cambia la contraseña de retiro de un usuario.
 * @route   POST /api/users/withdrawal-password
 * @access  Private
 */
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


// --- INICIO DE NUEVA FUNCIÓN PARA FEATURE-001 ---
/**
 * @desc    Establecer o actualizar la dirección de retiro del usuario
 * @route   PUT /api/users/withdrawal-address
 * @access  Private
 */
const setWithdrawalAddress = asyncHandler(async (req, res) => {
    const { address } = req.body;

    if (!address) {
        res.status(400);
        throw new Error('La dirección de la billetera es requerida.');
    }

    // Validación robusta de la dirección (soporta múltiples cryptos como TRC20 y BEP20)
    // El frontend debe asegurar que se envíe una dirección compatible con USDT
    const isValid = WAValidator.validate(address, 'USDT', 'trc20') || WAValidator.validate(address, 'USDT', 'bep20') || WAValidator.validate(address, 'ETH');
    if (!isValid) {
        res.status(400);
        throw new Error('La dirección de billetera proporcionada no es válida para las redes soportadas (TRC20, BEP20).');
    }

    const user = await User.findById(req.user.id);
    if (user) {
        user.withdrawalAddress = {
            address: address,
            isSet: true,
            updatedAt: new Date()
        };
        const savedUser = await user.save();
        
        // Devolvemos el usuario actualizado sin información sensible
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
// --- FIN DE NUEVA FUNCIÓN ---

module.exports = {
    getTemporaryPhotoUrl,
    setWithdrawalPassword,
    setWithdrawalAddress, // Exportar la nueva función
};
// RUTA: backend/src/controllers/userController.js (VERSIÓN FINAL - SOLO TELEGRAM API)

const axios = require('axios');
const User = require('../models/userModel');

// --- CÓDIGO DE S3 COMPLETAMENTE ELIMINADO ---
// No hay 'require('@aws-sdk/client-s3')'. Esto resuelve el error de build.

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * @desc    Obtiene la URL de descarga temporal de una foto de perfil de Telegram.
 * @param   {string} photoFileId - El file_id permanente de la foto.
 * @returns {Promise<string|null>} La URL temporal o null si falla.
 */
const getTemporaryPhotoUrl = async (photoFileId) => {
    if (!photoFileId) {
        return null; // Si el usuario no tiene foto, no hacemos nada.
    }
    try {
        // 1. Pedimos a la API de Telegram la información del archivo usando su file_id
        const fileInfoResponse = await axios.get(`${TELEGRAM_API_URL}/getFile`, {
            params: { file_id: photoFileId }
        });

        if (!fileInfoResponse.data.ok) {
            console.error(`[PHOTO] Error: Telegram API no pudo obtener info del archivo para file_id: ${photoFileId}.`, fileInfoResponse.data);
            return null;
        }

        // 2. Construimos la URL de descarga final con el file_path que nos dio la API
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
const setWithdrawalPassword = async (req, res) => {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    try {
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
        
        const updatedUser = await User.findById(userId).populate('purchasedFactories.factory');
        res.status(200).json({
            message: 'Contraseña de retiro actualizada con éxito.',
            user: updatedUser
        });

    } catch (error) {
        console.error('Error en setWithdrawalPassword:'.red, error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

// Se exportan las funciones. La función `getUserPhoto` que solo redirigía se ha eliminado por ser redundante.
module.exports = {
    getTemporaryPhotoUrl,
    setWithdrawalPassword 
};
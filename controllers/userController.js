// RUTA: backend/src/controllers/userController.js (CON LÓGICA DE CONTRASEÑA DE RETIRO)

const User = require('../models/userModel');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ... (configuración de S3 y getTemporaryPhotoUrl se mantienen)
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const getTemporaryPhotoUrl = async (fileId) => {
    if (!fileId) return null;
    try {
        const command = new GetObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET_NAME,
            Key: fileId,
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL válida por 1 hora
        return url;
    } catch (error) {
        console.error("Error generando URL firmada para S3:", error);
        return null;
    }
};


// --- INICIO DE LA NUEVA FUNCIÓN ---

const setWithdrawalPassword = async (req, res) => {
    // El ID del usuario se obtiene del token JWT, gracias a nuestro 'authMiddleware'
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    try {
        // Seleccionamos explícitamente los campos protegidos para poder usarlos
        const user = await User.findById(userId).select('+withdrawalPassword +isWithdrawalPasswordSet');
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        // Si el usuario ya tiene una contraseña, verificamos la actual
        if (user.isWithdrawalPasswordSet) {
            if (!currentPassword) {
                return res.status(400).json({ message: 'La contraseña actual es obligatoria para realizar el cambio.' });
            }
            const isMatch = await user.matchWithdrawalPassword(currentPassword);
            if (!isMatch) {
                return res.status(401).json({ message: 'La contraseña actual es incorrecta.' });
            }
        }

        // Si todo es correcto, establecemos la nueva contraseña
        user.withdrawalPassword = newPassword;
        user.isWithdrawalPasswordSet = true;
        await user.save();
        
        // Devolvemos el usuario actualizado (sin los campos de contraseña)
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

// --- FIN DE LA NUEVA FUNCIÓN ---

// Se exporta la nueva función junto con las existentes
module.exports = {
    getTemporaryPhotoUrl,
    setWithdrawalPassword 
};
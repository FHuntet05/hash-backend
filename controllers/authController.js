// backend/controllers/authController.js (VERSIÓN MEGA FÁBRICA FINAL)

const User = require('../models/userModel');
const Setting = require('../models/settingsModel');
const jwt = require('jsonwebtoken');
const { getTemporaryPhotoUrl } = require('./userController');

const PLACEHOLDER_AVATAR_URL = `${process.env.FRONTEND_URL}/assets/images/user-avatar-placeholder.png`;

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const syncUser = async (req, res) => {
    const { telegramUser } = req.body;
    
    if (!telegramUser || !telegramUser.id) {
        return res.status(400).json({ message: 'Datos de usuario de Telegram requeridos.' });
    }
    
    const telegramId = telegramUser.id.toString();

    try {
        let user = await User.findOne({ telegramId });

        if (!user) {
            console.warn(`[Auth Sync] ADVERTENCIA: El usuario ${telegramId} no existía. Creándolo sobre la marcha.`.yellow);
            const username = telegramUser.username || `user_${telegramId}`;
            const fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim();
            user = new User({
                telegramId,
                username,
                fullName: fullName || username,
                language: telegramUser.language_code || 'es'
            });
            await user.save();
        } else {
            user.username = telegramUser.username || user.username;
            user.fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || user.fullName;
            await user.save();
        }
        
        const userWithDetails = await User.findById(user._id)
            .populate('purchasedFactories.factory')
            .populate('referredBy', 'username fullName');

        const settings = await Setting.findOne({ singleton: 'global_settings' }) || await Setting.create({ singleton: 'global_settings' });
        
        const userObject = userWithDetails.toObject();
        userObject.photoUrl = await getTemporaryPhotoUrl(userObject.photoFileId) || PLACEHOLDER_AVATAR_URL;
        
        const token = generateToken(user._id);

        res.status(200).json({ token, user: userObject, settings });

    } catch (error) {
        console.error('[Auth Sync] ERROR FATAL:'.red.bold, error);
        return res.status(500).json({ message: 'Error interno del servidor.', details: error.message });
    }
};

const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('purchasedFactories.factory').populate('referredBy', 'username fullName');
        if (!user) { return res.status(404).json({ message: 'Usuario no encontrado' }); }
        const settings = await Setting.findOne({ singleton: 'global_settings' });
        res.json({ user: user.toObject(), settings: settings || {} });
    } catch (error) { res.status(500).json({ message: 'Error del servidor' }); }
};

const loginAdmin = async (req, res) => {
    const { username, password } = req.body;
    try {
        const adminUser = await User.findOne({ $or: [{ username }, { telegramId: username }]}).select('+password +passwordResetRequired');
        
        if (adminUser && adminUser.role === 'admin' && (await adminUser.matchPassword(password))) {
            const token = generateToken(adminUser._id);
            res.json({ 
                token,
                admin: {
                    _id: adminUser._id, 
                    username: adminUser.username,
                    telegramId: adminUser.telegramId,
                    role: adminUser.role,
                },
                passwordResetRequired: adminUser.passwordResetRequired || false,
            });
        } else {
            res.status(401).json({ message: 'Credenciales inválidas.' });
        }
    } catch (error) { 
        console.error('Error en loginAdmin:', error);
        res.status(500).json({ message: 'Error del servidor' }); 
    }
};

const getAdminProfile = async (req, res) => {
    try {
        const admin = await User.findById(req.user.id).select('username role telegramId');
        if (!admin || admin.role !== 'admin') {
            return res.status(401).json({ message: 'No autorizado' });
        }
        res.json(admin);
    } catch (error) {
        res.status(500).json({ message: 'Error del servidor' });
    }
};

const updateAdminPassword = async(req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.'});
    }
    try {
        const admin = await User.findById(req.user.id).select('+password +passwordResetRequired');
        if (!admin || !admin.passwordResetRequired) {
            return res.status(403).json({ message: 'No se requiere o no se permite el cambio de contraseña.' });
        }
        admin.password = newPassword;
        admin.passwordResetRequired = false;
        await admin.save();

        const token = generateToken(admin._id);
        res.json({
            token,
            admin: {
                _id: admin._id,
                username: admin.username,
                telegramId: admin.telegramId,
                role: admin.role,
            },
            message: 'Contraseña actualizada con éxito.'
        });
    } catch (error) {
        console.error('Error en updateAdminPassword:', error);
        res.status(500).json({ message: 'Error del servidor al actualizar la contraseña.' });
    }
}

module.exports = { 
    syncUser, 
    getUserProfile, 
    loginAdmin, 
    getAdminProfile, 
    updateAdminPassword 
};
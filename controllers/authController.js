// backend/controllers/authController.js (VERSIÓN MEGA FÁBRICA v2.0 - CON AUTENTICACIÓN ADMIN SEPARADA)

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
            user = new User({ telegramId, username, fullName: fullName || username, language: telegramUser.language_code || 'es' });
            await user.save();
        } else {
            user.username = telegramUser.username || user.username;
            user.fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || user.fullName;
            await user.save();
        }
        
        // MODIFICADO: Referencia al nuevo nombre del modelo
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
        const adminUser = await User.findOne({ $or: [{ username }, { telegramId: username }]}).select('+password');
        if (adminUser && adminUser.role === 'admin' && (await adminUser.matchPassword(password))) {
            const token = generateToken(adminUser._id);
            // Devolvemos los datos del admin para el nuevo store
            res.json({ 
                _id: adminUser._id, 
                username: adminUser.username,
                telegramId: adminUser.telegramId, // Añadimos telegramId para permisos
                role: adminUser.role,
                token 
            });
        } else {
            res.status(401).json({ message: 'Credenciales inválidas.' });
        }
    } catch (error) { res.status(500).json({ message: 'Error del servidor' }); }
};

// NUEVA FUNCIÓN: Obtiene el perfil del admin actualmente logueado
const getAdminProfile = async (req, res) => {
    try {
        // req.user es añadido por el middleware de protección de rutas
        const admin = await User.findById(req.user.id).select('username role telegramId');
        if (!admin || admin.role !== 'admin') {
            return res.status(401).json({ message: 'No autorizado' });
        }
        res.json(admin);
    } catch (error) {
        res.status(500).json({ message: 'Error del servidor' });
    }
};

module.exports = { syncUser, getUserProfile, loginAdmin, getAdminProfile }; // Exportamos la nueva función
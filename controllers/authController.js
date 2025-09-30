// RUTA: backend/controllers/authController.js (v6.5 - SEMÁNTICA "MINER" INTEGRADA)

const User = require('../models/userModel');
const Setting = require('../models/settingsModel');
const Miner = require('../models/minerModel');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { getTemporaryPhotoUrl } = require('./userController');

const PLACEHOLDER_AVATAR_URL = `${process.env.FRONTEND_URL}/assets/images/placeholder.png`;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const syncUser = async (req, res) => {
    const { telegramUser } = req.body;
    if (!telegramUser || !telegramUser.id) { return res.status(400).json({ message: 'Datos de usuario de Telegram requeridos.' }); }
    const telegramId = telegramUser.id.toString();
    try {
        const settings = await Setting.getSettings();
        if (settings.maintenanceMode) { return res.status(503).json({ inMaintenance: true, maintenanceMessage: settings.maintenanceMessage }); }
        
        let user = await User.findOne({ telegramId });

        if (user && user.status === 'banned') { return res.status(403).json({ message: 'Tu cuenta ha sido suspendida. Contacta a soporte.' }); }

        let photoFileId = null;
        try {
            const profilePhotosResponse = await axios.get(`${TELEGRAM_API_URL}/getUserProfilePhotos`, { params: { user_id: telegramId, limit: 1 } });
            if (profilePhotosResponse.data.ok && profilePhotosResponse.data.result.total_count > 0) {
                photoFileId = profilePhotosResponse.data.result.photos[0].slice(-1)[0].file_id;
            }
        } catch (photoError) { console.warn(`[Auth Sync] No se pudo obtener la foto de perfil para ${telegramId}.`, photoError.message); }

        if (!user) {
            console.warn(`[Auth Sync] Usuario no encontrado, creando desde cero...`.yellow);
            const username = telegramUser.username || `user_${telegramId}`;
            const fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim();
            const initialMiners = [];
            const freeMiner = await Miner.findOne({ isFree: true }).lean();
            
            if (freeMiner) {
                const purchaseDate = new Date();
                const expiryDate = new Date(purchaseDate);
                expiryDate.setDate(expiryDate.getDate() + freeMiner.durationDays);
                initialMiners.push({ miner: freeMiner._id, purchaseDate, expiryDate, lastClaim: purchaseDate });
            }
            
            user = new User({ 
                telegramId, username, fullName, 
                language: telegramUser.language_code || 'es', 
                photoFileId, 
                purchasedMiners: initialMiners
            });

        } else {
            if (!user.purchasedMiners || user.purchasedMiners.length === 0) {
                const freeMiner = await Miner.findOne({ isFree: true }).lean();
                if (freeMiner) {
                    const purchaseDate = new Date(); 
                    const expiryDate = new Date();
                    expiryDate.setDate(expiryDate.getDate() + freeMiner.durationDays);
                    user.purchasedMiners.push({
                        miner: freeMiner._id,
                        purchaseDate, expiryDate, lastClaim: purchaseDate
                    });
                }
            }
        }

        user.username = telegramUser.username || user.username;
        user.fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || user.fullName;
        if (photoFileId) user.photoFileId = photoFileId;
        
        await user.save();
        
        const userForResponse = await User.findById(user._id)
            .populate({ path: 'purchasedMiners.miner', model: 'Miner' })
            .populate('referredBy', 'username fullName');
        
        const userObject = userForResponse.toObject();
        userObject.photoUrl = await getTemporaryPhotoUrl(userObject.photoFileId) || PLACEHOLDER_AVATAR_URL;
        const token = generateToken(userForResponse._id);

        res.status(200).json({ token, user: userObject, settings });

    } catch (error) {
        console.error('[Auth Sync] ERROR FATAL:'.red.bold, error);
        return res.status(500).json({ message: 'Error interno del servidor.', details: error.message });
    }
};

const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .populate({ path: 'purchasedMiners.miner', model: 'Miner' })
            .populate('referredBy', 'username fullName');

        if (!user) { return res.status(404).json({ message: 'Usuario no encontrado' }); }
        const settings = await Setting.getSettings();
        res.json({ user: user.toObject(), settings: settings || {} });
    } catch (error) { res.status(500).json({ message: 'Error del servidor' }); }
};

const loginAdmin = async (req, res) => {
    const { username, password } = req.body;
    try {
        const adminUser = await User.findOne({ $or: [{ username }, { telegramId: username }]}).select('+password +passwordResetRequired');
        
        if (adminUser && adminUser.role === 'admin' && (await adminUser.matchPassword(password))) {
            const token = generateToken(adminUser._id);
            const adminPayload = {
                _id: adminUser._id, 
                username: adminUser.username,
                telegramId: adminUser.telegramId,
                role: adminUser.role,
            };
            res.json({ token, admin: adminPayload, passwordResetRequired: adminUser.passwordResetRequired || false, });
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
        const admin = await User.findById(req.user.id).select('_id username role telegramId');
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
    if (!newPassword || newPassword.length < 6) { return res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres.'}); }
    try {
        const admin = await User.findById(req.user.id).select('+password +passwordResetRequired');
        if (!admin || !admin.passwordResetRequired) { return res.status(403).json({ message: 'No se requiere o no se permite el cambio de contraseña.' }); }
        admin.password = newPassword;
        admin.passwordResetRequired = false;
        await admin.save();
        const token = generateToken(admin._id);
        const adminPayload = { _id: admin._id, username: admin.username, telegramId: admin.telegramId, role: admin.role };
        res.json({ token, admin: adminPayload, message: 'Contraseña actualizada con éxito.' });
    } catch (error) {
        console.error('Error en updateAdminPassword:', error);
        res.status(500).json({ message: 'Error del servidor al actualizar la contraseña.' });
    }
};

module.exports = { 
    syncUser, 
    getUserProfile, 
    loginAdmin, 
    getAdminProfile, 
    updateAdminPassword 
};
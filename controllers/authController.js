// RUTA: backend/src/controllers/authController.js (v3.0 - MÉTODO "GUARDAR Y REBUSCAR" A PRUEBA DE ERRORES)

const User = require('../models/userModel');
const Setting = require('../models/settingsModel');
const Factory = require('../models/factoryModel');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { getTemporaryPhotoUrl } = require('./userController');

const PLACEHOLDER_AVATAR_URL = `${process.env.FRONTEND_URL}/assets/images/user-avatar-placeholder.png`;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

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
        let userFromDB = await User.findOne({ telegramId }); // Renombramos la variable para claridad
        let userForResponse; // Esta será la variable final que enviaremos

        let photoFileId = null;
        try {
            const profilePhotosResponse = await axios.get(`${TELEGRAM_API_URL}/getUserProfilePhotos`, {
                params: { user_id: telegramId, limit: 1 }
            });
            if (profilePhotosResponse.data.ok && profilePhotosResponse.data.result.total_count > 0) {
                const photos = profilePhotosResponse.data.result.photos[0];
                photoFileId = photos[photos.length - 1].file_id;
            }
        } catch (photoError) {
            console.warn(`[Auth Sync] No se pudo obtener la foto de perfil para ${telegramId}.`, photoError.message);
        }

        if (!userFromDB) {
            // --- INICIO DE LA LÓGICA "CERO CONFIANZA" ---
            console.log(`[Auth Sync] Creando nuevo usuario para Telegram ID: ${telegramId}`.cyan);
            const username = telegramUser.username || `user_${telegramId}`;
            const fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim();
            
            const newUser = new User({
                telegramId,
                username,
                fullName: fullName || username,
                language: telegramUser.language_code || 'es',
                photoFileId: photoFileId
            });

            const freeFactory = await Factory.findOne({ isFree: true }).lean();
            if (freeFactory) {
                console.log(`[Auth Sync] Fábrica gratuita encontrada: "${freeFactory.name}". Asignando...`.green);
                const purchaseDate = new Date();
                const expiryDate = new Date(purchaseDate);
                expiryDate.setDate(expiryDate.getDate() + freeFactory.durationDays);

                newUser.purchasedFactories.push({
                    factory: freeFactory._id,
                    purchaseDate: purchaseDate,
                    expiryDate: expiryDate,
                    lastClaim: purchaseDate
                });
            } else {
                console.warn('[Auth Sync] ADVERTENCIA: No se encontró fábrica "isFree".'.yellow);
            }
            
            // 1. Guardamos el nuevo usuario en la base de datos.
            const savedUser = await newUser.save();
            
            // 2. IGNORAMOS el objeto `savedUser`. Volvemos a buscarlo desde cero para garantizar la consistencia.
            console.log(`[Auth Sync] Usuario ${savedUser._id} guardado. Rebuscando y poblando...`);
            userForResponse = await User.findById(savedUser._id)
                .populate({
                    path: 'purchasedFactories.factory',
                    model: 'Factory'
                })
                .populate('referredBy', 'username fullName');

            console.log(`[Auth Sync] Datos finales para nuevo usuario: Fábricas encontradas: ${userForResponse.purchasedFactories.length}`);
            // --- FIN DE LA LÓGICA "CERO CONFIANZA" ---

        } else {
            // --- LÓGICA DE ACTUALIZACIÓN DE USUARIO EXISTENTE ---
            userFromDB.username = telegramUser.username || userFromDB.username;
            userFromDB.fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || userFromDB.fullName;
            if (photoFileId) {
                userFromDB.photoFileId = photoFileId;
            }
            const updatedUser = await userFromDB.save();

            // Aquí también, volvemos a buscar y poblar para asegurar consistencia
            userForResponse = await User.findById(updatedUser._id)
                .populate({
                    path: 'purchasedFactories.factory',
                    model: 'Factory'
                })
                .populate('referredBy', 'username fullName');
        }
        
        const settings = await Setting.findOne({ singleton: 'global_settings' }) || await Setting.create({ singleton: 'global_settings' });
        
        const userObject = userForResponse.toObject();
        userObject.photoUrl = await getTemporaryPhotoUrl(userObject.photoFileId) || PLACEHOLDER_AVATAR_URL;
        
        const token = generateToken(userForResponse._id);

        res.status(200).json({ token, user: userObject, settings });

    } catch (error) {
        console.error('[Auth Sync] ERROR FATAL:'.red.bold, error);
        return res.status(500).json({ message: 'Error interno del servidor.', details: error.message });
    }
};

// ... El resto del controlador (getUserProfile, loginAdmin, etc.) permanece exactamente igual ...

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
// RUTA: backend/src/controllers/authController.js (CON ASIGNACIÓN DE FÁBRICA GRATUITA)

const User = require('../models/userModel');
const Setting = require('../models/settingsModel');
const Factory = require('../models/factoryModel'); // <-- IMPORTACIÓN NECESARIA
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
            // --- LÓGICA DE CREACIÓN DE NUEVO USUARIO ---
            console.log(`[Auth Sync] Creando nuevo usuario para Telegram ID: ${telegramId}`.cyan);
            const username = telegramUser.username || `user_${telegramId}`;
            const fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim();
            user = new User({
                telegramId,
                username,
                fullName: fullName || username,
                language: telegramUser.language_code || 'es'
            });

            // --- INICIO DE LA IMPLEMENTACIÓN DE FÁBRICA GRATUITA (Punto 8) ---
            const freeFactory = await Factory.findOne({ isFree: true });
            if (freeFactory) {
                console.log(`[Auth Sync] Fábrica gratuita encontrada: "${freeFactory.name}". Asignando al nuevo usuario.`.green);
                const purchaseDate = new Date();
                const expiryDate = new Date(purchaseDate);
                expiryDate.setDate(expiryDate.getDate() + freeFactory.durationDays);

                user.purchasedFactories.push({
                    factory: freeFactory._id,
                    purchaseDate: purchaseDate,
                    expiryDate: expiryDate,
                    lastClaim: purchaseDate // Se establece la fecha de compra para iniciar el ciclo de 24h
                });
            } else {
                console.warn('[Auth Sync] ADVERTENCIA: No se encontró ninguna fábrica marcada como "isFree". El usuario se creará sin fábrica inicial.'.yellow);
            }
            // --- FIN DE LA IMPLEMENTACIÓN DE FÁBRICA GRATUITA ---
            
            await user.save(); // Se guarda el usuario con su nueva fábrica.

        } else {
            // --- LÓGICA DE ACTUALIZACIÓN DE USUARIO EXISTENTE ---
            user.username = telegramUser.username || user.username;
            user.fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim() || user.fullName;
            await user.save(); // Se guardan los datos actualizados del perfil.
        }
        
        // Se pueblan los datos para la respuesta al frontend
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

// ... El resto de las funciones (getUserProfile, loginAdmin, etc.) permanecen sin cambios ...

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
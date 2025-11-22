// RUTA: backend/controllers/authController.js

const User = require('../models/userModel');
const Setting = require('../models/settingsModel');
const Miner = require('../models/minerModel');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const mongoose = require('mongoose');
const { getTemporaryPhotoUrl } = require('./userController');

const PLACEHOLDER_AVATAR_URL = `${process.env.FRONTEND_URL}/assets/images/placeholder.png`;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// =======================================================
// ⚙️ FUNCIÓN CRÍTICA: AUTOMATIZACIÓN DE COBROS (LAZY CLAIM)
// =======================================================
// Se ejecuta cada vez que el usuario sincroniza o pide su perfil.
// Revisa si han pasado ciclos de 12h y acredita las ganancias pendientes.
const processAutomaticClaims = async (user) => {
    let totalCredit = 0;
    const now = new Date();
    const CYCLE_MS = 12 * 60 * 60 * 1000; // 12 Horas en milisegundos
    let hasUpdates = false;

    if (!user.purchasedMiners || user.purchasedMiners.length === 0) return;

    user.purchasedMiners.forEach(minerInstance => {
        // Validación de integridad
        if (!minerInstance.miner) return; 
        
        const purchaseDate = new Date(minerInstance.purchaseDate);
        const expiryDate = new Date(minerInstance.expiryDate);
        let lastClaimDate = new Date(minerInstance.lastClaim);

        // Si el minero ya expiró totalmente y el último reclamo fue después, no hay nada que hacer.
        if (lastClaimDate >= expiryDate) return;

        // Calcular tiempo efectivo transcurrido (respetando fecha de caducidad)
        const effectiveNow = now > expiryDate ? expiryDate : now;
        const diffMs = effectiveNow.getTime() - lastClaimDate.getTime();

        // ¿Cuántos ciclos completos de 12h han pasado?
        const cyclesCompleted = Math.floor(diffMs / CYCLE_MS);

        if (cyclesCompleted >= 1) {
            // CALCULAR DINERO: (Prod. Diaria / 2) * Ciclos
            const rewardPerCycle = minerInstance.miner.dailyProduction / 2;
            const amountToAdd = rewardPerCycle * cyclesCompleted;

            totalCredit += amountToAdd;

            // CALCULAR TIEMPO: Avanzamos el reloj exactamente los ciclos completados.
            // Importante: No usar 'now', sino (lastClaim + tiempo de ciclos) para no perder
            // los minutos extra que ya están contando para el siguiente.
            const timeToAdd = cyclesCompleted * CYCLE_MS;
            minerInstance.lastClaim = new Date(lastClaimDate.getTime() + timeToAdd);
            
            hasUpdates = true;
        }
    });

    if (hasUpdates && totalCredit > 0) {
        // Actualizar saldo del usuario
        user.balance.usdt = (user.balance.usdt || 0) + totalCredit;
        
        // Nota: No creamos una transacción individual por cada micro-ciclo para no llenar la DB.
        // Si quieres registro, descomenta esto:
        /*
        user.transactions.push({
            type: 'mining_claim',
            amount: totalCredit,
            currency: 'USDT',
            description: `Reclamo Automático (${totalCredit.toFixed(4)} USDT)`,
            status: 'completed',
            createdAt: new Date()
        });
        */
        
        await user.save();
        console.log(`[AutoClaim] Usuario ${user.username || user.telegramId}: Acreditados +${totalCredit.toFixed(4)} USDT.`);
    }
};

// --- GENERADOR DE TOKEN ---
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// --- SYNC USER (LOGIN/INICIO) ---
const syncUser = async (req, res) => {
    const { telegramUser } = req.body;
    if (!telegramUser || !telegramUser.id) { return res.status(400).json({ message: 'Datos incompletos.' }); }
    const telegramId = telegramUser.id.toString();
    
    try {
        const settings = await Setting.getSettings();
        if (settings.maintenanceMode) { return res.status(503).json({ inMaintenance: true, maintenanceMessage: settings.maintenanceMessage }); }
        
        // Buscar usuario con Populate para poder calcular ganancias
        let user = await User.findOne({ telegramId }).populate({ path: 'purchasedMiners.miner', model: 'Miner' });

        if (user && user.status === 'banned') { return res.status(403).json({ message: 'Cuenta suspendida.' }); }

        let photoFileId = null;
        // Intentar obtener foto más reciente de Telegram (Opcional, no crítico)
        try {
            const photosRes = await axios.get(`${TELEGRAM_API_URL}/getUserProfilePhotos`, { params: { user_id: telegramId, limit: 1 } });
            if (photosRes.data.ok && photosRes.data.result.total_count > 0) {
                photoFileId = photosRes.data.result.photos[0].slice(-1)[0].file_id;
            }
        } catch (e) { /* Silent fail */ }

        if (!user) {
            // === CREAR NUEVO USUARIO ===
            const username = telegramUser.username || `user_${telegramId}`;
            const fullName = `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim();
            
            // Asignar Minero Gratis (si existe)
            const initialMiners = [];
            const freeMiner = await Miner.findOne({ isFree: true }).lean();
            
            if (freeMiner) {
                const now = new Date();
                const expiry = new Date(now);
                expiry.setDate(expiry.getDate() + freeMiner.durationDays);
                // lastClaim es AHORA (Empieza a contar)
                initialMiners.push({ 
                    miner: freeMiner._id, 
                    purchaseDate: now, 
                    expiryDate: expiry, 
                    lastClaim: now 
                });
            }
            
            user = new User({ 
                telegramId, 
                username, 
                fullName, 
                language: telegramUser.language_code || 'es', 
                photoFileId, 
                purchasedMiners: initialMiners 
            });
            await user.save();
            
            // Refetch con populate para devolver estructura correcta
            user = await User.findById(user._id).populate({ path: 'purchasedMiners.miner', model: 'Miner' });

        } else {
            // === USUARIO EXISTENTE ===
            // Actualizar datos básicos si cambiaron en Telegram
            if (telegramUser.username) user.username = telegramUser.username;
            if (photoFileId) user.photoFileId = photoFileId;
            
            // PROCESAR COBROS AUTOMÁTICOS (LAZY CLAIM)
            await processAutomaticClaims(user);
        }

        const userObject = user.toObject();
        userObject.photoUrl = await getTemporaryPhotoUrl(user.photoFileId) || PLACEHOLDER_AVATAR_URL;
        const token = generateToken(user._id);

        res.status(200).json({ token, user: userObject, settings });

    } catch (error) {
        console.error('[Auth Sync] Error crítico:', error);
        return res.status(500).json({ message: 'Error de servidor.' });
    }
};

// --- OBTENER PERFIL (REFRESH) ---
const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate({ path: 'purchasedMiners.miner', model: 'Miner' });
        if (!user) { return res.status(404).json({ message: 'Usuario no encontrado' }); }
        
        // TRIGGER: Ejecutar cobro automático al refrescar
        await processAutomaticClaims(user);

        const settings = await Setting.getSettings();
        // Retornamos settings también por si cambiaron dinámicamente
        res.json({ user: user.toObject(), settings });
    } catch (error) { 
        console.error(error);
        res.status(500).json({ message: 'Error del servidor' }); 
    }
};

// --- FUNCIONES ADMIN (Mantener intactas si se usan en rutas) ---
const loginAdmin = async (req, res) => {
    const { username, password } = req.body;
    try {
        const admin = await User.findOne({ $or: [{ username }, { telegramId: username }]}).select('+password +passwordResetRequired');
        if (admin && admin.role === 'admin' && (await admin.matchPassword(password))) {
            res.json({ 
                token: generateToken(admin._id), 
                admin: { id: admin._id, role: admin.role, username: admin.username }, 
                passwordResetRequired: admin.passwordResetRequired 
            });
        } else {
            res.status(401).json({ message: 'Credenciales inválidas.' });
        }
    } catch (error) { res.status(500).json({ message: 'Error de servidor' }); }
};

const getAdminProfile = async (req, res) => { res.json(req.user); };

const updateAdminPassword = async(req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({message:'Mínimo 6 caracteres'});
    try {
        const admin = await User.findById(req.user.id).select('+password');
        admin.password = newPassword;
        admin.passwordResetRequired = false;
        await admin.save();
        res.json({ token: generateToken(admin._id), admin: { id: admin._id, role: admin.role, username: admin.username } });
    } catch (e) { res.status(500).json({message: 'Error'}); }
};

module.exports = { 
    syncUser, 
    getUserProfile, 
    loginAdmin, 
    getAdminProfile, 
    updateAdminPassword 
};
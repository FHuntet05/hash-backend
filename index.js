// RUTA: backend/index.js

const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const morgan = require('morgan');
const dotenv = require('dotenv');
const colors = require('colors');
const connectDB = require('./config/db');
const User = require('./models/userModel');
const Miner = require('./models/minerModel');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// Importamos las funciones del Monitor para Automatización
const { startMonitoring, forceScanNow } = require('./services/transactionMonitor.js');

// --- IMPORTACIÓN DE RUTAS ---
const authRoutes = require('./routes/authRoutes');
const rankingRoutes = require('./routes/rankingRoutes');
const walletRoutes = require('./routes/walletRoutes');
const teamRoutes = require('./routes/teamRoutes');
const taskRoutes = require('./routes/taskRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const treasuryRoutes = require('./routes/treasuryRoutes');
const userRoutes = require('./routes/userRoutes');
const minerRoutes = require('./routes/minerRoutes');

console.log('[SISTEMA] Iniciando aplicación MEGA FÁBRICA v15.0 (Full Integration)...'.cyan.bold);
dotenv.config();

// 1. Verificación de Variables de Entorno
function checkEnvVariables() {
    const requiredVars = [
        'MONGO_URI', 
        'JWT_SECRET', 
        'TELEGRAM_BOT_TOKEN', 
        'FRONTEND_URL', 
        'BACKEND_URL', 
        'ANKR_BSC_RPC_URL', 
        'MASTER_SEED_PHRASE'
    ];
    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        console.error(`!! ERROR FATAL: FALTAN VARIABLES DE ENTORNO: ${missingVars.join(', ')}`.red.bold);
        process.exit(1);
    }
    console.log('[SISTEMA] ✅ Variables de entorno verificadas.'.green);
}
checkEnvVariables();
connectDB();

// 2. Inicialización App y Bot
const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

app.disable('etag');
app.use(morgan('dev'));

// 3. Configuración CORS
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://localhost:3000',
    'https://web.telegram.org'
];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Origen bloqueado: ${origin}`);
            callback(new Error('No permitido por CORS'));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};
app.use(cors(corsOptions));

// Middleware para JSON (Crítico para Webhook)
app.use(express.json());

// ==========================================
// 🕒 RUTA DE CRON JOB (AUTOMATIZACIÓN)
// ==========================================
// Esta ruta será llamada por Vercel Cron cada 2 minutos
app.get('/api/cron/scan-deposits', async (req, res) => {
    console.log("⏰ [CRON JOB] Iniciando escaneo programado...");
    
    try {
        // Ejecutamos el escaneo y esperamos a que termine
        await forceScanNow();
        
        res.status(200).json({ 
            success: true, 
            message: 'Ciclo de escaneo de depósitos completado exitosamente.',
            timestamp: new Date().toISOString()
        });
        console.log("🏁 [CRON JOB] Escaneo finalizado correctamente.");
        
    } catch (error) {
        console.error("❌ [CRON ERROR]", error);
        // Respondemos 200 para evitar reintentos infinitos de Vercel
        res.status(200).json({ success: false, error: error.message }); 
    }
});

// ==========================================
// 🤖 LÓGICA DEL BOT TELEGRAM (/START)
// ==========================================

const WELCOME_MESSAGE = `👋 Bienvenido a NovMining ⚡

La nueva plataforma de minería de criptomonedas que combina innovación, seguridad y rentabilidad. 

💰 Beneficios al invertir:
- Obtén ganancias entre un 10% y 30%, dependiendo del monto de tu inversión.
- Recibe comisiones por referencia desde 8% hasta 1%, según el depósito realizado por tus invitados 

🔐 Seguridad garantizada:
Todos los fondos están protegidos y procesados directamente en la blockchain.

🚀 Con NovMining no solo inviertes, también construyes una red.`;

// Helper interno para crear usuario
const createUserInternal = async (telegramCtx) => {
    const referredId = telegramCtx.from.id.toString();
    const username = telegramCtx.from.username || `user_${referredId}`;
    const fullName = `${telegramCtx.from.first_name || ''} ${telegramCtx.from.last_name || ''}`.trim();

    const initialMiners = [];
    // Buscar si existe un minero configurado como "gratuito"
    try {
        const freeMiner = await Miner.findOne({ isFree: true }).lean();
        if (freeMiner) {
            const now = new Date();
            const expiry = new Date(now);
            expiry.setDate(expiry.getDate() + freeMiner.durationDays);
            initialMiners.push({ 
                miner: freeMiner._id, 
                purchaseDate: now, 
                expiryDate: expiry, 
                lastClaim: now 
            });
            console.log(`[Bot] Asignado minero gratis "${freeMiner.name}" al nuevo usuario.`);
        }
    } catch (e) {
        console.error("[Bot] Error buscando minero gratis:", e.message);
    }

    const newUser = new User({ 
        telegramId: referredId, 
        username, 
        fullName: fullName || username, 
        language: telegramCtx.from.language_code || 'es',
        purchasedMiners: initialMiners
    });
    
    await newUser.save();
    console.log(`[DB] Nuevo usuario guardado: ${newUser.username} (_id: ${newUser._id})`);
    return newUser;
};

bot.command('start', async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        
        // 1. EXTRACCIÓN ROBUSTA DEL PAYLOAD (CÓDIGO REFERIDO)
        let referrerCode = ctx.startPayload; // Intento 1: Payload nativo
        if (!referrerCode && ctx.message && ctx.message.text) {
            // Intento 2: Parsear texto manual "/start CODIGO"
            const parts = ctx.message.text.split(' ');
            if (parts.length > 1) {
                referrerCode = parts[1].trim();
            }
        }

        console.log(`🔹 [BOT /START] User: ${telegramId} | Payload Referente detectado: "${referrerCode || 'Ninguno'}"`);

        // 2. Buscar usuario existente o crear nuevo
        let user = await User.findOne({ telegramId });
        
        if (!user) {
            console.log(`[BOT] Usuario nuevo detectado. Iniciando registro...`);
            user = await createUserInternal(ctx);
        } else {
            console.log(`[BOT] Usuario existente (ID: ${user._id}).`);
        }

        // 3. LÓGICA DE REFERIDOS (Multinivel)
        // Condiciones: 
        // a) Existe código. 
        // b) No es autopromo. 
        // c) El usuario no tiene padre asignado todavía.
        if (referrerCode && referrerCode !== telegramId && !user.referredBy) {
            console.log(`[REFERRAL] Intentando vincular usuario con padre ID: ${referrerCode}`);
            
            // Buscar al padre por su ID de telegram o su Código de Referido (si implementamos códigos personalizados)
            const referrerUser = await User.findOne({ 
                $or: [ { telegramId: referrerCode }, { referralCode: referrerCode } ] 
            });
            
            if (referrerUser) {
                // A) Asignar padre al hijo
                user.referredBy = referrerUser._id;
                await user.save();

                // B) Agregar hijo a la lista del padre
                const alreadyChild = referrerUser.referrals.some(ref => ref.user.toString() === user._id.toString());
                
                if (!alreadyChild) {
                    referrerUser.referrals.push({
                        level: 1, // Directo
                        user: user._id,
                        createdAt: new Date()
                    });
                    await referrerUser.save();
                    console.log(`✅ [REFERRAL EXITOSO] ${referrerUser.username} es ahora el padre de ${user.username}`);
                    
                    // Notificación al Padre (Opcional, ignora errores si padre bloqueó bot)
                    try {
                        await ctx.telegram.sendMessage(referrerUser.telegramId, `🎉 <b>¡Nuevo Miembro en tu Equipo!</b>\n\nEl usuario <b>${user.username}</b> se ha unido con tu enlace.`, { parse_mode: 'HTML' });
                    } catch(e) { /* Silent fail */ }
                } else {
                    console.log(`[REFERRAL] La relación ya existía previamente.`);
                }
            } else {
                console.warn(`⚠️ [REFERRAL] El código "${referrerCode}" no pertenece a ningún usuario registrado.`);
            }
        }

        // 4. ENVÍO DE MENSAJE DE BIENVENIDA + APP
        try {
            const imageUrl = 'https://i.postimg.cc/W48w0986/photo-2025-11-22-14-02-02.jpg';
            await ctx.replyWithPhoto(imageUrl, {
                caption: WELCOME_MESSAGE,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        Markup.button.webApp('💎 EMPEZAR A GANAR', process.env.FRONTEND_URL)
                    ]]
                }
            });
        } catch (replyError) {
            // Si el error es 403 Forbidden, el usuario bloqueó al bot. No podemos hacer nada.
            if (replyError?.response?.error_code !== 403) {
                console.error('[BOT Reply Error]', replyError.message);
            } else {
                console.warn(`[BOT] No se pudo responder a ${telegramId} (Bot bloqueado).`);
            }
        }

    } catch (error) {
        console.error('❌ [BOT FATAL ERROR] en comando /start:', error);
    }
});

// ==========================================
// 5. ENRUTAMIENTO DE API
// ==========================================

const apiRouter = express.Router();
// Montar submódulos
apiRouter.use('/auth', authRoutes);
apiRouter.use('/ranking', rankingRoutes);
apiRouter.use('/wallet', walletRoutes);
apiRouter.use('/team', teamRoutes);
apiRouter.use('/tasks', taskRoutes);
apiRouter.use('/payment', paymentRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/treasury', treasuryRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/miners', minerRoutes);

// Prefijo Global /api
app.use('/api', apiRouter);

// ==========================================
// 6. WEBHOOK TELEGRAM (ENDPOINT MANUAL)
// ==========================================
const WEBHOOK_PATH = '/api/telegram-webhook';

app.post(WEBHOOK_PATH, async (req, res) => {
    // 1. Seguridad: Verificar Secreto
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    const mySecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (mySecret && secretHeader !== mySecret) {
        console.warn(`⛔ [Webhook] Intento no autorizado. IP: ${req.ip}`);
        return res.status(403).send('Acceso Denegado');
    }

    // 2. Procesar Update
    try {
        await bot.handleUpdate(req.body, res);
        
        // Telegraf suele manejar la respuesta (res), pero si no se ha enviado, confirmamos OK
        if (!res.headersSent) {
            res.status(200).send('OK');
        }
    } catch (err) {
        console.error('❌ [Webhook Error Interno]:', err);
        // Responder 200 aunque falle la lógica interna para evitar reintentos en bucle de Telegram
        if (!res.headersSent) {
            res.status(200).send('Error Handled');
        }
    }
});

// Ruta Raíz (Health Check)
app.get('/', (req, res) => res.send('NovMining Backend v15.0 Online 🟢'));

// Middlewares de Error Globales
app.use(notFound);
app.use(errorHandler);

// ==========================================
// 7. INICIO DEL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 5000;

if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
        console.log(`📡 Webhook Endpoint esperado: ${WEBHOOK_PATH}`);
        
        // Si estamos en LOCAL, iniciamos el monitor de bucle
        if (process.env.NODE_ENV !== 'production') {
            startMonitoring(); 
        } else {
            // Si estamos en PROD (Vercel), hacemos un intento inicial de escaneo (best effort)
            // El trabajo real lo hará el Cron Job a los 2 minutos.
            console.log(`☁️ Modo Producción: Delegando monitoreo a Cron Jobs.`);
            try {
                // Un escaneo rápido inicial por si acaso (timeout seguro)
                setTimeout(() => forceScanNow(), 1000); 
            } catch (e) { console.error("Error en arranque scan inicial", e); }
        }
    });
}

module.exports = app;
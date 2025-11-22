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
const { startMonitoring } = require('./services/transactionMonitor.js');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// --- RUTAS ---
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

console.log('[SISTEMA] Iniciando aplicación MEGA FÁBRICA v12.0 (Webhook Manual)...'.cyan.bold);
dotenv.config();

// 1. Verificación de Entorno
function checkEnvVariables() {
    const requiredVars = ['MONGO_URI', 'JWT_SECRET', 'TELEGRAM_BOT_TOKEN', 'FRONTEND_URL', 'BACKEND_URL', 'ANKR_BSC_RPC_URL', 'MASTER_SEED_PHRASE'];
    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        console.error(`!! ERROR FATAL: FALTAN VARIABLES: ${missingVars.join(', ')}`.red.bold);
        process.exit(1);
    }
    console.log('[SISTEMA] ✅ Variables de entorno verificadas.'.green);
}
checkEnvVariables();
connectDB();

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

app.disable('etag');
app.use(morgan('dev'));

// 2. Configuración CORS
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

// Middleware para parsear JSON (Vital para el Webhook)
app.use(express.json());

// ==================================================================
// 3. LÓGICA DEL BOT TELEGRAM
// ==================================================================

const WELCOME_MESSAGE = `
<b>Welcome to NovMining</b> 🚀

NovMining is a next-generation cloud mining platform where you can rent hash power to generate USDT daily.

<b>How it works:</b>
• Acquire Power Modules (GH/s).
• The system mines automatically 24/7.
• Claim your earnings every 12 hours.
• Withdraw directly to your wallet.

Start today and build your mining empire! 👇
`;

const handleNewUserCreation = async (ctx) => {
    const referredId = ctx.from.id.toString();
    console.log(`[Bot] Creando nuevo usuario: ${referredId}`);
    
    const username = ctx.from.username || `user_${referredId}`;
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    const initialMiners = [];
    // Buscar minero gratuito
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
        console.log(`[Bot] Minero gratuito asignado: ${freeMiner.name}`);
    }

    const newUser = new User({ 
        telegramId: referredId, 
        username, 
        fullName: fullName || username, 
        language: ctx.from.language_code || 'es',
        purchasedMiners: initialMiners
    });
    
    await newUser.save();
    return newUser;
};

bot.command('start', async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        const referrerCode = ctx.startPayload || null; // Parámetro tras /start

        console.log(`[Bot] /start de ${telegramId}. Referente: ${referrerCode}`);

        let user = await User.findOne({ telegramId });
        
        if (!user) {
            user = await handleNewUserCreation(ctx);
        }

        // Lógica de Referidos
        if (referrerCode && referrerCode !== telegramId && !user.referredBy) {
            const referrer = await User.findOne({ referralCode: referrerCode }) || await User.findOne({ telegramId: referrerCode });
            
            if (referrer) {
                user.referredBy = referrer._id;
                
                // Añadir a la lista del padre si no existe
                const alreadyReferral = referrer.referrals.some(r => r.user.toString() === user._id.toString());
                if (!alreadyReferral) {
                    referrer.referrals.push({ level: 1, user: user._id });
                    await referrer.save();
                }
                
                await user.save();
                console.log(`[Bot] Usuario ${telegramId} referido por ${referrer.username}`);
            }
        }

        // Respuesta al Usuario (Blindada contra errores de bloqueo)
        try {
            const imageUrl = 'https://ibb.co/Pvxvn51m'; // Tu imagen
            await ctx.replyWithPhoto(imageUrl, {
                caption: WELCOME_MESSAGE,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        Markup.button.webApp('💎 AUMENTAR POTENCIA', process.env.FRONTEND_URL)
                    ]]
                }
            });
        } catch (replyError) {
            if (replyError.response && replyError.response.error_code === 403) {
                console.warn(`[Bot] Usuario ${telegramId} ha bloqueado al bot. No se pudo responder.`);
            } else {
                console.error('[Bot] Error respondiendo:', replyError);
            }
        }

    } catch (error) {
        console.error('[Bot] Error fatal en /start:', error);
    }
});

// ==================================================================
// 4. CONFIGURACIÓN DEL SERVIDOR Y WEBHOOK MANUAL
// ==================================================================

const PORT = process.env.PORT || 5000;
const WEBHOOK_PATH = '/api/telegram-webhook';

// A) Montar rutas de API normales
const apiRouter = express.Router();
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

app.use('/api', apiRouter);

// B) Endpoint del Webhook (Manual)
app.post(WEBHOOK_PATH, async (req, res) => {
    // 1. Validar Secreto (Si existe en .env)
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        console.warn('[Webhook] Acceso denegado: Secreto incorrecto.');
        return res.status(403).send('Forbidden');
    }

    // 2. Procesar actualización
    try {
        await bot.handleUpdate(req.body, res);
        if (!res.headersSent) res.status(200).send('OK');
    } catch (err) {
        console.error('[Webhook] Error procesando update:', err);
        // Siempre responder 200 a Telegram para que no reintente infinitamente errores lógicos
        if (!res.headersSent) res.status(200).send('Error handled');
    }
});

// C) Endpoint raíz
app.get('/', (req, res) => res.send('NovMining Backend v12.0 Online 🟢'));

// 5. Manejo de Errores Global
app.use(notFound);
app.use(errorHandler);

// 6. Iniciar todo
if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
        console.log(`📡 Esperando Webhook en: ${WEBHOOK_PATH}`);
        
        // Iniciar monitor de transacciones
        startMonitoring();
    });
}

module.exports = app;
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

console.log('[SISTEMA] Iniciando aplicación MEGA FÁBRICA v13.0 (Ref System Fix)...'.cyan.bold);
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
            // Permitir peticiones sin origen (como curl o postman local en desarrollo)
            // callback(null, true); 
            console.warn(`[CORS] Origen bloqueado: ${origin}`);
            callback(new Error('No permitido por CORS'));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// ==================================================================
// 3. LÓGICA DEL BOT TELEGRAM (CORREGIDA Y ROBUSTA)
// ==================================================================

const WELCOME_MESSAGE = `👋 Bienvenido a NovMining ⚡

La nueva plataforma de minería de criptomonedas que combina innovación, seguridad y rentabilidad. 

💰 Beneficios al invertir:
- Obtén ganancias entre un 10% y 30% según inversión.
- Recibe comisiones por referencia (3 niveles).

🚀 Con NovMining no solo inviertes, también construyes una red.
`;

// Helper para crear usuario base
const createUserInternal = async (telegramCtx) => {
    const referredId = telegramCtx.from.id.toString();
    const username = telegramCtx.from.username || `user_${referredId}`;
    const fullName = `${telegramCtx.from.first_name || ''} ${telegramCtx.from.last_name || ''}`.trim();

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
    }

    const newUser = new User({ 
        telegramId: referredId, 
        username, 
        fullName: fullName || username, 
        language: telegramCtx.from.language_code || 'es',
        purchasedMiners: initialMiners
    });
    
    await newUser.save();
    console.log(`[DB] Usuario creado: ${newUser.username} (${newUser._id})`);
    return newUser;
};

bot.command('start', async (ctx) => {
    try {
        const telegramId = ctx.from.id.toString();
        
        // 1. EXTRACCIÓN ROBUSTA DEL PAYLOAD (ID DEL REFERENTE)
        // Probamos ctx.startPayload, o buscamos manualmente en el texto del mensaje "/start 12345"
        let referrerCode = ctx.startPayload;
        if (!referrerCode && ctx.message && ctx.message.text) {
            const parts = ctx.message.text.split(' ');
            if (parts.length > 1) {
                referrerCode = parts[1].trim();
            }
        }

        console.log(`🔹 [BOT /START] User: ${telegramId} | Payload Referente detectado: "${referrerCode || 'Ninguno'}"`);

        // 2. Buscar usuario o crear
        let user = await User.findOne({ telegramId });
        
        if (!user) {
            console.log(`[BOT] Usuario nuevo detectado.`);
            user = await createUserInternal(ctx);
        } else {
            console.log(`[BOT] Usuario existente.`);
        }

        // 3. LÓGICA DE REFERIDOS (Sólo si tiene código, no es él mismo y no tiene padre aún)
        if (referrerCode && referrerCode !== telegramId && !user.referredBy) {
            console.log(`[REFERRAL] Intentando vincular con el padre ID: ${referrerCode}`);
            
            // Buscamos al padre por telegramId
            const referrerUser = await User.findOne({ telegramId: referrerCode });
            
            if (referrerUser) {
                // A) Guardar en el HIJO quien es su padre
                user.referredBy = referrerUser._id;
                await user.save();

                // B) Guardar en el PADRE quien es su hijo (Si no está ya)
                const alreadyChild = referrerUser.referrals.some(ref => ref.user.toString() === user._id.toString());
                
                if (!alreadyChild) {
                    referrerUser.referrals.push({
                        level: 1,
                        user: user._id,
                        createdAt: new Date()
                    });
                    await referrerUser.save();
                    console.log(`✅ [REFERRAL EXITOSO] ${referrerUser.username} ahora es padre de ${user.username}`);
                    
                    // Opcional: Avisar al padre
                    try {
                        await ctx.telegram.sendMessage(referrerCode, `🎉 <b>¡Nuevo Referido!</b>\n\nEl usuario <b>${user.username}</b> se ha unido a tu equipo.`, { parse_mode: 'HTML' });
                    } catch(e) {}
                } else {
                    console.log(`[REFERRAL] Ya estaban vinculados.`);
                }
            } else {
                console.warn(`⚠️ [REFERRAL] El código de referido "${referrerCode}" no corresponde a ningún usuario existente.`);
            }
        } else if (user.referredBy) {
            console.log(`[REFERRAL] Este usuario ya tenía padre (ID: ${user.referredBy}).`);
        }

        // 4. RESPUESTA DE BIENVENIDA
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
            if (replyError?.response?.error_code !== 403) {
                console.error('[BOT Reply Error]', replyError.message);
            }
        }

    } catch (error) {
        console.error('❌ [BOT FATAL ERROR] en /start:', error);
    }
});

// ==================================================================
// 4. CONFIGURACIÓN SERVIDOR (Webhook Manual)
// ==================================================================

const PORT = process.env.PORT || 5000;
const WEBHOOK_PATH = '/api/telegram-webhook';

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

app.post(WEBHOOK_PATH, async (req, res) => {
    // 1. Validar Secreto (Si existe)
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        return res.status(403).send('Forbidden');
    }
    // 2. Procesar
    try {
        await bot.handleUpdate(req.body, res);
        if (!res.headersSent) res.status(200).send('OK');
    } catch (err) {
        console.error('[Webhook] Error interno:', err);
        if (!res.headersSent) res.status(200).send('Handled with error');
    }
});

app.get('/', (req, res) => res.send('Backend Online v13.0 🟢'));

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`🚀 Server port: ${PORT}`);
        console.log(`📡 Webhook endpoint: ${WEBHOOK_PATH}`);
        startMonitoring();
    });
}

module.exports = app;
// RUTA: backend/index.js (v2.4 - CORS Y ENRUTAMIENTO CORREGIDO)

const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const morgan = require('morgan');
const crypto = require('crypto');
const dotenv = require('dotenv');
const colors = require('colors');
const connectDB = require('./config/db');
const User = require('./models/userModel');
const Miner = require('./models/minerModel');
const { startMonitoring } = require('./services/transactionMonitor.js');

console.log('[SISTEMA] Iniciando aplicación MEGA FÁBRICA v11.0 (Entorno Serverless)...');
dotenv.config();

function checkEnvVariables() {
    console.log('[SISTEMA] Verificando variables de entorno críticas...');
    const requiredVars = ['MONGO_URI', 'JWT_SECRET', 'TELEGRAM_BOT_TOKEN', 'FRONTEND_URL', 'BACKEND_URL', 'ANKR_BSC_RPC_URL', 'BSCSCAN_API_KEY', 'MASTER_SEED_PHRASE'];
    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        console.error(`!! ERROR FATAL: FALTAN VARIABLES DE ENTORNO: ${missingVars.join(', ')}`.red.bold);
        throw new Error(`Variables de entorno faltantes: ${missingVars.join(', ')}`);
    }
    console.log('[SISTEMA] ✅ Todas las variables de entorno críticas están presentes.');
}
checkEnvVariables();
connectDB();

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
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

app.disable('etag');

// --- INICIO DE LA CORRECCIÓN DE CORS ---
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173'
];

const corsOptions = {
    origin: (origin, callback) => {
        console.log(`[CORS] Petición recibida del origen: ${origin}`);
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`[CORS] ❌ Origen RECHAZADO: '${origin}'. No está en la whitelist: ${allowedOrigins.join(', ')}`.red.bold);
            callback(new Error(`Origen no permitido por CORS: ${origin}`));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};
app.use(cors(corsOptions));
// --- FIN DE LA CORRECCIÓN DE CORS ---

app.use(express.json());

const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
const secretPath = `/api/telegram-webhook/${secretToken}`;
app.post(secretPath, (req, res) => {
    bot.handleUpdate(req.body, res);
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// --- INICIO DE LA CORRECCIÓN DE ENRUTAMIENTO ---
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
// --- FIN DE LA CORRECCIÓN DE ENRUTAMIENTO ---

const WELCOME_MESSAGE = `
Welcome to Hash PowerBot 

Hash PowerBot is a cloud mining platform that allows you to generate income with cryptocurrencies without needing your own hardware. Our goal is to provide easy, secure, and professional access to mining, directly through this bot.

 How it works
• Purchase hash power packages.  
• Our team manages rigs and pools to maximize efficiency.  
• Receive your rewards automatically based on the power you own.  
• Withdraw your earnings quickly and securely.  

 Why choose Hash PowerBot
• Instant access with no technical setup.  
• Professional infrastructure with 24/7 monitoring.  
• Transparency: regular reports and on-chain proofs.  
• Guaranteed security with encrypted systems.  
• 24/7 customer support through the official channel.  

 Hash PowerBot gives you professional access to cloud mining. Start today and become part of our mining community!`;

const handleNewUserCreation = async (ctx) => {
    const referredId = ctx.from.id.toString();
    console.log(`[Bot /start] Usuario ${referredId} no encontrado. Creando nuevo perfil.`);
    const username = ctx.from.username || `user_${referredId}`;
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    const initialMiners = [];
    const freeMiner = await Miner.findOne({ isFree: true }).lean();
    if (freeMiner) {
        const purchaseDate = new Date();
        const expiryDate = new Date(purchaseDate);
        expiryDate.setDate(expiryDate.getDate() + freeMiner.durationDays);
        initialMiners.push({ miner: freeMiner._id, purchaseDate, expiryDate, lastClaim: purchaseDate });
    } else {
        console.warn('[Bot /start] ADVERTENCIA: No se encontró minero "isFree". El usuario será creado sin minero inicial.'.yellow);
    }

    const newUser = new User({ 
        telegramId: referredId, 
        username, 
        fullName: fullName || username, 
        language: ctx.from.language_code || 'es',
        purchasedMiners: initialMiners
    });
    
    try {
        await newUser.save();
        console.log(`[Bot /start] ✅ Nuevo usuario ${referredId} guardado con _id: ${newUser._id}`.green);
        return newUser;
    } catch (dbError) {
        console.error(`[Bot /start] ❌ ERROR DE BASE DE DATOS AL GUARDAR NUEVO USUARIO ${referredId}:`.red.bold, dbError); 
        throw dbError; 
    }
};

bot.command('start', async (ctx) => {
    try {
        const referredId = ctx.from.id.toString();
        let referrerId = null;
        const startPayload = ctx.startPayload || (ctx.message.text.split(' ')[1] || null);
        if (startPayload) referrerId = startPayload.trim();
        
        console.log(`[Bot /start] Petición de inicio. Usuario: ${referredId}. Referente: ${referrerId}`.cyan);

        let user = await User.findOne({ telegramId: referredId });
        if (!user) { user = await handleNewUserCreation(ctx); }
        
        const canBeReferred = referrerId && referrerId !== referredId && !user.referredBy;
        if (canBeReferred) {
            const referrerUser = await User.findOne({ telegramId: referrerId });
            if (referrerUser) {
                user.referredBy = referrerUser._id;
                const isAlreadyInReferrals = referrerUser.referrals.some(ref => ref.user && ref.user.equals(user._id));
                if (!isAlreadyInReferrals) {
                    referrerUser.referrals.push({ level: 1, user: user._id });
                    await referrerUser.save();
                    await user.save();
                    console.log(`[Bot /start] Usuario ${referredId} enlazado al referente ${referrerId}.`);
                }
            }
        }
        
        const imageUrl = 'https://ibb.co/Pvxvn51m';
        const webAppUrl = process.env.FRONTEND_URL;
        
        await ctx.replyWithPhoto(imageUrl, {
            caption: WELCOME_MESSAGE,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[ Markup.button.webApp('💎 Abrir App', webAppUrl) ]] }
        });
        console.log(`[Bot /start] Mensaje de bienvenida (versión Minero) enviado a ${referredId}.`);

    } catch (error) {
        console.error('[Bot /start] ERROR FATAL EN EL COMANDO START:'.red.bold, error.message);
        await ctx.reply('Lo sentimos, ha ocurrido un error al procesar tu solicitud.');
    }
});

app.use(notFound);
app.use(errorHandler);

startMonitoring();

module.exports = app;
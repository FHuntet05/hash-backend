// RUTA: backend/index.js (v2.0 - SEMÁNTICA "MINER" Y RUTAS INTEGRADAS)

const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const morgan = require('morgan');
const crypto = require('crypto');
const dotenv = require('dotenv');
const colors = require('colors');
const connectDB = require('./config/db');
const User = require('./models/userModel');
const Miner = require('./models/minerModel'); // CAMBIO CRÍTICO: Se importa Miner en lugar de Factory.
const { startMonitoring } = require('./services/transactionMonitor.js');

console.log('[SISTEMA] Iniciando aplicación MEGA FÁBRICA v11.0...');
dotenv.config();

function checkEnvVariables() {
    console.log('[SISTEMA] Verificando variables de entorno críticas...');
    const requiredVars = ['MONGO_URI', 'JWT_SECRET', 'TELEGRAM_BOT_TOKEN', 'FRONTEND_URL', 'BACKEND_URL', 'ANKR_BSC_RPC_URL', 'BSCSCAN_API_KEY', 'MASTER_SEED_PHRASE'];
    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        console.error(`!! ERROR FATAL: FALTAN VARIABLES DE ENTORNO: ${missingVars.join(', ')}`.red.bold);
        process.exit(1);
    }
    console.log('[SISTEMA] ✅ Todas las variables de entorno críticas están presentes.');
}
checkEnvVariables();
connectDB();

// --- [INICIO REFACTORIZACIÓN DE IMPORTACIONES] ---
const authRoutes = require('./routes/authRoutes');
const rankingRoutes = require('./routes/rankingRoutes');
const walletRoutes = require('./routes/walletRoutes');
const teamRoutes = require('./routes/teamRoutes');
const taskRoutes = require('./routes/taskRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const treasuryRoutes = require('./routes/treasuryRoutes');
const userRoutes = require('./routes/userRoutes');
const minerRoutes = require('./routes/minerRoutes'); // CAMBIO CRÍTICO: Se importa minerRoutes
const { notFound, errorHandler } = require('./middleware/errorMiddleware');
// --- [FIN REFACTORIZACIÓN DE IMPORTACIONES] ---

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

app.disable('etag');

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173'
];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`[CORS] ❌ Origen RECHAZADO: '${origin}'. No está en la whitelist.`.red.bold);
            callback(new Error(`Origen no permitido por CORS: ${origin}`));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};

console.log(`[SISTEMA] Configurando CORS para permitir orígenes: ${allowedOrigins.join(', ')}`.cyan);
app.use(cors(corsOptions));

app.use(express.json());

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// --- [INICIO REFACTORIZACIÓN DE RUTAS] ---
app.use('/api/auth', authRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/treasury', treasuryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/miners', minerRoutes); // CAMBIO CRÍTICO: Se registra la ruta /api/miners.
// La ruta '/api/factories' queda eliminada.
// --- [FIN REFACTORIZACIÓN DE RUTAS] ---

// --- [Lógica del Bot de Telegram refactorizada a "Mineros"] ---
const WELCOME_MESSAGE = `
🤖 **¡Bienvenido a Mega Minería!**\n\n
💎 Tu centro de operaciones para la producción digital. Conecta, construye tu granja y genera ingresos pasivos en USDT.\n
📘 **¿Cómo funciona tu operación minera?**\n
🔹 **1. Adquiere tus Mineros**\n\n
🛒 Visita el mercado y compra diferentes tipos de mineros usando USDT. Cada uno tiene un poder de minado y vida útil únicos.\n
🔹 **2. Producción Automática 24/7**\n\n
⚙️ Una vez adquiridos, tus mineros empiezan a generar USDT automáticamente. ¡Incluso mientras duermes!\n
🔹 **3. Reclama tus Ganancias**\n\n
💰 Accede a tu panel y reclama la producción de tus mineros para añadirla a tu saldo principal.\n
🔹 **4. Construye tu Red**\n\n
🤝 Invita a otros mineros con tu enlace personal. Ganarás una comisión porcentual **cada vez** que tus referidos hagan un depósito.\n
🚀 **¿Listo para encender tu primer minero?**
🔘 Pulsa el botón inferior para abrir la aplicación y empezar a producir.`;

const handleNewUserCreation = async (ctx) => {
    const referredId = ctx.from.id.toString();
    console.log(`[Bot /start] Usuario ${referredId} no encontrado. Creando nuevo perfil.`);
    const username = ctx.from.username || `user_${referredId}`;
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    const initialMiners = [];
    const freeMiner = await Miner.findOne({ isFree: true }).lean(); // CAMBIO: Busca un Miner.
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
        purchasedMiners: initialMiners // CAMBIO: Asigna a purchasedMiners.
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
        
        const imageUrl = 'https://i.postimg.cc/qqFZGPVD/MGFAB.jpg';
        const webAppUrl = process.env.FRONTEND_URL;
        
        await ctx.replyWithPhoto(imageUrl, {
            caption: WELCOME_MESSAGE,
            parse_mode: 'HTML', // Cambiado a HTML para soportar <b> y otras etiquetas
            reply_markup: { inline_keyboard: [[ Markup.button.webApp('💎 Abrir App', webAppUrl) ]] }
        });
        console.log(`[Bot /start] Mensaje de bienvenida (versión Minero) enviado a ${referredId}.`);

    } catch (error) {
        console.error('[Bot /start] ERROR FATAL EN EL COMANDO START:'.red.bold, error.message);
        await ctx.reply('Lo sentimos, ha ocurrido un error al procesar tu solicitud.');
    }
});
// --- [Fin de la lógica del Bot] ---


bot.telegram.setMyCommands([{ command: 'start', description: 'Inicia la aplicación' }]);
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
const secretPath = `/api/telegram-webhook/${secretToken}`;
app.post(secretPath, (req, res) => bot.handleUpdate(req.body, res));

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, async () => {
    console.log(`[SERVIDOR] 🚀 Servidor corriendo en puerto ${PORT}`.yellow.bold);
    startMonitoring();
    try {
        const botInfo = await bot.telegram.getMe();
        console.log(`[SERVIDOR] ✅ Conectado como bot: ${botInfo.username}.`);
        const webhookUrl = `${process.env.BACKEND_URL}${secretPath}`;
        await bot.telegram.setWebhook(webhookUrl, { secret_token: secretToken, drop_pending_updates: true });
        console.log(`[SERVIDOR] ✅ Webhook configurado en: ${webhookUrl}`.green.bold);
    } catch (telegramError) {
        console.error("[SERVIDOR] ❌ ERROR AL CONFIGURAR TELEGRAM:", telegramError.message.red);
    }
});

process.on('unhandledRejection', (err, promise) => {
    console.error(`❌ ERROR NO MANEJADO: ${err.message}`.red.bold, err);
    server.close(() => process.exit(1));
});
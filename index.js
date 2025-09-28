// RUTA: backend/index.js (v2.1 - MODIFICADO PARA COMPATIBILIDAD CON VERCEL SERVERLESS)

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
        // En un entorno serverless, no podemos usar process.exit(1). El error se registrará en los logs de Vercel.
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

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173'
];

const corsOptions = {
    origin: (origin, callback) => {
        // En serverless, es mejor permitir el origen directamente si existe en la lista, o si no hay origen (peticiones de servidor a servidor).
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

// Ruta de health check para verificar que la función serverless está viva.
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/treasury', treasuryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/miners', minerRoutes);

// --- [INICIO Lógica del Bot de Telegram] ---
// Esta lógica se mantiene sin cambios, ya que está impulsada por eventos (comandos).
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
        
        const imageUrl = 'https://i.postimg.cc/qqFZGPVD/MGFAB.jpg';
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
// --- [FIN Lógica del Bot de Telegram] ---

// --- [MODIFICACIÓN PARA VERCEL] ---
// La configuración del webhook no puede estar en app.listen.
// En Vercel, el webhook se debe configurar UNA SOLA VEZ, ya sea manualmente
// o a través de un endpoint protegido. Por ahora, el código para establecer el webhook
// está desactivado. El bot seguirá funcionando si el webhook ya está configurado.
bot.telegram.setMyCommands([{ command: 'start', description: 'Inicia la aplicación' }]);
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
const secretPath = `/api/telegram-webhook/${secretToken}`;
app.post(secretPath, (req, res) => bot.handleUpdate(req.body, res));

app.use(notFound);
app.use(errorHandler);

// --- [MODIFICACIÓN CRÍTICA PARA VERCEL] ---
// Se ha eliminado el bloque `app.listen(...)` y `process.on('unhandledRejection', ...)`.
// Vercel gestiona el ciclo de vida del servidor. No necesitamos ni podemos escucharlo manualmente.

// El monitoreo de transacciones se inicia directamente al cargar el módulo.
// Esto se ejecutará cada vez que una instancia "fría" de la función serverless se inicie.
startMonitoring();

// Se exporta la instancia de la aplicación `app` para que Vercel pueda usarla.
module.exports = app;
// RUTA: backend/index.js (v1.5 - LÓGICA DE ONBOARDING ROBUSTA)

// --- IMPORTS Y CONFIGURACIÓN INICIAL (SIN CAMBIOS) ---
const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const morgan = require('morgan');
const crypto = require('crypto');
const dotenv = require('dotenv');
const colors = require('colors');
const connectDB = require('./config/db');
const User = require('./models/userModel');
const Factory = require('./models/factoryModel');
const { startMonitoring } = require('./services/transactionMonitor.js');

console.log('[SISTEMA] Iniciando aplicación MEGA FÁBRICA...');
dotenv.config();

function checkEnvVariables() {
    console.log('[SISTEMA] Verificando variables de entorno críticas...');
    const requiredVars = ['MONGO_URI', 'JWT_SECRET', 'TELEGRAM_BOT_TOKEN', 'FRONTEND_URL', 'BACKEND_URL', 'BSCSCAN_API_KEY', 'MASTER_SEED_PHRASE'];
    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        console.error(`!! ERROR FATAL: FALTAN VARIABLES DE ENTORNO: ${missingVars.join(', ')}`.red.bold);
        process.exit(1);
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
const factoryRoutes = require('./routes/factoryRoutes');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

app.disable('etag');
const whitelist = [process.env.FRONTEND_URL];
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.error(`[CORS] ❌ Origen RECHAZADO: '${origin}'. No está en la whitelist: [${whitelist.join(', ')}]`.red.bold);
            callback(new Error(`Origen no permitido por CORS: ${origin}`));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

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
app.use('/api/factories', factoryRoutes);


const WELCOME_MESSAGE = `
🤖 ¡Bienvenido a Mega Fábrica!\n\n
🏭 Tu centro de operaciones para la producción digital. Conecta, construye y genera ingresos pasivos en USDT.\n
📘 ¿Cómo funciona tu imperio industrial?\n
🔹 1. Adquiere tus Fábricas\n\n
🏗️ Visita la tienda y compra diferentes tipos de fábricas usando USDT. Cada una tiene una producción y vida útil únicas.\n
🔹 2. Producción Automática 24/7\n\n
⚙️ Una vez compradas, tus fábricas empiezan a generar USDT automáticamente. ¡Incluso mientras duermes!\n
🔹 3. Reclama tus Ganancias\n\n
💰 Accede a tu panel y reclama la producción de tus fábricas para añadirla a tu saldo principal.\n
🔹 4. Construye tu Red\n\n
🤝 Invita a otros industriales con tu enlace personal. Recibirás una comisión en USDT por la primera compra de cada referido.\n
🚀 ¿Listo para poner la primera piedra de tu imperio?
🔘 Pulsa el botón inferior para abrir la aplicación y empezar a construir.`;


// --- INICIO DE REFACTORIZACIÓN CRÍTICA DEL COMANDO /START ---
const handleNewUserCreation = async (ctx) => {
    const referredId = ctx.from.id.toString();
    console.log(`[Bot /start] Usuario ${referredId} no encontrado. Creando nuevo perfil.`);
    const username = ctx.from.username || `user_${referredId}`;
    const fullName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    const initialFactories = [];
    const freeFactory = await Factory.findOne({ isFree: true }).lean();
    if (freeFactory) {
        const purchaseDate = new Date();
        const expiryDate = new Date(purchaseDate);
        expiryDate.setDate(expiryDate.getDate() + freeFactory.durationDays);
        initialFactories.push({
            factory: freeFactory._id,
            purchaseDate,
            expiryDate,
            lastClaim: purchaseDate
        });
    } else {
        console.warn('[Bot /start] ADVERTENCIA: No se encontró fábrica "isFree".'.yellow);
    }

    const newUser = new User({ 
        telegramId: referredId, 
        username, 
        fullName: fullName || username, 
        language: ctx.from.language_code || 'es',
        purchasedFactories: initialFactories
    });
    
    // Guardamos al nuevo usuario INMEDIATAMENTE para obtener un _id válido.
    await newUser.save();
    console.log(`[Bot /start] Nuevo usuario ${referredId} guardado con _id: ${newUser._id}`);
    return newUser;
};


bot.command('start', async (ctx) => {
    try {
        const referredId = ctx.from.id.toString();
        let referrerId = null;
        const startPayload = ctx.startPayload || (ctx.message.text.split(' ')[1] || null);
        if (startPayload) {
            referrerId = startPayload.trim();
        }
        
        console.log(`[Bot /start] Petición de inicio. Usuario: ${referredId}. Referente: ${referrerId}`.cyan);

        // Paso 1: Buscar o crear el usuario que inició el bot.
        let user = await User.findOne({ telegramId: referredId });
        if (!user) {
            user = await handleNewUserCreation(ctx);
        }
        
        // Paso 2: Manejar la lógica de referidos solo si es aplicable.
        const canBeReferred = referrerId && referrerId !== referredId && !user.referredBy;
        if (canBeReferred) {
            const referrerUser = await User.findOne({ telegramId: referrerId });
            if (referrerUser) {
                user.referredBy = referrerUser._id;
                
                const isAlreadyInReferrals = referrerUser.referrals.some(ref => ref.user.equals(user._id));
                if (!isAlreadyInReferrals) {
                    referrerUser.referrals.push({ level: 1, user: user._id });
                    await referrerUser.save();
                    await user.save(); // Guardamos el campo 'referredBy' en el usuario referido.
                    console.log(`[Bot /start] Usuario ${referredId} enlazado al referente ${referrerId}.`);
                }
            }
        }
        
        // Paso 3: Enviar el mensaje de bienvenida.
        const imageUrl = 'https://i.postimg.cc/8PqYj4zR/nicebot.jpg';
        const webAppUrl = process.env.FRONTEND_URL;
        
        await ctx.replyWithPhoto(imageUrl, {
            caption: WELCOME_MESSAGE,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [ Markup.button.webApp('🏭 Abrir App', webAppUrl) ]
                ]
            }
        });
        console.log(`[Bot /start] Mensaje de bienvenida enviado a ${referredId}.`);

    } catch (error) {
        console.error('[Bot /start] ERROR FATAL EN EL COMANDO START:'.red.bold, error);
        await ctx.reply('Lo sentimos, ha ocurrido un error al procesar tu solicitud.');
    }
});
// --- FIN DE REFACTORIZACIÓN CRÍTICA ---


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
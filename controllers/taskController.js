const asyncHandler = require('express-async-handler');
const User = require('../models/userModel.js');

// Configuración: Tipos de tarea, recompensas y requisitos
const TASKS_CONFIG = {
    // TAREAS SOCIALES (Requieren acción externa)
    'JOIN_GROUP': { 
        type: 'SOCIAL_LINK', 
        reward: 0.1, 
        target: 1, 
        actionUrl: 'https://t.me/Nov_MiningGrup' // <--- PON TU LINK REAL AQUI
    },

    // TAREAS DE DEPÓSITO (Lógica financiera real)
    'REF_DEP_50':  { type: 'REFERRAL_DEPOSIT', amountRequired: 50,  reward: 2,    target: 1 },
    'REF_DEP_100': { type: 'REFERRAL_DEPOSIT', amountRequired: 100, reward: 5,    target: 1 },
    'REF_DEP_200': { type: 'REFERRAL_DEPOSIT', amountRequired: 200, reward: 15,   target: 1 },
    'REF_DEP_500': { type: 'REFERRAL_DEPOSIT', amountRequired: 500, reward: 50,   target: 1 },

    // OTRAS
    'OWN_DEP_10':  { type: 'OWN_DEPOSIT',      amountRequired: 10,  reward: 0.5,    target: 10 },
    'INVITE_10':   { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.1,  target: 10 },
    'INVITE_50':   { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.2,  target: 50 },
    'INVITE_100':  { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.3,  target: 100 },
    'INVITE_200':  { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.4,  target: 200 },
};

// Orden de aparición en el Frontend
const TASK_ORDER = Object.keys(TASKS_CONFIG);

// GET /api/tasks/status
const getTaskStatus = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const user = await User.findById(userId).select('referrals totalRecharge claimedTasks');

    if (!user) { res.status(404); throw new Error('Usuario no encontrado'); }

    // Consultas para referidos calificados (Que han depositado)
    // Esto busca referidos directos cuyo total recargado existe
    const qualifiedRefs = await User.find({ referredBy: userId }).select('totalRecharge');

    const responseTasks = TASK_ORDER.map(taskId => {
        const config = TASKS_CONFIG[taskId];
        let status = 'PENDING';
        let progress = 0;
        
        const isClaimed = user.claimedTasks && user.claimedTasks.has(taskId);

        if (isClaimed) {
            status = 'CLAIMED';
            progress = config.target;
        } else {
            // Lógica de cálculo de progreso
            if (config.type === 'SOCIAL_LINK') {
                // Las sociales siempre están pendientes hasta que el usuario las reclame
                // El frontend se encarga de desbloquear el botón
                progress = 0;
            } else if (config.type === 'REFERRAL_DEPOSIT') {
                // Cuántos referidos tienen totalRecharge >= monto requerido
                progress = qualifiedRefs.filter(r => (r.totalRecharge || 0) >= config.amountRequired).length;
            } else if (config.type === 'OWN_DEPOSIT') {
                progress = user.totalRecharge || 0;
            } else if (config.type === 'INVITE_COUNT') {
                progress = user.referrals.filter(r => r.level === 1).length;
            }

            if (progress >= config.target && config.type !== 'SOCIAL_LINK') {
                status = 'COMPLETED_NOT_CLAIMED';
            }
        }

        return {
            taskId,
            type: config.type,
            reward: config.reward,
            status,
            progress: Math.min(progress, config.target), // Visual cap
            target: config.target,
            actionUrl: config.actionUrl || (config.type.includes('DEPOSIT') ? '/deposit/select-network' : '/team')
        };
    });

    res.json(responseTasks);
});

// POST /api/tasks/claim
const claimTaskReward = asyncHandler(async (req, res) => {
    const { taskId } = req.body;
    const userId = req.user.id;
    const config = TASKS_CONFIG[taskId];

    if (!config) { res.status(400); throw new Error('Tarea no existente.'); }

    const user = await User.findById(userId);
    if (user.claimedTasks && user.claimedTasks.get(taskId)?.claimed) {
        res.status(400); throw new Error('Tarea ya reclamada.');
    }

    // Validación Estricta
    let requirementsMet = false;

    if (config.type === 'SOCIAL_LINK') {
        // Asumimos completada si llega la petición (Click-to-Verify)
        requirementsMet = true; 
    } else if (config.type === 'OWN_DEPOSIT') {
        requirementsMet = (user.totalRecharge || 0) >= config.amountRequired;
    } else if (config.type === 'INVITE_COUNT') {
        const count = user.referrals.filter(r => r.level === 1).length;
        requirementsMet = count >= config.target;
    } else if (config.type === 'REFERRAL_DEPOSIT') {
        const count = await User.countDocuments({ 
            referredBy: userId, 
            totalRecharge: { $gte: config.amountRequired } 
        });
        requirementsMet = count >= config.target;
    }

    if (!requirementsMet) {
        res.status(400); throw new Error('No cumples los requisitos para reclamar.');
    }

    // Pagar recompensa
    user.balance.usdt += config.reward;
    user.transactions.push({
        type: 'task_reward',
        amount: config.reward,
        currency: 'USDT',
        description: `Recompensa Misión: ${taskId}`
    });

    // Marcar completada
    if (!user.claimedTasks) user.claimedTasks = new Map();
    user.claimedTasks.set(taskId, { claimed: true, claimedAt: new Date() });

    await user.save();

    res.json({ 
        message: `¡Has ganado +${config.reward} USDT!`, 
        user: { balance: user.balance } // Retornamos solo lo necesario
    });
});

module.exports = { getTaskStatus, claimTaskReward };
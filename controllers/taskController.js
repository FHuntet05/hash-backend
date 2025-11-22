// backend/controllers/taskController.js

const asyncHandler = require('express-async-handler');
const User = require('../models/userModel.js');

// --- CONFIGURACIÓN MAESTRA DE TAREAS ---
const TASKS_CONFIG = {
    // 1. TAREAS DE DEPÓSITO DE REFERIDOS (El amigo deposita X)
    // 'target' aquí significa: Necesitas 1 amigo que cumpla la condición de dinero.
    
    'REF_DEP_50':  { type: 'REFERRAL_DEPOSIT', amountRequired: 50,  reward: 2,    target: 1, titleKey: 'ref_dep_50' },
    'REF_DEP_100': { type: 'REFERRAL_DEPOSIT', amountRequired: 100, reward: 5,    target: 1, titleKey: 'ref_dep_100' },
    'REF_DEP_200': { type: 'REFERRAL_DEPOSIT', amountRequired: 200, reward: 15,   target: 1, titleKey: 'ref_dep_200' },
    'REF_DEP_500': { type: 'REFERRAL_DEPOSIT', amountRequired: 500, reward: 50,   target: 1, titleKey: 'ref_dep_500' },

    // 2. TAREA DE DEPÓSITO PROPIO (Usuario deposita X)
    'OWN_DEP_10':  { type: 'OWN_DEPOSIT',      amountRequired: 10,  reward: 1,    target: 10, titleKey: 'own_dep_10' }, // Target es el monto

    // 3. TAREAS DE VOLUMEN DE REFERIDOS (Cantidad de invitados)
    'INVITE_10':   { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.1,  target: 10, titleKey: 'invite_10' },
    'INVITE_50':   { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.2,  target: 50, titleKey: 'invite_50' },
    'INVITE_100':  { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.3,  target: 100, titleKey: 'invite_100' },
    'INVITE_200':  { type: 'INVITE_COUNT',     amountRequired: 0,   reward: 0.4,  target: 200, titleKey: 'invite_200' },
};

// Orden en que aparecerán en la UI
const TASK_ORDER = [
    'REF_DEP_50', 'REF_DEP_100', 'REF_DEP_200', 'REF_DEP_500',
    'OWN_DEP_10',
    'INVITE_10', 'INVITE_50', 'INVITE_100', 'INVITE_200'
];

const getTaskStatus = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const user = await User.findById(userId).select('referrals totalRecharge claimedTasks');

    if (!user) { res.status(404); throw new Error('Usuario no encontrado'); }

    // Pre-calcular métricas para no hacer queries locas dentro del loop
    // 1. Total de referidos directos (Nivel 1)
    const directReferralsCount = user.referrals.filter(r => r.level === 1).length;

    // 2. Referidos cualificados (Query optimizada)
    // Buscamos cuántos referidos directos tienen depósitos acumulados
    // NOTA: Esto requiere que 'user.referrals' tenga los IDs. 
    // Haremos una query a la colección de Users buscando a los hijos.
    const qualifiedReferralsStats = await User.find({ 
        referredBy: userId 
    }).select('totalRecharge');

    const responseTasks = [];

    for (const taskId of TASK_ORDER) {
        const config = TASKS_CONFIG[taskId];
        let status = 'PENDING';
        let progress = 0;
        
        // Verificar si ya está reclamada
        const isClaimed = user.claimedTasks && user.claimedTasks.has(taskId);

        if (isClaimed) {
            status = 'CLAIMED';
            progress = config.target; // Visualmente lleno
        } else {
            // Lógica de cálculo según tipo
            if (config.type === 'REFERRAL_DEPOSIT') {
                // Cuenta cuántos referidos han depositado más de 'amountRequired'
                // Ej: Cuántos han depositado >= 50 USDT
                const qualifiedCount = qualifiedReferralsStats.filter(
                    child => (child.totalRecharge || 0) >= config.amountRequired
                ).length;
                
                progress = qualifiedCount;
                if (progress >= config.target) status = 'COMPLETED_NOT_CLAIMED';

            } else if (config.type === 'OWN_DEPOSIT') {
                // Progreso es el dinero depositado por el propio usuario
                progress = user.totalRecharge || 0;
                if (progress >= config.amountRequired) status = 'COMPLETED_NOT_CLAIMED';
                // Ajuste visual: Para Own Deposit, el target visual es el monto requerido
                // config.target en el JSON de arriba estaba confuso, usaremos amountRequired para display
            } else if (config.type === 'INVITE_COUNT') {
                // Simplemente contar referidos
                progress = directReferralsCount;
                if (progress >= config.target) status = 'COMPLETED_NOT_CLAIMED';
            }
        }

        // Ajuste final de props para el frontend
        let displayTarget = config.target;
        if (config.type === 'OWN_DEPOSIT') displayTarget = config.amountRequired;

        responseTasks.push({
            taskId,
            type: config.type,
            reward: config.reward,
            status,
            progress: Math.min(progress, displayTarget), // Cap visual
            target: displayTarget,
            // Action URL opcional
            actionUrl: config.type.includes('INVITE') || config.type.includes('REFERRAL') ? '/team' : '/deposit/select-network'
        });
    }

    res.json(responseTasks);
});

const claimTaskReward = asyncHandler(async (req, res) => {
    const { taskId } = req.body;
    const userId = req.user.id;
    const config = TASKS_CONFIG[taskId];

    if (!config) { res.status(400); throw new Error('Tarea no válida.'); }

    const user = await User.findById(userId);
    if (user.claimedTasks && user.claimedTasks.get(taskId)?.claimed) {
        res.status(400); throw new Error('Ya has reclamado esta recompensa.');
    }

    // Re-verificación de seguridad (Server-side validation)
    // Copiamos la lógica de verificación de getTaskStatus
    let isCompleted = false;

    if (config.type === 'REFERRAL_DEPOSIT') {
        const qualifiedCount = await User.countDocuments({ 
            referredBy: userId, 
            totalRecharge: { $gte: config.amountRequired } 
        });
        isCompleted = qualifiedCount >= config.target;

    } else if (config.type === 'OWN_DEPOSIT') {
        isCompleted = (user.totalRecharge || 0) >= config.amountRequired;

    } else if (config.type === 'INVITE_COUNT') {
        // Contamos array de referrals level 1
        const count = user.referrals.filter(r => r.level === 1).length;
        isCompleted = count >= config.target;
    }

    if (!isCompleted) {
        res.status(400); throw new Error('Requisitos no cumplidos.');
    }

    // Procesar Recompensa
    user.balance.usdt += config.reward;
    
    // Registrar transacción
    user.transactions.push({
        type: 'task_reward',
        amount: config.reward,
        currency: 'USDT',
        description: `Misión completada: ${taskId}`
    });

    // Marcar como reclamada
    if (!user.claimedTasks) user.claimedTasks = new Map();
    user.claimedTasks.set(taskId, { claimed: true, claimedAt: new Date() });

    await user.save();

    res.json({ 
        message: `¡+${config.reward} USDT Recibidos!`, 
        user: { balance: user.balance, claimedTasks: user.claimedTasks } // Devolver datos parciales
    });
});

module.exports = {
    getTaskStatus,
    claimTaskReward,
};
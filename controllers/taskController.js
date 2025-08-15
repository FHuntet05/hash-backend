// RUTA: backend/controllers/taskController.js (v26.0 - TAREAS SECUENCIALES)
const asyncHandler = require('express-async-handler');
const User = require('../models/userModel.js');
const Factory = require('../models/factoryModel.js'); 

const TASKS_CONFIG = {
    FIRST_PURCHASE: { title: "Primera Compra", description: "Compra cualquier fábrica en la tienda.", reward: 0.3, actionUrl: "/factories" },
    INVITE_3: { title: "Invitar 3 Amigos", description: "Tu equipo debe tener al menos 3 miembros de Nivel 1.", reward: 0.1, target: 3 },
    INVITE_5: { title: "Invitar 5 Amigos", description: "Tu equipo debe tener al menos 5 miembros de Nivel 1.", reward: 0.3, target: 5 },
    INVITE_10: { title: "Invitar 10 Amigos", description: "Tu equipo debe tener al menos 10 miembros de Nivel 1.", reward: 0.5, target: 10 },
    INVITE_20: { title: "Invitar 20 Amigos", description: "Tu equipo debe tener al menos 20 miembros de Nivel 1.", reward: 1.0, target: 20 },
    TELEGRAM_VISIT: { title: "Unirse a la Comunidad", description: "Visita nuestro grupo oficial de Telegram.", reward: 0.2, actionUrl: "https://t.me/MegaFabricaOficial" }
};

// --- INICIO DE NUEVA LÓGICA: ORDEN DE TAREAS ---
const INVITE_ORDER = ['INVITE_3', 'INVITE_5', 'INVITE_10', 'INVITE_20'];
// ---------------------------------------------

const getTaskStatus = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id)
        .select('purchasedFactories referrals claimedTasks telegramVisited')
        .populate('purchasedFactories.factory');

    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }

    const hasMadeFirstPurchase = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;

    const allTaskIds = Object.keys(TASKS_CONFIG);
    const responseTasks = [];

    for (const taskId of allTaskIds) {
        const task = TASKS_CONFIG[taskId];
        let isCompleted = false;
        let progress = 0;
        let status = 'PENDING';

        const isClaimed = user.claimedTasks.get(taskId) || false;

        // --- INICIO DE LÓGICA SECUENCIAL ---
        const inviteIndex = INVITE_ORDER.indexOf(taskId);
        if (inviteIndex > 0) {
            const previousTaskId = INVITE_ORDER[inviteIndex - 1];
            const isPreviousClaimed = user.claimedTasks.get(previousTaskId) || false;
            if (!isPreviousClaimed) {
                status = 'LOCKED'; // Nuevo estado para el frontend
            }
        }
        // --- FIN DE LÓGICA SECUENCIAL ---

        if (status !== 'LOCKED') {
            switch (taskId) {
                case 'FIRST_PURCHASE':
                    isCompleted = hasMadeFirstPurchase;
                    break;
                case 'TELEGRAM_VISIT':
                    isCompleted = true; 
                    break;
                default:
                    if (taskId.startsWith('INVITE_')) {
                        isCompleted = level1ReferralCount >= task.target;
                        progress = level1ReferralCount;
                    }
            }
    
            if (isClaimed) {
                status = 'CLAIMED';
            } else if (isCompleted) {
                status = 'COMPLETED_NOT_CLAIMED';
            }
        }

        responseTasks.push({
            taskId,
            title: task.title,
            description: task.description,
            reward: task.reward,
            status,
            progress: progress,
            target: task.target || 0,
            actionUrl: task.actionUrl || null
        });
    }
    
    // Reordenar para que las tareas de invitación siempre aparezcan en orden
    responseTasks.sort((a, b) => {
        const aIndex = INVITE_ORDER.indexOf(a.taskId);
        const bIndex = INVITE_ORDER.indexOf(b.taskId);
        if (aIndex > -1 && bIndex > -1) return aIndex - bIndex;
        return 0; // Mantener el orden relativo para otras tareas
    });

    res.json(responseTasks);
});


const claimTaskReward = asyncHandler(async (req, res) => {
    const { taskId } = req.body;
    const userId = req.user.id;

    const taskConfig = TASKS_CONFIG[taskId];
    if (!taskConfig) {
        res.status(400); throw new Error('Tarea no válida.');
    }

    const user = await User.findById(userId).populate('purchasedFactories.factory');
    if (!user) {
        res.status(404); throw new Error('Usuario no encontrado');
    }

    if (user.claimedTasks.get(taskId)) {
        res.status(400); throw new Error('Ya has reclamado esta recompensa.');
    }

    // Revalidación de lógica secuencial en el backend
    const inviteIndex = INVITE_ORDER.indexOf(taskId);
    if (inviteIndex > 0) {
        const previousTaskId = INVITE_ORDER[inviteIndex - 1];
        if (!user.claimedTasks.get(previousTaskId)) {
            res.status(400);
            throw new Error('Debes reclamar la recompensa de la tarea anterior primero.');
        }
    }

    let isCompleted = false;
    switch (taskId) {
        case 'FIRST_PURCHASE':
            isCompleted = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
            break;
        case 'TELEGRAM_VISIT':
            isCompleted = true;
            break;
        default:
            if (taskId.startsWith('INVITE_')) {
                const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;
                isCompleted = level1ReferralCount >= taskConfig.target;
            }
    }
    
    if (!isCompleted) {
        res.status(400); throw new Error('La tarea aún no está completada.');
    }
    
    const reward = taskConfig.reward;
    const transaction = {
        type: 'task_reward', amount: reward, currency: 'USDT', description: `Recompensa de tarea: ${taskConfig.title}`
    };

    const updateQuery = {
        $inc: { 'balance.usdt': reward },
        $set: { [`claimedTasks.${taskId}`]: true },
        $push: { transactions: transaction }
    };
    
    if (taskId === 'TELEGRAM_VISIT' && !user.telegramVisited) {
        updateQuery.$set.telegramVisited = true;
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateQuery, { new: true });

    res.json({ 
        message: `¡Recompensa de +${reward.toFixed(2)} USDT reclamada!`,
        user: updatedUser 
    });
});

module.exports = {
    getTaskStatus,
    claimTaskReward,
};
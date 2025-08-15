// RUTA: backend/controllers/taskController.js (v27.0 - TAREAS REINICIABLES)
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

const INVITE_ORDER = ['INVITE_3', 'INVITE_5', 'INVITE_10', 'INVITE_20'];

const getTaskStatus = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id)
        .select('purchasedFactories referrals claimedTasks telegramVisited')
        .populate('purchasedFactories.factory');

    if (!user) {
        res.status(404); throw new Error('Usuario no encontrado');
    }

    const hasMadeFirstPurchase = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;

    const responseTasks = [];
    let lastClaimedReferralCount = 0; // El contador empieza en cero

    for (const taskId of Object.keys(TASKS_CONFIG)) {
        const task = TASKS_CONFIG[taskId];
        let status = 'PENDING';
        let progress = 0;

        const isClaimed = user.claimedTasks.has(taskId);

        if (taskId.startsWith('INVITE_')) {
            const inviteIndex = INVITE_ORDER.indexOf(taskId);
            let previousTaskClaimed = true;
            if (inviteIndex > 0) {
                const previousTaskId = INVITE_ORDER[inviteIndex - 1];
                const prevTaskData = user.claimedTasks.get(previousTaskId);
                if (prevTaskData) {
                    lastClaimedReferralCount = prevTaskData.referralCountAtClaim;
                } else {
                    previousTaskClaimed = false;
                }
            }
            
            if (!previousTaskClaimed) {
                status = 'LOCKED';
            } else {
                // --- LÓGICA DE PROGRESO REINICIADO ---
                progress = Math.max(0, level1ReferralCount - lastClaimedReferralCount);
                const isCompleted = progress >= task.target;

                if (isClaimed) {
                    status = 'CLAIMED';
                } else if (isCompleted) {
                    status = 'COMPLETED_NOT_CLAIMED';
                }
            }
        } else { // Para tareas no relacionadas con invitaciones
            let isCompleted = false;
            if (taskId === 'FIRST_PURCHASE') isCompleted = hasMadeFirstPurchase;
            if (taskId === 'TELEGRAM_VISIT') isCompleted = true;

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

    if (user.claimedTasks.has(taskId)) {
        res.status(400); throw new Error('Ya has reclamado esta recompensa.');
    }

    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;
    let isCompleted = false;
    let lastClaimedReferralCount = 0;

    if (taskId.startsWith('INVITE_')) {
        const inviteIndex = INVITE_ORDER.indexOf(taskId);
        if (inviteIndex > 0) {
            const previousTaskId = INVITE_ORDER[inviteIndex - 1];
            const prevTaskData = user.claimedTasks.get(previousTaskId);
            if (!prevTaskData) {
                res.status(400); throw new Error('Debes reclamar la recompensa de la tarea anterior primero.');
            }
            lastClaimedReferralCount = prevTaskData.referralCountAtClaim;
        }
        const progress = level1ReferralCount - lastClaimedReferralCount;
        isCompleted = progress >= taskConfig.target;
    } else if (taskId === 'FIRST_PURCHASE') {
        isCompleted = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
    } else if (taskId === 'TELEGRAM_VISIT') {
        isCompleted = true;
    }
    
    if (!isCompleted) {
        res.status(400); throw new Error('La tarea aún no está completada.');
    }
    
    const reward = taskConfig.reward;
    const transaction = {
        type: 'task_reward', amount: reward, currency: 'USDT', description: `Recompensa de tarea: ${taskConfig.title}`
    };

    // --- LÓGICA DE GUARDADO DE SNAPSHOT ---
    const updateQuery = {
        $inc: { 'balance.usdt': reward },
        $set: { 
            [`claimedTasks.${taskId}`]: {
                claimed: true,
                referralCountAtClaim: taskId.startsWith('INVITE_') ? level1ReferralCount : undefined
            }
        },
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
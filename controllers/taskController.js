// RUTA: backend/controllers/taskController.js (v28.1 - SEMÁNTICA "MINERO")
const asyncHandler = require('express-async-handler');
const User = require('../models/userModel.js');
// CAMBIO CRÍTICO: Se importa 'minerModel' en lugar de 'factoryModel'.
const Miner = require('../models/minerModel.js'); 

// CAMBIO: La URL de acción para la primera compra ahora apunta a la ruta del mercado.
const TASKS_CONFIG = {
    FIRST_PURCHASE: { reward: 0.3, actionUrl: "/market" },
    INVITE_3: { reward: 0.1, target: 3 },
    INVITE_5: { reward: 0.3, target: 5 },
    INVITE_10: { reward: 0.5, target: 10 },
    INVITE_20: { reward: 1.0, target: 20 },
    TELEGRAM_VISIT: { reward: 0.1, actionUrl: "https://t.me/MegaFabricaOficial" } // Esta URL se puede actualizar si el nombre del canal cambió.
};

const INVITE_ORDER = ['INVITE_3', 'INVITE_5', 'INVITE_10', 'INVITE_20'];

const getTaskStatus = asyncHandler(async (req, res) => {
    // CAMBIO: Se seleccionan y populan los campos con la nueva semántica "miner".
    const user = await User.findById(req.user.id)
        .select('purchasedMiners referrals claimedTasks telegramVisited')
        .populate('purchasedMiners.miner');

    if (!user) {
        res.status(404); throw new Error('Usuario no encontrado');
    }

    // CAMBIO: La lógica ahora verifica 'purchasedMiners' y 'pm.miner'.
    const hasMadeFirstPurchase = user.purchasedMiners.some(pm => pm.miner && !pm.miner.isFree);
    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;

    const responseTasks = [];
    let lastClaimedReferralCount = 0;

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
                if (prevTaskData && prevTaskData.claimed) {
                    lastClaimedReferralCount = prevTaskData.referralCountAtClaim;
                } else {
                    previousTaskClaimed = false;
                }
            }
            if (!previousTaskClaimed) { status = 'LOCKED'; }
            else {
                progress = Math.max(0, level1ReferralCount - lastClaimedReferralCount);
                const isCompleted = progress >= task.target;
                if (isClaimed) { status = 'CLAIMED'; }
                else if (isCompleted) { status = 'COMPLETED_NOT_CLAIMED'; }
            }
        } else {
            let isCompleted = false;
            if (taskId === 'FIRST_PURCHASE') isCompleted = hasMadeFirstPurchase;
            if (taskId === 'TELEGRAM_VISIT') isCompleted = true; // Asumimos que si la tarea existe, la acción es posible.
            if (isClaimed) { status = 'CLAIMED'; }
            else if (isCompleted) { status = 'COMPLETED_NOT_CLAIMED'; }
        }
        
        responseTasks.push({
            taskId,
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

    if (!taskConfig) { res.status(400); throw new Error('Tarea no válida.'); }
    
    // CAMBIO: Se popula con la nueva semántica "miner".
    const user = await User.findById(userId).populate('purchasedMiners.miner');
    
    if (!user) { res.status(404); throw new Error('Usuario no encontrado'); }
    if (user.claimedTasks.has(taskId)) { res.status(400); throw new Error('Ya has reclamado esta recompensa.'); }

    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;
    let isCompleted = false;
    let lastClaimedReferralCount = 0;

    if (taskId.startsWith('INVITE_')) {
        const inviteIndex = INVITE_ORDER.indexOf(taskId);
        if (inviteIndex > 0) {
            const previousTaskId = INVITE_ORDER[inviteIndex - 1];
            const prevTaskData = user.claimedTasks.get(previousTaskId);
            if (!prevTaskData || !prevTaskData.claimed) { res.status(400); throw new Error('Debes reclamar la recompensa de la tarea anterior primero.'); }
            lastClaimedReferralCount = prevTaskData.referralCountAtClaim;
        }
        const progress = level1ReferralCount - lastClaimedReferralCount;
        isCompleted = progress >= taskConfig.target;
    } else if (taskId === 'FIRST_PURCHASE') {
        // CAMBIO: La lógica de verificación ahora usa 'purchasedMiners'.
        isCompleted = user.purchasedMiners.some(pm => pm.miner && !pm.miner.isFree);
    } else if (taskId === 'TELEGRAM_VISIT') {
        isCompleted = true;
    }

    if (!isCompleted) { res.status(400); throw new Error('La tarea aún no está completada.'); }

    const reward = taskConfig.reward;
    const transaction = { type: 'task_reward', amount: reward, currency: 'USDT', description: `Recompensa de tarea: ${taskId}` };
    const taskDataToSave = { claimed: true, referralCountAtClaim: taskId.startsWith('INVITE_') ? level1ReferralCount : undefined };
    
    user.balance.usdt += reward;
    user.transactions.push(transaction);
    user.claimedTasks.set(taskId, taskDataToSave);
    
    if (taskId === 'TELEGRAM_VISIT' && !user.telegramVisited) { 
        user.telegramVisited = true; 
    }
    
    const updatedUser = await user.save();
    res.json({ message: `¡Recompensa de +${reward.toFixed(2)} USDT reclamada!`, user: updatedUser });
});

module.exports = {
    getTaskStatus,
    claimTaskReward,
};

// RUTA: backend/controllers/taskController.js (v29.1 - "QUANTUM LEAP": 12 NIVELES DE TAREAS DEFINITIVOS)
const asyncHandler = require('express-async-handler');
const User = require('../models/userModel.js');
const Miner = require('../models/minerModel.js'); 

// --- INICIO DE MODIFICACIÓN CRÍTICA: NUEVA CONFIGURACIÓN DE TAREAS ---
// La configuración anterior se elimina. Ahora solo manejaremos tareas de invitación.
// VALORES ACTUALIZADOS SEGÚN SU DIRECTIVA.
const TASKS_CONFIG = {
    INVITE_1: { reward: 0.001, target: 1 },    // Invita 1 amigo
    INVITE_2: { reward: 0.003, target: 3 },    // Invita 3 amigos
    INVITE_3: { reward: 0.005, target: 5 },    // Invita 5 amigos
    INVITE_4: { reward: 0.007, target: 10 },   // Invita 10 amigos
    INVITE_5: { reward: 0.010, target: 20 },   // Invita 20 amigos
    INVITE_6: { reward: 0.03,  target: 50 },   // Invita 50 amigos
    INVITE_7: { reward: 0.05,  target: 100 },  // Invita 100 amigos
    INVITE_8: { reward: 0.10,  target: 150 },  // Invita 150 amigos
    INVITE_9: { reward: 0.30,  target: 200 },  // Invita 200 amigos
    INVITE_10: { reward: 0.60, target: 300 },  // Invita 300 amigos
    INVITE_11: { reward: 0.80, target: 500 },  // Invita 500 amigos
    INVITE_12: { reward: 1.00, target: 1000 }, // Invita 1000 amigos
};

// El orden secuencial de las tareas de invitación es ahora fundamental.
const INVITE_ORDER = [
    'INVITE_1', 'INVITE_2', 'INVITE_3', 'INVITE_4', 'INVITE_5', 'INVITE_6',
    'INVITE_7', 'INVITE_8', 'INVITE_9', 'INVITE_10', 'INVITE_11', 'INVITE_12'
];
// --- FIN DE MODIFICACIÓN CRÍTICA ---

const getTaskStatus = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id)
        .select('referrals claimedTasks');

    if (!user) {
        res.status(404); throw new Error('Usuario no encontrado');
    }

    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;

    const responseTasks = [];
    let lastClaimedReferralCount = 0;

    // La lógica itera sobre el nuevo orden de 12 tareas.
    for (const taskId of INVITE_ORDER) {
        const task = TASKS_CONFIG[taskId];
        let status = 'PENDING';
        let progress = 0;

        const isClaimed = user.claimedTasks.has(taskId);
        
        const inviteIndex = INVITE_ORDER.indexOf(taskId);
        let previousTaskClaimed = true;
        
        // Verifica que la tarea anterior haya sido reclamada para desbloquear la actual
        if (inviteIndex > 0) {
            const previousTaskId = INVITE_ORDER[inviteIndex - 1];
            const prevTaskData = user.claimedTasks.get(previousTaskId);
            if (prevTaskData && prevTaskData.claimed) {
                lastClaimedReferralCount = prevTaskData.referralCountAtClaim;
            } else {
                previousTaskClaimed = false;
            }
        }

        if (!previousTaskClaimed) { 
            status = 'LOCKED'; 
        } else {
            // El progreso se calcula sobre los referidos obtenidos DESPUÉS de reclamar la tarea anterior.
            progress = Math.max(0, level1ReferralCount - lastClaimedReferralCount);
            const isCompleted = progress >= task.target;
            
            if (isClaimed) { 
                status = 'CLAIMED'; 
            } else if (isCompleted) { 
                status = 'COMPLETED_NOT_CLAIMED'; 
            }
        }
        
        responseTasks.push({
            taskId,
            reward: task.reward,
            status,
            // CORRECCIÓN LÓGICA: El progreso ahora se muestra relativo al objetivo de la tarea actual.
            progress: Math.min(progress, task.target),
            target: task.target || 0,
            actionUrl: null // Las tareas de invitación no necesitan actionUrl
        });
    }
    res.json(responseTasks);
});

const claimTaskReward = asyncHandler(async (req, res) => {
    const { taskId } = req.body;
    const userId = req.user.id;
    const taskConfig = TASKS_CONFIG[taskId];

    if (!taskConfig || !taskId.startsWith('INVITE_')) { 
        res.status(400); throw new Error('Tarea no válida.'); 
    }
    
    const user = await User.findById(userId);
    
    if (!user) { res.status(404); throw new Error('Usuario no encontrado'); }
    if (user.claimedTasks.has(taskId)) { res.status(400); throw new Error('Ya has reclamado esta recompensa.'); }

    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;
    let isCompleted = false;
    let lastClaimedReferralCount = 0;

    const inviteIndex = INVITE_ORDER.indexOf(taskId);
    if (inviteIndex > 0) {
        const previousTaskId = INVITE_ORDER[inviteIndex - 1];
        const prevTaskData = user.claimedTasks.get(previousTaskId);
        if (!prevTaskData || !prevTaskData.claimed) { 
            res.status(400); throw new Error('Debes reclamar la recompensa de la tarea anterior primero.'); 
        }
        lastClaimedReferralCount = prevTaskData.referralCountAtClaim;
    }

    const progress = level1ReferralCount - lastClaimedReferralCount;
    isCompleted = progress >= taskConfig.target;
    
    if (!isCompleted) { res.status(400); throw new Error('La tarea aún no está completada.'); }

    const reward = taskConfig.reward;
    const transaction = { type: 'task_reward', amount: reward, currency: 'USDT', description: `Recompensa de tarea: ${taskId}` };
    
    // Guardamos el número de referidos en el momento del reclamo. Esto es CRUCIAL para la lógica secuencial.
    const taskDataToSave = { claimed: true, referralCountAtClaim: level1ReferralCount };
    
    user.balance.usdt += reward;
    user.transactions.push(transaction);
    user.claimedTasks.set(taskId, taskDataToSave);
    
    const updatedUser = await user.save();
    res.json({ message: `¡Recompensa de +${reward.toFixed(3)} USDT reclamada!`, user: updatedUser });
});

module.exports = {
    getTaskStatus,
    claimTaskReward,
};
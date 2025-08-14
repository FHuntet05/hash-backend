// RUTA: backend/controllers/taskController.js (v25.0 - LÓGICA DE NEGOCIO CORREGIDA)
const asyncHandler = require('express-async-handler');
const User = require('../models/userModel.js');
const Factory = require('../models/factoryModel.js'); // <-- IMPORTANTE: Necesitamos el modelo Factory

// --- CONFIGURACIÓN CENTRALIZADA DE TAREAS (Sin cambios) ---
const TASKS_CONFIG = {
    FIRST_PURCHASE: {
        title: "Primera Compra",
        description: "Compra cualquier fábrica en la tienda.",
        reward: 0.3,
        actionUrl: "/factories"
    },
    INVITE_3: {
        title: "Invitar 3 Amigos",
        description: "Tu equipo debe tener al menos 3 miembros de Nivel 1.",
        reward: 0.1,
        target: 3
    },
    INVITE_5: {
        title: "Invitar 5 Amigos",
        description: "Tu equipo debe tener al menos 5 miembros de Nivel 1.",
        reward: 0.3,
        target: 5
    },
    INVITE_10: {
        title: "Invitar 10 Amigos",
        description: "Tu equipo debe tener al menos 10 miembros de Nivel 1.",
        reward: 0.5,
        target: 10
    },
    INVITE_20: {
        title: "Invitar 20 Amigos",
        description: "Tu equipo debe tener al menos 20 miembros de Nivel 1.",
        reward: 1.0,
        target: 20
    },
    TELEGRAM_VISIT: {
        title: "Unirse a la Comunidad",
        description: "Visita nuestro grupo oficial de Telegram.",
        reward: 0.2,
        actionUrl: "https://t.me/MegaFabricaOficial"
    }
};

/**
 * @desc Obtiene el estado de todas las tareas para el usuario.
 * @route GET /api/tasks/status
 * @access Private
 */
const getTaskStatus = asyncHandler(async (req, res) => {
    // Populate nos permite acceder a los datos completos de cada fábrica
    const user = await User.findById(req.user.id)
        .select('purchasedFactories referrals claimedTasks telegramVisited')
        .populate('purchasedFactories.factory'); // <-- CAMBIO CLAVE

    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }

    // --- INICIO DE CORRECCIÓN: Lógica de "Primera Compra" ---
    // Ahora filtramos las fábricas para encontrar al menos una que NO sea gratuita.
    const hasMadeFirstPurchase = user.purchasedFactories.some(pf => pf.factory && !pf.factory.isFree);
    // --- FIN DE CORRECCIÓN ---

    const level1ReferralCount = user.referrals.filter(r => r.level === 1).length;

    const responseTasks = Object.keys(TASKS_CONFIG).map(taskId => {
        const task = TASKS_CONFIG[taskId];
        let isCompleted = false;
        let progress = 0;

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

        const isClaimed = user.claimedTasks.get(taskId) || false;
        let status = 'PENDING';
        if (isClaimed) {
            status = 'CLAIMED';
        } else if (isCompleted) {
            status = 'COMPLETED_NOT_CLAIMED';
        }

        return {
            taskId,
            title: task.title,
            description: task.description,
            reward: task.reward,
            status,
            progress: progress,
            target: task.target || 0,
            actionUrl: task.actionUrl || null
        };
    });

    res.json(responseTasks);
});

/**
 * @desc Reclama la recompensa de una tarea.
 * @route POST /api/tasks/claim
 * @access Private
 */
const claimTaskReward = asyncHandler(async (req, res) => {
    const { taskId } = req.body;
    const userId = req.user.id;

    const taskConfig = TASKS_CONFIG[taskId];
    if (!taskConfig) {
        res.status(400);
        throw new Error('Tarea no válida.');
    }

    const user = await User.findById(userId).populate('purchasedFactories.factory');
    if (!user) {
        res.status(404);
        throw new Error('Usuario no encontrado');
    }

    if (user.claimedTasks.get(taskId)) {
        res.status(400);
        throw new Error('Ya has reclamado esta recompensa.');
    }

    let isCompleted = false;
    switch (taskId) {
        case 'FIRST_PURCHASE':
            // Re-validamos con la lógica correcta en el servidor
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
        res.status(400);
        throw new Error('La tarea aún no está completada.');
    }
    
    const reward = taskConfig.reward;
    const transaction = {
        type: 'task_reward',
        amount: reward,
        currency: 'USDT',
        description: `Recompensa de tarea: ${taskConfig.title}`
    };

    const updateQuery = {
        $inc: { 'balance.usdt': reward },
        $set: { [`claimedTasks.${taskId}`]: true },
        $push: { transactions: transaction }
    };
    
    if (taskId === 'TELEGRAM_VISIT' && !user.telegramVisited) {
        updateQuery.$set.telegramVisited = true;
    }

    // --- INICIO DE CORRECCIÓN: Devolver el usuario actualizado ---
    // Usamos { new: true } para obtener el documento después de la actualización.
    const updatedUser = await User.findByIdAndUpdate(userId, updateQuery, { new: true });
    // --- FIN DE CORRECCIÓN ---

    res.json({ 
        message: `¡Recompensa de +${reward.toFixed(2)} USDT reclamada!`,
        user: updatedUser // Devolvemos el usuario con el saldo actualizado
    });
});

module.exports = {
    getTaskStatus,
    claimTaskReward,
};
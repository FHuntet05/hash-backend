// RUTA: backend/controllers/teamController.js

const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');

/**
 * Función auxiliar para obtener la estructura completa del árbol de referidos
 * Buscando en tiempo real en la base de datos para garantizar precisión.
 */
const getDownlineTree = async (rootUserId) => {
    // 1. NIVEL 1: Buscar usuarios donde 'referredBy' sea el ID del usuario actual
    const level1Users = await User.find({ referredBy: rootUserId })
                                  .select('_id username telegramId createdAt totalRecharge totalCommission photoFileId')
                                  .lean();
    
    const level1Ids = level1Users.map(u => u._id);

    // 2. NIVEL 2: Buscar usuarios donde 'referredBy' sea cualquiera de los del Nivel 1
    let level2Users = [];
    let level2Ids = [];
    if (level1Ids.length > 0) {
        level2Users = await User.find({ referredBy: { $in: level1Ids } })
                                .select('_id username telegramId createdAt totalRecharge totalCommission photoFileId')
                                .lean();
        level2Ids = level2Users.map(u => u._id);
    }

    // 3. NIVEL 3: Buscar usuarios donde 'referredBy' sea cualquiera de los del Nivel 2
    let level3Users = [];
    if (level2Ids.length > 0) {
        level3Users = await User.find({ referredBy: { $in: level2Ids } })
                                .select('_id username telegramId createdAt totalRecharge totalCommission photoFileId')
                                .lean();
    }

    return { level1Users, level2Users, level3Users };
};

// --- ESTADÍSTICAS (DASHBOARD DE EQUIPO) ---
const getTeamStats = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const user = await User.findById(userId); // Para obtener la comisión total global del usuario

    // Usamos la búsqueda robusta
    const { level1Users, level2Users, level3Users } = await getDownlineTree(userId);

    const totalMembers = level1Users.length + level2Users.length + level3Users.length;

    // Nota: La 'commission' desglosada por nivel aquí es un estimado si no usamos aggregation pipelines complejos.
    // Para simplificar y que funcione rápido, mostraremos la estructura de miembros correcta.
    // El frontend recibe el totalCommission global del usuario.

    res.json({
        totalTeamMembers: totalMembers,
        totalCommission: user.totalCommission || 0,
        levels: [
            { level: 1, totalMembers: level1Users.length, totalCommission: 0 },
            { level: 2, totalMembers: level2Users.length, totalCommission: 0 },
            { level: 3, totalMembers: level3Users.length, totalCommission: 0 }
        ]
    });
});

// --- DETALLES DE LA LISTA (AL SELECCIONAR UN TAB) ---
const getLevelDetails = asyncHandler(async (req, res) => {
    const level = parseInt(req.params.level);
    const userId = req.user.id;

    const { level1Users, level2Users, level3Users } = await getDownlineTree(userId);

    let targetMembers = [];

    if (level === 1) targetMembers = level1Users;
    else if (level === 2) targetMembers = level2Users;
    else if (level === 3) targetMembers = level3Users;

    // Mapeamos los datos para el frontend
    // NOTA: 'commissionGenerated' es cuánto TE generó este usuario.
    // Calcular esto históricamente requiere sumar transacciones. 
    // Como fallback rápido usamos un valor indicativo o 0 para no romper la vista.
    const formattedMembers = targetMembers.map(member => ({
        _id: member._id,
        username: member.username || `ID: ${member.telegramId}`,
        telegramId: member.telegramId,
        createdAt: member.createdAt,
        // Puedes mostrar 'totalRecharge' para saber si es un usuario activo que invierte
        totalRecharge: member.totalRecharge || 0, 
        commissionGenerated: 0 // Cálculo complejo pendiente, se deja en 0 para estabilidad visual
    }));

    // Ordenar por fecha, más nuevos primero
    formattedMembers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ members: formattedMembers });
});

module.exports = {
    getTeamStats,
    getLevelDetails
};
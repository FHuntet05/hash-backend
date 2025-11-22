// RUTA: backend/controllers/teamController.js

const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const mongoose = require('mongoose');

// --- ESTADÍSTICAS GENERALES (Cabecera TeamPage) ---
const getTeamStats = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) { 
        res.status(404); throw new Error("Usuario no encontrado"); 
    }

    // Cálculo rápido de contadores por nivel desde el array local
    const level1Count = user.referrals.filter(r => r.level === 1).length;
    const level2Count = user.referrals.filter(r => r.level === 2).length;
    const level3Count = user.referrals.filter(r => r.level === 3).length;

    // Suma de comisiones
    // NOTA: Para una suma exacta por nivel, se debería recorrer user.transactions filtando por tipo 'referral_commission'.
    // Aquí usamos totalCommission global para simplicidad, o desglosamos si es necesario.
    const totalCommission = user.totalCommission || 0;

    res.json({
        totalTeamMembers: user.referrals.length,
        totalCommission: totalCommission,
        levels: [
            { level: 1, totalMembers: level1Count, totalCommission: 0 }, // TODO: Implementar desglose fino si se requiere
            { level: 2, totalMembers: level2Count, totalCommission: 0 },
            { level: 3, totalMembers: level3Count, totalCommission: 0 }
        ]
    });
});

// --- DETALLES POR NIVEL (Lista TeamPage) ---
const getLevelDetails = asyncHandler(async (req, res) => {
    const level = parseInt(req.params.level);
    const userId = req.user.id;

    // 1. Obtener al usuario padre
    const currentUser = await User.findById(userId).select('referrals');
    
    if (!currentUser) return res.json({ members: [] });

    // 2. Filtrar los IDs de los usuarios que están en el nivel solicitado
    const referralIdsInLevel = currentUser.referrals
        .filter(ref => ref.level === level)
        .map(ref => ref.user);

    if (referralIdsInLevel.length === 0) {
        return res.json({ members: [] });
    }

    // 3. Buscar DATOS REALES de esos hijos (Fix Lista Vacía)
    // Traemos username, fecha de ingreso y su propio total recargado (como indicador)
    const members = await User.find({
        '_id': { $in: referralIdsInLevel }
    })
    .select('username telegramId createdAt totalRecharge photoFileId')
    .lean();

    // 4. Mapear para respuesta limpia
    const formattedMembers = members.map(member => {
        // Aquí intentamos calcular cuánto nos generó este usuario
        // Como optimización, por ahora enviamos 0 o un cálculo estimado
        // Lo importante es que aparezca en la lista
        return {
            _id: member._id,
            username: member.username || `User ${member.telegramId.substring(0,6)}...`,
            telegramId: member.telegramId,
            createdAt: member.createdAt,
            commissionGenerated: 0 // Se podría cruzar con transactions del padre
        };
    });

    res.json({ members: formattedMembers });
});

module.exports = {
    getTeamStats,
    getLevelDetails
};
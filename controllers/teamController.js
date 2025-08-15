// backend/controllers/teamController.js (v23.1 - LÓGICA DE CÁLCULO EN JS ROBUSTA)

const User = require('../models/userModel');
const mongoose = require('mongoose');

const getTeamStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    // --- INICIO DE REESCRITURA COMPLETA DE LA LÓGICA ---

    // 1. Obtener el usuario con todos sus referidos y transacciones de una sola vez.
    const user = await User.findById(userId)
      .select('referrals transactions') // Solo seleccionamos lo que necesitamos
      .populate({
        path: 'referrals.user',
        select: 'referrals', // Para contar niveles 2 y 3
        populate: {
          path: 'referrals.user',
          select: 'referrals',
          populate: {
            path: 'referrals.user',
            select: '_id' // No necesitamos más datos del nivel 3
          }
        }
      }).lean();

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // 2. Contar los miembros del equipo por nivel (Lógica sin cambios, sigue siendo eficiente)
    const membersByLevel = { 1: 0, 2: 0, 3: 0 };
    (user.referrals || []).forEach(ref1 => {
      if (ref1.user) {
        membersByLevel[1]++;
        (ref1.user.referrals || []).forEach(ref2 => {
          if (ref2.user) {
            membersByLevel[2]++;
            (ref2.user.referrals || []).forEach(ref3 => {
              if (ref3.user) {
                membersByLevel[3]++;
              }
            });
          }
        });
      }
    });

    // 3. Calcular las comisiones iterando en JavaScript (Método robusto y directo)
    const commissionsByLevel = { 1: 0, 2: 0, 3: 0 };
    let totalCommission = 0;

    const commissionTransactions = user.transactions.filter(
      tx => tx.type === 'referral_commission'
    );

    for (const tx of commissionTransactions) {
      const level = tx.metadata?.commissionLevel;
      if (level && commissionsByLevel.hasOwnProperty(level)) {
        commissionsByLevel[level] += tx.amount;
        totalCommission += tx.amount;
      }
    }
    
    // --- FIN DE REESCRITURA COMPLETA DE LA LÓGICA ---

    // 4. Construir el objeto de respuesta final
    const stats = {
      totalTeamMembers: membersByLevel[1] + membersByLevel[2] + membersByLevel[3],
      totalCommission: totalCommission,
      levels: [
        { level: 1, totalMembers: membersByLevel[1], totalCommission: commissionsByLevel[1] },
        { level: 2, totalMembers: membersByLevel[2], totalCommission: commissionsByLevel[2] },
        { level: 3, totalMembers: membersByLevel[3], totalCommission: commissionsByLevel[3] },
      ],
    };

    res.json(stats);

  } catch (error) {
    console.error("Error al obtener estadísticas del equipo:", error);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

const getLevelDetails = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const requestedLevel = parseInt(req.params.level, 10);
    if (![1, 2, 3].includes(requestedLevel)) { return res.status(400).json({ message: 'Nivel no válido.' }); }
    const user = await User.findById(userId).populate({ path: 'referrals.user', select: 'username photoFileId balance referrals', populate: { path: 'referrals.user', select: 'username photoFileId balance referrals', populate: { path: 'referrals.user', select: 'username photoFileId balance' } } });
    if (!user) { return res.json([]); }
    let levelMembers = [];
    if (requestedLevel === 1) { levelMembers = user.referrals.map(r => r.user); }
    else if (requestedLevel === 2) { user.referrals.forEach(r1 => { if (r1.user && r1.user.referrals) { levelMembers.push(...r1.user.referrals.map(r2 => r2.user)); } }); }
    else if (requestedLevel === 3) { user.referrals.forEach(r1 => { if (r1.user && r1.user.referrals) { r1.user.referrals.forEach(r2 => { if (r2.user && r2.user.referrals) { levelMembers.push(...r2.user.referrals.map(r3 => r3.user)); } }); } }); }
    const finalResponse = levelMembers.filter(Boolean).map(member => ({ username: member.username, photoUrl: member.photoUrl, score: parseFloat((member.balance?.usdt || 0).toFixed(2)) }));
    res.json(finalResponse);
  } catch (error) {
    console.error(`Error al obtener detalles del nivel ${req.params.level}:`, error);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

module.exports = { getTeamStats, getLevelDetails };
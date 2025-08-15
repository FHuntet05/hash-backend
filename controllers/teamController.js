// RUTA: backend/controllers/teamController.js (v23.2 - AUDITORÍA Y VALIDACIÓN FINAL)

const User = require('../models/userModel');
const mongoose = require('mongoose');

const getTeamStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    const user = await User.findById(userId)
      .select('referrals transactions')
      .populate({
        path: 'referrals.user',
        select: 'referrals',
        populate: {
          path: 'referrals.user',
          select: 'referrals',
          populate: {
            path: 'referrals.user',
            select: '_id'
          }
        }
      }).lean();

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

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
    
    const stats = {
      totalTeamMembers: membersByLevel[1] + membersByLevel[2] + membersByLevel[3],
      totalCommission: totalCommission,
      levels: [
        { level: 1, totalMembers: membersByLevel[1], totalCommission: commissionsByLevel[1] },
        { level: 2, totalMembers: membersByLevel[2], totalCommission: commissionsByLevel[2] },
        { level: 3, totalMembers: membersByLevel[3], totalCommission: commissionsByLevel[3] },
      ],
    };

    // --- LOG DE AUDITORÍA AÑADIDO ---
    console.log(`[TeamStats] ✅ Datos generados para usuario ${userId}. Comisión Total: ${totalCommission}. Enviando respuesta...`.green);
    // --- FIN DEL LOG AÑADIDO ---

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
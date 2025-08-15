// backend/controllers/teamController.js (v23.0 - LÓGICA DE ESTADÍSTICAS POR AGREGACIÓN)

const User = require('../models/userModel');
const mongoose = require('mongoose');

const getTeamStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    // 1. Obtener la jerarquía completa de referidos del usuario
    const userWithTeam = await User.findById(userId)
      .populate({
        path: 'referrals.user',
        select: '_id referrals',
        populate: {
          path: 'referrals.user',
          select: '_id referrals',
          populate: {
            path: 'referrals.user',
            select: '_id'
          }
        }
      }).lean();

    if (!userWithTeam) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // 2. Aplanar la estructura de referidos y contar miembros por nivel
    const membersByLevel = { 1: 0, 2: 0, 3: 0 };
    (userWithTeam.referrals || []).forEach(ref1 => {
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

    // --- INICIO DE LÓGICA DE CÁLCULO DE COMISIONES POR AGREGACIÓN ---
    // 3. Usamos el framework de agregación de MongoDB para un cálculo eficiente.
    const commissionStats = await User.aggregate([
      // Paso A: Encontrar al usuario actual
      { $match: { _id: userId } },
      
      // Paso B: "Desenredar" el array de transacciones para procesar cada una individualmente
      { $unwind: '$transactions' },
      
      // Paso C: Filtrar solo las transacciones que son de comisiones de referido
      { $match: { 'transactions.type': 'referral_commission' } },
      
      // Paso D: Agrupar por nivel de comisión y sumar los montos
      {
        $group: {
          _id: '$transactions.metadata.commissionLevel', // Agrupar por Nivel 1, 2, o 3
          totalAmount: { $sum: '$transactions.amount' }   // Sumar el monto de cada comisión
        }
      }
    ]);

    // 4. Formatear los resultados de la agregación en un objeto fácil de usar
    const commissionsByLevel = { 1: 0, 2: 0, 3: 0 };
    let totalCommission = 0;
    commissionStats.forEach(stat => {
      if (stat._id) { // stat._id contendrá el nivel (1, 2, 3)
        commissionsByLevel[stat._id] = stat.totalAmount;
        totalCommission += stat.totalAmount;
      }
    });
    // --- FIN DE LÓGICA DE CÁLCULO DE COMISIONES POR AGREGACIÓN ---

    // 5. Construir el objeto de respuesta final
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

// Se mantiene la función getLevelDetails sin cambios, ya que su propósito es diferente.
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
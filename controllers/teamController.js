// backend/controllers/teamController.js (v22.0 - LÓGICA DE ESTADÍSTICAS RECONSTRUIDA)

const User = require('../models/userModel');
const Transaction = require('../models/transactionModel');
const mongoose = require('mongoose');

const getTeamStats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    // 1. Obtener la jerarquía completa de referidos del usuario
    const userWithTeam = await User.findById(userId)
        .select('referrals')
        .populate({
            path: 'referrals.user',
            select: '_id username referrals', // Seleccionar solo lo necesario
            populate: {
                path: 'referrals.user',
                select: '_id username referrals',
                populate: {
                    path: 'referrals.user',
                    select: '_id username'
                }
            }
        }).lean(); // .lean() para un rendimiento óptimo

    if (!userWithTeam) {
        return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // 2. Organizar a los miembros y sus IDs por nivel
    const teamMembersByLevel = { 1: [], 2: [], 3: [] };
    const allTeamMemberIds = [];

    (userWithTeam.referrals || []).forEach(ref1 => {
        if (!ref1.user) return;
        teamMembersByLevel[1].push(ref1.user);
        allTeamMemberIds.push(ref1.user._id);

        (ref1.user.referrals || []).forEach(ref2 => {
            if (!ref2.user) return;
            teamMembersByLevel[2].push(ref2.user);
            allTeamMemberIds.push(ref2.user._id);

            (ref2.user.referrals || []).forEach(ref3 => {
                if (!ref3.user) return;
                teamMembersByLevel[3].push(ref3.user);
                allTeamMemberIds.push(ref3.user._id);
            });
        });
    });

    // 3. Obtener todas las comisiones generadas por el equipo de una sola vez
    const commissionTransactions = await Transaction.find({
        user: userId, // Comisiones pagadas A MI
        type: 'commission',
        'metadata.buyerId': { $in: allTeamMemberIds } // generadas POR alguien de mi equipo
    }).select('amount metadata.buyerId').lean();

    // 4. Procesar los datos para calcular las comisiones por nivel
    const commissionsByLevel = { 1: 0, 2: 0, 3: 0 };
    const memberIdsLevel1 = new Set(teamMembersByLevel[1].map(u => u._id.toString()));
    const memberIdsLevel2 = new Set(teamMembersByLevel[2].map(u => u._id.toString()));
    const memberIdsLevel3 = new Set(teamMembersByLevel[3].map(u => u._id.toString()));

    commissionTransactions.forEach(tx => {
        const buyerIdStr = tx.metadata.buyerId.toString();
        if (memberIdsLevel1.has(buyerIdStr)) {
            commissionsByLevel[1] += tx.amount;
        } else if (memberIdsLevel2.has(buyerIdStr)) {
            commissionsByLevel[2] += tx.amount;
        } else if (memberIdsLevel3.has(buyerIdStr)) {
            commissionsByLevel[3] += tx.amount;
        }
    });

    // 5. Construir el objeto de respuesta final
    const stats = {
        totalTeamMembers: allTeamMemberIds.length,
        totalCommission: commissionTransactions.reduce((sum, tx) => sum + tx.amount, 0),
        // Los campos totalTeamRecharge y totalTeamWithdrawals se eliminan por ser
        // computacionalmente caros y de bajo valor informativo en la vista principal.
        // Se pueden reintroducir en un reporte más detallado si es necesario.
        levels: [
            { level: 1, totalMembers: teamMembersByLevel[1].length, totalCommission: commissionsByLevel[1] },
            { level: 2, totalMembers: teamMembersByLevel[2].length, totalCommission: commissionsByLevel[2] },
            { level: 3, totalMembers: teamMembersByLevel[3].length, totalCommission: commissionsByLevel[3] },
        ],
    };

    res.json(stats);

  } catch (error) {
    console.error("Error al obtener estadísticas del equipo:", error);
    res.status(500).json({ message: 'Error del servidor' });
  }
};


// La función getLevelDetails está desactualizada (usa 'miningRate') pero la dejaremos por ahora
// ya que el frontend podría usarla para mostrar la lista de miembros. Se puede refactorizar más tarde.
const getLevelDetails = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const requestedLevel = parseInt(req.params.level, 10);

    if (![1, 2, 3].includes(requestedLevel)) {
      return res.status(400).json({ message: 'Nivel no válido.' });
    }

    const user = await User.findById(userId).populate({
      path: 'referrals.user',
      select: 'username photoFileId balance referrals',
      populate: {
        path: 'referrals.user',
        select: 'username photoFileId balance referrals',
        populate: {
          path: 'referrals.user',
          select: 'username photoFileId balance'
        }
      }
    });

    if (!user) {
      return res.json([]);
    }

    let levelMembers = [];

    if (requestedLevel === 1) {
      levelMembers = user.referrals.map(r => r.user);
    } else if (requestedLevel === 2) {
      user.referrals.forEach(r1 => {
        if (r1.user && r1.user.referrals) {
          levelMembers.push(...r1.user.referrals.map(r2 => r2.user));
        }
      });
    } else if (requestedLevel === 3) {
      user.referrals.forEach(r1 => {
        if (r1.user && r1.user.referrals) {
          r1.user.referrals.forEach(r2 => {
            if (r2.user && r2.user.referrals) {
              levelMembers.push(...r2.user.referrals.map(r3 => r3.user));
            }
          });
        }
      });
    }

    const finalResponse = levelMembers
      .filter(Boolean)
      .map(member => ({
        username: member.username,
        photoUrl: member.photoUrl, // Este campo necesita ser populado con getTemporaryPhotoUrl
        score: parseFloat((member.balance?.usdt || 0).toFixed(2))
      }));

    res.json(finalResponse);

  } catch (error) {
    console.error(`Error al obtener detalles del nivel ${req.params.level}:`, error);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

module.exports = { getTeamStats, getLevelDetails };
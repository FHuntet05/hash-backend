// backend/services/commissionService.js (VERSIÓN MEGA FÁBRICA v1.0 - COMISIONES ACTUALIZADAS)

const User = require('../models/userModel');
const { createTransaction } = require('../utils/transactionLogger');
const mongoose = require('mongoose');

/**
 * Distribuye comisiones fijas por referido a través de la cadena de hasta 3 niveles.
 * Esta función es atómica para cada referente, pero se ejecuta de forma asíncrona para toda la cadena.
 *
 * @param {mongoose.Document} buyer - El documento del usuario que realizó la compra, para obtener su `_id` y `username`.
 * @param {Number} purchaseAmount - El monto total de la compra que generó estas comisiones.
 * @param {mongoose.ClientSession} [session] - Sesión opcional de Mongoose para operaciones transaccionales.
 */
const distributeReferralCommissions = async (buyer, purchaseAmount, session) => {
  try {
    // REGLA DE NEGOCIO ACTUALIZADA: Nuevas comisiones fijas de "Mega Fábrica".
    const FIXED_COMMISSIONS = {
      1: 0.30, // 0.30 USDT para el Nivel 1
      2: 0.20, // 0.20 USDT para el Nivel 2
      3: 0.10, // 0.10 USDT para el Nivel 3
    };

    // La función ahora espera el documento del comprador ya populado si es posible,
    // o lo busca si solo se pasa el ID. Por eficiencia, se recomienda pasar el documento populado.
    let buyerWithReferrals;
    if (buyer.populated('referredBy')) {
        buyerWithReferrals = buyer;
    } else {
        // Fallback por si no viene populado: Se realiza UNA SOLA consulta eficiente.
        buyerWithReferrals = await User.findById(buyer._id)
          .select('username referredBy')
          .populate({
            path: 'referredBy',
            select: 'username referredBy balance', // Se incluye balance para posibles validaciones futuras
            populate: {
              path: 'referredBy',
              select: 'username referredBy balance',
              populate: {
                path: 'referredBy',
                select: 'username balance',
              },
            },
          })
          .lean(); // .lean() para un objeto JS plano y más rápido.
    }
    
    if (!buyerWithReferrals || !buyerWithReferrals.referredBy) {
      // No hay referente, no hay comisiones que distribuir.
      return;
    }
    
    // Construimos la lista de referentes de manera segura
    const referrers = [];
    if (buyerWithReferrals.referredBy) { referrers.push({ user: buyerWithReferrals.referredBy, level: 1 }); }
    if (referrers[0]?.user.referredBy) { referrers.push({ user: referrers[0].user.referredBy, level: 2 }); }
    if (referrers[1]?.user.referredBy) { referrers.push({ user: referrers[1].user.referredBy, level: 3 }); }
    
    // Preparamos las operaciones de actualización y las transacciones en un array.
    const operations = referrers.map(ref => {
      const commissionAmount = FIXED_COMMISSIONS[ref.level];
      if (!commissionAmount) return null;

      const updatePromise = User.findByIdAndUpdate(ref.user._id, {
        $inc: { 'balance.usdt': commissionAmount }
      }, { session }); // Se pasa la sesión si existe
      
      const transactionPromise = createTransaction(
        ref.user._id,
        'commission',
        commissionAmount,
        'USDT',
        `Comisión Nivel ${ref.level} por compra de ${buyerWithReferrals.username}`,
        { buyerId: buyerWithReferrals._id, purchaseAmount },
        session // Se pasa la sesión si existe
      );

      return Promise.all([updatePromise, transactionPromise]);
    }).filter(Boolean); // Filtra cualquier nulo si un nivel no es válido

    // Ejecutamos todas las operaciones en paralelo.
    await Promise.all(operations);
    console.log(`[CommissionService] Comisiones distribuidas por la compra de ${buyerWithReferrals.username}.`);

  } catch (error) {
    // Si falla, se loguea el error pero no se detiene el flujo principal de la compra.
    console.error(`[CommissionService] Fallo crítico al distribuir comisiones para la compra del usuario ${buyer._id}:`, error);
  }
};

// MODIFICADO: Se exporta la función con un nombre más genérico.
module.exports = {
  distributeReferralCommissions,
};
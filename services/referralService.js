// RUTA: backend/services/referralService.js (v2.0 - FEATURE-002: LÓGICA PORCENTUAL TRANSACCIONAL)

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Settings = require('../models/settingsModel');

/**
 * Calcula y distribuye comisiones porcentuales a la línea ascendente de referentes (hasta 3 niveles).
 * Toda la operación se ejecuta dentro de una transacción de base de datos para garantizar la atomicidad.
 * Si cualquier actualización falla, todas las actualizaciones se revierten.
 *
 * @param {mongoose.Document} referredUser - El documento del usuario que realizó el depósito.
 * @param {number} depositAmount - El monto del depósito que genera las comisiones.
 */
const distributeCommission = async (referredUser, depositAmount) => {
    console.log(`[Referral] Procesando comisión para depósito de ${referredUser.username} (${depositAmount} USDT)`);

    // 1. Obtener configuración desde la DB
    const settings = await Settings.getSettings();
    if (!settings || !settings.referralPercentages) {
        console.error('[Referral] Error crítico: Configuración de porcentajes no encontrada.');
        return;
    }

    // 2. Cargar porcentajes dinámicos
    const percentages = [
        settings.referralPercentages.level1 || 0,
        settings.referralPercentages.level2 || 0,
        settings.referralPercentages.level3 || 0,
    ];

    // ... (El resto de la función distributeCommission es idéntico a lo que tenías antes: session, for loop, updates) ...
    
    // Validar si hay algo que pagar
    if (percentages.every(p => p === 0)) return;

    let currentReferrerId = referredUser.referredBy;
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        for (let level = 1; level <= 3; level++) {
            if (!currentReferrerId) break;

            const referrer = await User.findById(currentReferrerId).session(session);
            if (!referrer) break;

            const percent = percentages[level - 1];
            
            if (percent > 0) {
                const commissionAmount = (depositAmount * percent) / 100;
                
                referrer.balance.usdt += commissionAmount;
                referrer.totalCommission = (referrer.totalCommission || 0) + commissionAmount;

                referrer.transactions.push({
                    type: 'referral_commission',
                    amount: commissionAmount,
                    currency: 'USDT',
                    description: `Comisión Nivel ${level} (${percent}%)`,
                    status: 'completed',
                    metadata: {
                        fromUserId: referredUser._id,
                        originalDeposit: depositAmount,
                        commissionLevel: level
                    }
                });

                await referrer.save({ session });
                console.log(`[Referral] Pagado ${commissionAmount} USDT a ${referrer.username} (Nivel ${level})`.green);
            }
            
            currentReferrerId = referrer.referredBy;
        }
        
        await session.commitTransaction();
        
    } catch (error) {
        await session.abortTransaction();
        console.error('[Referral] Error en transacción:', error);
    } finally {
        session.endSession();
    }
};

module.exports = { distributeCommission };
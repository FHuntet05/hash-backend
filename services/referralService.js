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
    console.log(`[ReferralService] Iniciando distribución de comisiones para el usuario ${referredUser.username} por un depósito de ${depositAmount} USDT.`);

    const settings = await Settings.getSettings();
    if (!settings || !settings.referralPercentages) {
        console.error('[ReferralService] ERROR: Configuración de comisiones no encontrada. Abortando.');
        return;
    }

    const percentages = [
        settings.referralPercentages.level1 || 0,
        settings.referralPercentages.level2 || 0,
        settings.referralPercentages.level3 || 0,
    ];

    if (percentages.every(p => p === 0)) {
        console.log('[ReferralService] Comisiones porcentuales desactivadas (todas en 0). Saltando proceso.');
        return;
    }

    let currentReferrerId = referredUser.referredBy;
    
    // Iniciar una sesión de Mongoose para la transacción.
    const session = await mongoose.startSession();

    try {
        // Iniciar la transacción.
        session.startTransaction();

        for (let level = 1; level <= 3; level++) {
            if (!currentReferrerId) {
                console.log(`[ReferralService] Cadena de referidos terminada en el Nivel ${level}.`);
                break; // Se rompe el bucle si no hay más referentes.
            }

            const referrer = await User.findById(currentReferrerId).session(session);
            if (!referrer) {
                console.warn(`[ReferralService] ADVERTENCIA: Referente con ID ${currentReferrerId} no encontrado en Nivel ${level}. Deteniendo cadena.`);
                break;
            }

            const commissionPercentage = percentages[level - 1];
            if (commissionPercentage > 0) {
                // Cálculo de la comisión basado en el porcentaje.
                const commissionAmount = (depositAmount * commissionPercentage) / 100;
                
                // Actualizar el saldo y el total de comisiones del referente.
                referrer.balance.usdt += commissionAmount;
                referrer.totalCommission = (referrer.totalCommission || 0) + commissionAmount;

                // Registrar la transacción de comisión.
                referrer.transactions.push({
                    type: 'referral_commission',
                    amount: commissionAmount,
                    currency: 'USDT',
                    description: `Comisión de Nivel ${level} (${commissionPercentage}%) por depósito de ${referredUser.username}`,
                    status: 'completed',
                    metadata: {
                        fromUserId: referredUser._id,
                        fromUsername: referredUser.username,
                        originalDeposit: depositAmount,
                        commissionLevel: level
                    }
                });

                // Guardar los cambios del referente dentro de la sesión.
                await referrer.save({ session });
                console.log(`[ReferralService] ✅ Acreditados ${commissionAmount.toFixed(4)} USDT a ${referrer.username} (Nivel ${level})`.green);
            }
            
            // Ascender al siguiente nivel en la cadena de referidos.
            currentReferrerId = referrer.referredBy;
        }
        
        // Si todo fue exitoso, confirmar la transacción.
        await session.commitTransaction();
        console.log(`[ReferralService] Transacción de comisiones completada con éxito para el depósito de ${referredUser.username}.`.cyan);

    } catch (error) {
        // Si algo falla, revertir todos los cambios.
        await session.abortTransaction();
        console.error('[ReferralService] ❌ ERROR: La transacción de comisiones fue abortada. Todos los cambios han sido revertidos.'.red.bold, error);
    } finally {
        // Siempre cerrar la sesión al finalizar.
        session.endSession();
    }
};

module.exports = { distributeCommission };
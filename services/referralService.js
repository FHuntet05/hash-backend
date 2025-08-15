// RUTA: backend/services/referralService.js (NUEVO ARCHIVO)

const User = require('../models/userModel');
const Settings = require('../models/settingsModel');

/**
 * Procesa y paga las comisiones de referido multinivel.
 * Esta función es llamada después de que un usuario realiza su primera compra calificada.
 *
 * @param {object} buyer - El objeto de usuario Mongoose completo de la persona que realizó la compra.
 * @param {object} session - La sesión de la transacción de Mongoose para garantizar la atomicidad.
 */
const processMultiLevelCommissions = async (buyer, session) => {
    try {
        console.log(`[ReferralService] Iniciando procesamiento de comisiones para la compra de ${buyer.username}`.cyan);

        // 1. Obtener la configuración de comisiones
        const settings = await Settings.getSettings();
        const commissions = {
            1: settings.commissionLevel1 || 0,
            2: settings.commissionLevel2 || 0,
            3: settings.commissionLevel3 || 0,
        };

        if (commissions[1] === 0 && commissions[2] === 0 && commissions[3] === 0) {
            console.log('[ReferralService] Comisiones desactivadas (todas en 0). Saltando proceso.'.yellow);
            return;
        }

        // 2. Escalar el árbol de referidos, hasta 3 niveles
        let currentReferrerId = buyer.referredBy;
        
        for (let level = 1; level <= 3; level++) {
            if (!currentReferrerId) {
                console.log(`[ReferralService] Se detuvo en el Nivel ${level}, no hay más referentes.`.gray);
                break; // Se detiene si no hay más referentes en la cadena
            }
            
            const commissionAmount = commissions[level];
            if (commissionAmount > 0) {
                // Buscamos al referente en la base de datos para actualizarlo
                const referrer = await User.findById(currentReferrerId).session(session);

                if (referrer) {
                    // Pagar la comisión y registrar la transacción
                    referrer.balance.usdt += commissionAmount;
                    referrer.transactions.push({
                        type: 'referral_commission',
                        amount: commissionAmount,
                        currency: 'USDT',
                        description: `Comisión de Nivel ${level} por la primera compra de ${buyer.username}`,
                        status: 'completed'
                    });

                    await referrer.save({ session });
                    console.log(`[ReferralService] ✅ Pagados ${commissionAmount.toFixed(2)} USDT a ${referrer.username} (Nivel ${level})`.green);
                    
                    // Preparamos para el siguiente nivel
                    currentReferrerId = referrer.referredBy;
                } else {
                    console.warn(`[ReferralService] ADVERTENCIA: Referente no encontrado con ID ${currentReferrerId} en el Nivel ${level}. Deteniendo la cadena.`.yellow);
                    break;
                }
            } else {
                 console.log(`[ReferralService] Comisión de Nivel ${level} es 0. Saltando pago.`.gray);
                 // Aunque la comisión sea 0, debemos seguir subiendo en el árbol.
                 const nextReferrer = await User.findById(currentReferrerId).select('referredBy').lean().session(session);
                 if(nextReferrer) {
                    currentReferrerId = nextReferrer.referredBy;
                 } else {
                    break;
                 }
            }
        }

        console.log(`[ReferralService] Procesamiento de comisiones para ${buyer.username} finalizado.`.cyan);

    } catch (error) {
        console.error('❌ ERROR FATAL en ReferralService:'.red.bold, error);
        // Lanzamos el error para que la transacción principal de la base de datos
        // pueda hacer un rollback y revertir todos los cambios.
        throw new Error('Fallo al procesar las comisiones de referido.');
    }
};

module.exports = {
    processMultiLevelCommissions
};
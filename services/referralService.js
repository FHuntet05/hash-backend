// RUTA: backend/services/referralService.js (v1.1 - CON METADATOS MEJORADOS)

const User = require('../models/userModel');
const Settings = require('../models/settingsModel');

const processMultiLevelCommissions = async (buyer, session) => {
    try {
        console.log(`[ReferralService] Iniciando procesamiento de comisiones para la compra de ${buyer.username}`.cyan);

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

        let currentReferrerId = buyer.referredBy;
        
        for (let level = 1; level <= 3; level++) {
            if (!currentReferrerId) {
                console.log(`[ReferralService] Se detuvo en el Nivel ${level}, no hay más referentes.`.gray);
                break;
            }
            
            const commissionAmount = commissions[level];
            if (commissionAmount > 0) {
                const referrer = await User.findById(currentReferrerId).session(session);

                if (referrer) {
                    referrer.balance.usdt += commissionAmount;
                    
                    // --- INICIO DE MODIFICACIÓN CRÍTICA ---
                    // Añadimos metadatos clave para el cálculo de estadísticas
                    referrer.transactions.push({
                        type: 'referral_commission',
                        amount: commissionAmount,
                        currency: 'USDT',
                        description: `Comisión de Nivel ${level} por la primera compra de ${buyer.username}`,
                        status: 'completed',
                        metadata: {
                            fromUser: buyer._id,       // Quién generó la comisión
                            fromUsername: buyer.username,
                            commissionLevel: level     // En qué nivel se pagó
                        }
                    });
                    // --- FIN DE MODIFICACIÓN CRÍTICA ---

                    await referrer.save({ session });
                    console.log(`[ReferralService] ✅ Pagados ${commissionAmount.toFixed(2)} USDT a ${referrer.username} (Nivel ${level})`.green);
                    
                    currentReferrerId = referrer.referredBy;
                } else {
                    console.warn(`[ReferralService] ADVERTENCIA: Referente no encontrado con ID ${currentReferrerId} en el Nivel ${level}. Deteniendo la cadena.`.yellow);
                    break;
                }
            } else {
                 console.log(`[ReferralService] Comisión de Nivel ${level} es 0. Saltando pago.`.gray);
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
        throw new Error('Fallo al procesar las comisiones de referido.');
    }
};

module.exports = {
    processMultiLevelCommissions
};
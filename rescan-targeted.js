// RUTA: backend/rescan-targeted.js (SCRIPT PARA RE-ESCANEO QUIRÚRGICO)

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const colors = require('colors');
const CryptoWallet = require('./models/cryptoWalletModel');

dotenv.config();

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log(`[SCRIPT] Conectado a MongoDB: ${conn.connection.host}`.cyan.underline);
    } catch (error) {
        console.error(`[SCRIPT] Error de conexión a MongoDB: ${error.message}`.red.bold);
        process.exit(1);
    }
};

const runTargetedRescan = async () => {
    await connectDB();

    // --- !! PASO 1: DEFINA SUS OBJETIVOS AQUÍ !! ---
    // Pegue las direcciones de las billeteras afectadas que recopiló en la Fase 1
    // dentro de las comillas, separadas por comas.
    const TARGET_WALLETS = [
        "0x19cEe4a6d4B95B6917B3e653ECec269150221593",
        "0xc1809eF6ea5EE69188f7E6c27b68323ADC212D8c",
        "0xaB688E62F77E3610754Fb25635E22f9781b249eA"
        // Añada tantas direcciones como sea necesario
    ];
    // --------------------------------------------------

    // --- !! PASO 2: DEFINA EL PUNTO DE INICIO !! ---
    // Este es el bloque desde el cual se comenzará a re-escanear para las billeteras objetivo.
    const RESCAN_START_BLOCK = 57946149;
    // --------------------------------------------------

    if (TARGET_WALLETS.length === 0 || TARGET_WALLETS[0].includes("DIRECCION_")) {
        console.error(`[SCRIPT] ❌ ERROR: Debe editar este archivo y añadir al menos una dirección en la lista 'TARGET_WALLETS'`.red.bold);
        await mongoose.connection.close();
        process.exit(1);
    }

    console.log(`[SCRIPT] ATENCIÓN: Se restablecerá el escaneo de ${TARGET_WALLETS.length} billeteras específicas al bloque ${RESCAN_START_BLOCK}`.yellow.bold);
    
    try {
        // La operación de actualización ahora solo afecta a las direcciones en la lista
        const result = await CryptoWallet.updateMany(
            { chain: 'BSC', address: { $in: TARGET_WALLETS } },
            { $set: { lastScannedBlock: RESCAN_START_BLOCK } }
        );

        console.log(`[SCRIPT] ✅ OPERACIÓN COMPLETADA`.green.bold);
        console.log(`   - Billeteras objetivo para actualizar: ${TARGET_WALLETS.length}`);
        console.log(`   - Billeteras encontradas y actualizadas: ${result.modifiedCount}`);
        
        if (result.matchedCount !== TARGET_WALLETS.length) {
            console.warn(`[SCRIPT] ADVERTENCIA: No todas las direcciones objetivo fueron encontradas en la base de datos. Verifique la lista.`.yellow);
        }
        
        console.log('[SCRIPT] El monitor de transacciones ahora re-escaneará las billeteras objetivo en su próximo ciclo.');

    } catch (error) {
        console.error(`[SCRIPT] ❌ ERROR durante la actualización: ${error.message}`.red.bold);
    } finally {
        await mongoose.connection.close();
        console.log('[SCRIPT] Desconectado de MongoDB.');
        process.exit(0);
    }
};

runTargetedRescan();
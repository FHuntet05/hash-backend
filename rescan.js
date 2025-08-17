// RUTA: backend/rescan.js (VERSIÓN FINAL PARA RE-ESCANEO COMPLETO)

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const colors = require('colors');
const CryptoWallet = require('./models/cryptoWalletModel');

// Carga las variables de entorno del archivo .env
dotenv.config();

/**
 * Establece la conexión con la base de datos MongoDB.
 * El script se detendrá si la conexión falla.
 */
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

/**
 * Función principal que ejecuta la lógica de restablecimiento.
 */
const runRescan = async () => {
    await connectDB();

    // --- PUNTO DE CONFIGURACIÓN CRÍTICO ---
    // Este es el número de bloque desde el cual el monitor comenzará a escanear de nuevo.
    // Calibrado según su solicitud.
    const RESCAN_START_BLOCK = 57946149;
    // ----------------------------------------

    console.log(`[SCRIPT] ATENCIÓN: Se restablecerá el escaneo de TODAS las billeteras BSC al bloque ${RESCAN_START_BLOCK}`.yellow.bold);
    
    try {
        // La operación de actualización masiva.
        // Busca todas las billeteras de la cadena 'BSC' y establece su 'lastScannedBlock'
        // al número definido, forzando un re-escaneo.
        const result = await CryptoWallet.updateMany(
            { chain: 'BSC' },
            { $set: { lastScannedBlock: RESCAN_START_BLOCK } }
        );

        console.log(`[SCRIPT] ✅ OPERACIÓN COMPLETADA`.green.bold);
        console.log(`   - Billeteras encontradas en la BD: ${result.matchedCount}`);
        console.log(`   - Billeteras actualizadas para re-escaneo: ${result.modifiedCount}`);
        console.log('[SCRIPT] El monitor de transacciones (Ankr) ahora re-escaneará los bloques perdidos en su próximo ciclo.');

    } catch (error) {
        console.error(`[SCRIPT] ❌ ERROR durante la actualización: ${error.message}`.red.bold);
    } finally {
        // Cierra la conexión a la base de datos y finaliza el script.
        await mongoose.connection.close();
        console.log('[SCRIPT] Desconectado de MongoDB.');
        process.exit(0);
    }
};

// Ejecuta el script.
runRescan();
// backend/services/transactionMonitor.js (VERSIÓN v40.0 - LÓGICA DE BATCHING AUTOMÁTICO - COMPLETO)

const { ethers } = require('ethers');
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const { sendTelegramMessage } = require('./notificationService');

// --- CONSTANTES DE CONFIGURACIÓN ---
const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';
// Se calibra el tamaño del lote a un valor seguro para evitar errores de "rango demasiado grande".
const BATCH_SIZE_BSC = 2000;

// Verificación crítica de la variable de entorno del proveedor RPC.
if (!process.env.ANKR_BSC_RPC_URL) {
    console.error("[MONITOR] ERROR FATAL: La variable de entorno ANKR_BSC_RPC_URL no está definida.".red.bold);
    process.exit(1);
}
// Se establece la conexión con el proveedor RPC.
const provider = new ethers.providers.JsonRpcProvider(process.env.ANKR_BSC_RPC_URL);
console.log(`[MONITOR] Conectado a la infraestructura RPC (Modo Universal v2) para BSC.`.cyan.bold);

/**
 * Función auxiliar para crear pausas en la ejecución.
 * @param {number} ms - Milisegundos a esperar.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Procesa un depósito detectado, lo valida y lo acredita al usuario.
 */
async function processDeposit(txHash, blockNumber, fromAddress, toAddress, amount, wallet) {
    // 1. Evitar duplicados: Comprobar si esta transacción ya ha sido procesada.
    const existingTx = await User.findOne({ 'transactions.metadata.txid': txHash });
    if (existingTx) {
        // console.log(`[ProcessDeposit] TXID duplicado detectado: ${txHash}. Saltando.`.gray);
        return; 
    }

    const amountInUSDT = parseFloat(amount);
    console.log(`[ProcessDeposit] Procesando nuevo depósito: ${amountInUSDT} USDT para usuario ${wallet.user} (TXID: ${txHash})`);

    // 2. Encontrar al usuario dueño de la billetera.
    const user = await User.findById(wallet.user);
    if (!user) {
        console.error(`[ProcessDeposit] Usuario no encontrado para wallet ${wallet._id}. Abortando depósito.`);
        return;
    }

    // 3. Construir el objeto de la nueva transacción.
    const newTransaction = {
        type: 'deposit',
        amount: amountInUSDT,
        currency: 'USDT',
        description: `Depósito de ${amountInUSDT.toFixed(6)} USDT`,
        status: 'completed',
        metadata: {
            txid: txHash,
            chain: wallet.chain,
            fromAddress,
            toAddress,
            originalAmount: amount.toString(),
            originalCurrency: 'USDT',
            blockIdentifier: blockNumber.toString()
        }
    };

    // 4. Actualizar el estado del usuario y guardar en una sola operación.
    user.balance.usdt = (user.balance.usdt || 0) + amountInUSDT;
    user.totalRecharge = (user.totalRecharge || 0) + amountInUSDT;
    user.transactions.push(newTransaction);
    await user.save();
    
    console.log(`[ProcessDeposit] ✅ ÉXITO: Usuario ${user.username} acreditado con ${amountInUSDT.toFixed(2)} USDT.`.green);
    
    // 5. Notificar al usuario a través de Telegram.
    if (user.telegramId) {
        const message = `✅ <b>¡Depósito confirmado!</b>\n\nSe han acreditado <b>${amountInUSDT.toFixed(2)} USDT</b> a tu saldo.`;
        await sendTelegramMessage(user.telegramId, message);
    }
}

/**
 * Obtiene el número del bloque más reciente de la red.
 */
async function getCurrentBscBlock() {
    try {
        const blockNumber = await provider.getBlockNumber();
        console.log(`[Monitor Universal] Bloque actual de la red obtenido: ${blockNumber}`.green);
        return blockNumber;
    } catch (error) {
        console.error("[Monitor Universal] ERROR CRÍTICO: No se pudo obtener el bloque actual.".red.bold, error);
        return null;
    }
}

/**
 * Escanea un rango específico de bloques para una billetera en busca de depósitos de USDT.
 */
async function scanBscBlockRange(wallet, startBlock, endBlock) {
    try {
        console.log(`[Monitor eth_getLogs] Escaneando ${wallet.address} de ${startBlock} a ${endBlock}`.cyan);
        
        // Firma del evento Transfer(address,address,uint256) del estándar ERC20.
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        
        // Construcción del filtro para la llamada `eth_getLogs`.
        const filter = {
            address: USDT_CONTRACT_BSC,
            fromBlock: startBlock,
            toBlock: endBlock,
            topics: [
                transferTopic,
                null, // Acepta transferencias desde cualquier dirección de origen.
                ethers.utils.hexZeroPad(wallet.address, 32) // La dirección de destino debe ser la de nuestra wallet.
            ]
        };

        const logs = await provider.getLogs(filter);

        if (logs.length > 0) {
            console.log(`[Monitor eth_getLogs] Encontrados ${logs.length} eventos de depósito para ${wallet.address}. Procesando...`.green.bold);
            for (const log of logs) {
                const fromAddress = ethers.utils.getAddress('0x' + log.topics[1].substring(26));
                const amount = ethers.utils.formatUnits(log.data, 18); // USDT tiene 18 decimales.
                await processDeposit(log.transactionHash, log.blockNumber, fromAddress, wallet.address, amount, wallet);
            }
        }
        return true; // El escaneo del lote fue exitoso.
    } catch (error) {
        console.error(`[Monitor eth_getLogs] EXCEPCIÓN CRÍTICA al escanear wallet ${wallet.address} en rango ${startBlock}-${endBlock}: ${error.message}`.red.bold);
        if (error.body) console.error("[Monitor eth_getLogs] Error Body:", error.body);
        return false; // El escaneo del lote falló.
    }
}

/**
 * Orquesta el ciclo de escaneo para todas las billeteras.
 * Implementa la lógica de paginación de bloques (batching).
 */
async function checkBscTransactions() {
    console.log("[Monitor Universal] Iniciando ciclo de escaneo STATEFUL para BSC.");
    const wallets = await CryptoWallet.find({ chain: 'BSC' });
    if (wallets.length === 0) { return; }
    
    const currentNetworkBlock = await getCurrentBscBlock();
    if (!currentNetworkBlock) { return; }
    
    console.log(`[Monitor Universal] Encontradas ${wallets.length} wallets. Bloque de red actual: ${currentNetworkBlock}`);
    
    for (const wallet of wallets) {
        let lastScanned = wallet.lastScannedBlock || (currentNetworkBlock - 1);
        let fromBlock = lastScanned + 1;
        
        // Bucle 'while' para procesar la deuda de bloques en lotes manejables.
        while (fromBlock <= currentNetworkBlock) {
            const toBlock = Math.min(fromBlock + BATCH_SIZE_BSC - 1, currentNetworkBlock);
            
            if (fromBlock > toBlock) break;

            const scanSuccessful = await scanBscBlockRange(wallet, fromBlock, toBlock);
            
            if (scanSuccessful) {
                // Si el lote fue exitoso, se actualiza el punto de control y se prepara el siguiente lote.
                await CryptoWallet.findByIdAndUpdate(wallet._id, { lastScannedBlock: toBlock });
                console.log(`[Monitor Universal] Punto de control actualizado para ${wallet.address} a bloque ${toBlock}`.green);
                fromBlock = toBlock + 1;
            } else {
                // Si un lote falla, se detiene el procesamiento de ESTA billetera y se pasa a la siguiente.
                console.warn(`[Monitor Universal] Escaneo fallido para ${wallet.address}. Se reintentará en el próximo ciclo.`.yellow.bold);
                break; 
            }
            await sleep(250); // Pausa entre lotes para la misma billetera para no sobrecargar el RPC.
        }
        await sleep(100); // Pausa corta antes de pasar a la siguiente billetera.
    }
}

/**
 * Inicia y mantiene el ciclo de monitoreo.
 */
const startMonitoring = () => {
    console.log('✅ Iniciando servicio de monitoreo de transacciones (Estándar Universal v2)...'.bold);
    const runChecks = async () => {
        console.log("--- [Monitor] Iniciando ciclo de monitoreo ---".gray);
        await checkBscTransactions();
        console.log("--- [Monitor] Ciclo de monitoreo finalizado. Esperando al siguiente. ---".gray);
    };
    runChecks();
    setInterval(runChecks, 60000); 
};

module.exports = { startMonitoring };
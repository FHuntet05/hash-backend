// backend/services/transactionMonitor.js (v41.0 - FEATURE-002: ACTIVACIÓN DE COMISIONES)

const { ethers } = require('ethers');
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const { sendTelegramMessage } = require('./notificationService');
// --- INICIO DE NUEVA IMPORTACIÓN PARA FEATURE-002 ---
const { distributeCommission } = require('./referralService'); // Importar el nuevo servicio.
// --- FIN DE NUEVA IMPORTACIÓN ---

const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const BATCH_SIZE_BSC = 2000;

if (!process.env.ANKR_BSC_RPC_URL) {
    console.error("[MONITOR] ERROR FATAL: La variable de entorno ANKR_BSC_RPC_URL no está definida.".red.bold);
    process.exit(1);
}
const provider = new ethers.providers.JsonRpcProvider(process.env.ANKR_BSC_RPC_URL);
console.log(`[MONITOR] Conectado a la infraestructura RPC (Modo Universal v2) para BSC.`.cyan.bold);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processDeposit(txHash, blockNumber, fromAddress, toAddress, amount, wallet) {
    const existingTx = await User.findOne({ 'transactions.metadata.txid': txHash });
    if (existingTx) {
        return; 
    }

    const amountInUSDT = parseFloat(amount);
    console.log(`[ProcessDeposit] Procesando nuevo depósito: ${amountInUSDT} USDT para usuario ${wallet.user} (TXID: ${txHash})`);

    const user = await User.findById(wallet.user);
    if (!user) {
        console.error(`[ProcessDeposit] Usuario no encontrado para wallet ${wallet._id}. Abortando depósito.`);
        return;
    }

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

    user.balance.usdt = (user.balance.usdt || 0) + amountInUSDT;
    user.totalRecharge = (user.totalRecharge || 0) + amountInUSDT;
    user.transactions.push(newTransaction);
    await user.save();
    
    console.log(`[ProcessDeposit] ✅ ÉXITO: Usuario ${user.username} acreditado con ${amountInUSDT.toFixed(2)} USDT.`.green);
    
    // --- INICIO DE MODIFICACIÓN CRÍTICA PARA FEATURE-002 ---
    // Después de que el depósito ha sido acreditado y guardado exitosamente,
    // se activa el servicio de distribución de comisiones.
    // Se ejecuta de forma asíncrona ("fire and forget") para no bloquear el monitor.
    if (user.referredBy) {
        distributeCommission(user, amountInUSDT);
    }
    // --- FIN DE MODIFICACIÓN CRÍTICA ---
    
    if (user.telegramId) {
        const message = `✅ <b>¡Depósito confirmado!</b>\n\nSe han acreditado <b>${amountInUSDT.toFixed(2)} USDT</b> a tu saldo.`;
        await sendTelegramMessage(user.telegramId, message);
    }
}

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

async function scanBscBlockRange(wallet, startBlock, endBlock) {
    try {
        console.log(`[Monitor eth_getLogs] Escaneando ${wallet.address} de ${startBlock} a ${endBlock}`.cyan);
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const filter = {
            address: USDT_CONTRACT_BSC,
            fromBlock: startBlock,
            toBlock: endBlock,
            topics: [
                transferTopic,
                null,
                ethers.utils.hexZeroPad(wallet.address, 32)
            ]
        };
        const logs = await provider.getLogs(filter);
        if (logs.length > 0) {
            console.log(`[Monitor eth_getLogs] Encontrados ${logs.length} eventos de depósito para ${wallet.address}. Procesando...`.green.bold);
            for (const log of logs) {
                const fromAddress = ethers.utils.getAddress('0x' + log.topics[1].substring(26));
                const amount = ethers.utils.formatUnits(log.data, 18);
                await processDeposit(log.transactionHash, log.blockNumber, fromAddress, wallet.address, amount, wallet);
            }
        }
        return true;
    } catch (error) {
        console.error(`[Monitor eth_getLogs] EXCEPCIÓN CRÍTICA al escanear wallet ${wallet.address} en rango ${startBlock}-${endBlock}: ${error.message}`.red.bold);
        if (error.body) console.error("[Monitor eth_getLogs] Error Body:", error.body);
        return false;
    }
}

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
        
        while (fromBlock <= currentNetworkBlock) {
            const toBlock = Math.min(fromBlock + BATCH_SIZE_BSC - 1, currentNetworkBlock);
            if (fromBlock > toBlock) break;
            const scanSuccessful = await scanBscBlockRange(wallet, fromBlock, toBlock);
            if (scanSuccessful) {
                await CryptoWallet.findByIdAndUpdate(wallet._id, { lastScannedBlock: toBlock });
                console.log(`[Monitor Universal] Punto de control actualizado para ${wallet.address} a bloque ${toBlock}`.green);
                fromBlock = toBlock + 1;
            } else {
                console.warn(`[Monitor Universal] Escaneo fallido para ${wallet.address}. Se reintentará en el próximo ciclo.`.yellow.bold);
                break; 
            }
            await sleep(250);
        }
        await sleep(100);
    }
}

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
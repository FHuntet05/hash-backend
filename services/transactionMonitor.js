// backend/services/transactionMonitor.js (VERSIÓN v38.0 - MIGRACIÓN FINAL A INFRAESTRUCTURA ANKR)

const axios = require('axios');
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const PendingTx = require('../models/pendingTxModel');
const { ethers } = require('ethers');
const { sendTelegramMessage } = require('./notificationService');
const { getPrice } = require('./priceService');

// --- CONSTANTES DE CONFIGURACIÓN ---
const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955'.toLowerCase();

// --- INICIO DE LA REINGENIERÍA CON ANKR ---
if (!process.env.ANKR_BSC_RPC_URL) {
    console.error("[MONITOR] ERROR FATAL: La variable de entorno ANKR_BSC_RPC_URL no está definida.".red.bold);
    process.exit(1);
}
// Se crea una conexión persistente y optimizada al proveedor RPC.
const ankrProvider = new ethers.providers.JsonRpcProvider(process.env.ANKR_BSC_RPC_URL);
console.log(`[MONITOR] Conectado a la infraestructura RPC de Ankr para BSC.`.cyan.bold);
// --- FIN DE LA REINGENIERÍA CON ANKR ---

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processDeposit(tx, wallet, amount, currency, txid, blockIdentifier) {
    // Verificación de duplicados para máxima integridad.
    const existingTx = await User.findOne({ 'transactions.metadata.txid': txid });
    if (existingTx) {
        return; // Transacción ya procesada.
    }

    console.log(`[ProcessDeposit] Procesando nuevo depósito: ${amount} ${currency} para usuario ${wallet.user} (TXID: ${txid})`);
    
    // Asumimos que el precio de USDT es siempre 1.
    const price = 1; 
    const amountInUSDT = amount * price;
    
    const user = await User.findById(wallet.user);
    if (!user) {
        console.error(`[ProcessDeposit] Usuario no encontrado para wallet ${wallet._id}. Abortando depósito.`);
        return;
    }

    const newTransaction = {
        type: 'deposit',
        amount: amountInUSDT,
        currency: 'USDT',
        description: `Depósito de ${amount.toFixed(6)} ${currency} acreditado como ${amountInUSDT.toFixed(2)} USDT`,
        status: 'completed',
        metadata: {
            txid: txid,
            chain: wallet.chain,
            fromAddress: tx.from,
            toAddress: tx.to,
            originalAmount: amount.toString(),
            originalCurrency: currency,
            priceUsed: price.toString(),
            blockIdentifier: blockIdentifier.toString(),
        }
    };

    user.balance.usdt = (user.balance.usdt || 0) + amountInUSDT;
    user.totalRecharge = (user.totalRecharge || 0) + amountInUSDT;
    user.transactions.push(newTransaction);
    
    await user.save();
    
    console.log(`[ProcessDeposit] ✅ ÉXITO: Usuario ${user.username} acreditado con ${amountInUSDT.toFixed(2)} USDT y transacción registrada.`.green);
    
    if (user.telegramId) {
        const message = `✅ <b>¡Depósito confirmado!</b>\n\nSe han acreditado <b>${amountInUSDT.toFixed(2)} USDT</b> a tu saldo.`;
        await sendTelegramMessage(user.telegramId, message);
    }
}

async function getCurrentBscBlock() {
    try {
        const blockNumber = await ankrProvider.getBlockNumber();
        console.log(`[Monitor Ankr] Bloque actual de la red obtenido: ${blockNumber}`.green);
        return blockNumber;
    } catch (error) {
        console.error("[Monitor Ankr] ERROR CRÍTICO: No se pudo obtener el bloque actual desde Ankr.".red.bold, error);
        return null;
    }
}

// --- EL NUEVO Y POTENTE MOTOR DE ESCANEO ---
async function scanBscBlockRange(wallet, startBlock, endBlock) {
    try {
        console.log(`[Monitor Ankr] Escaneando ${wallet.address} de ${startBlock} a ${endBlock}`.cyan);

        // Se utiliza el método RPC avanzado de Ankr para obtener TODAS las transacciones de una dirección.
        const response = await ankrProvider.send("ankr_getTransactionsByAddress", [{
            address: wallet.address,
            fromBlock: startBlock,
            toBlock: endBlock,
            blockchain: "bsc",
            withLogs: true // Incluimos logs para una detección de tokens 100% fiable
        }]);
        
        const transactions = response.transactions;
        if (transactions.length > 0) {
            console.log(`[Monitor Ankr] Ankr reportó ${transactions.length} transacciones para ${wallet.address}. Procesando...`.green.bold);
        }

        for (const tx of transactions) {
            // Detección de depósitos de Tokens (USDT BEP20)
            for (const log of tx.logs) {
                // Un log de transferencia de token ERC20 tiene 3 tópicos: [Firma_Del_Evento, From, To]
                if (log.address.toLowerCase() === USDT_CONTRACT_BSC && log.topics.length === 3 && log.topics[0].toLowerCase() === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                    const toAddress = ethers.utils.getAddress('0x' + log.topics[2].substring(26));
                    if (toAddress.toLowerCase() === wallet.address.toLowerCase()) {
                        const amount = parseFloat(ethers.utils.formatUnits(log.data, 18)); // USDT tiene 18 decimales
                        await processDeposit(tx, wallet, amount, 'USDT', tx.hash, parseInt(tx.blockNumber, 16));
                    }
                }
            }
        }
        return true; // El escaneo fue exitoso
    } catch (error) {
        // Añadimos más detalle al log de error para un mejor diagnóstico futuro.
        console.error(`[Monitor Ankr] EXCEPCIÓN CRÍTICA al escanear wallet ${wallet.address} en rango ${startBlock}-${endBlock}: ${error.message}`.red.bold);
        if (error.body) console.error("[Monitor Ankr] Error Body:", error.body);
        return false; // El escaneo falló
    }
}
// --- FIN DEL NUEVO MOTOR ---

async function checkBscTransactions() {
    console.log("[Monitor Ankr] Iniciando ciclo de escaneo STATEFUL para BSC.");
    const wallets = await CryptoWallet.find({ chain: 'BSC' });
    if (wallets.length === 0) { return; }
    
    const currentNetworkBlock = await getCurrentBscBlock();
    if (!currentNetworkBlock) { console.error("[Monitor Ankr] No se pudo obtener el bloque actual. Saltando ciclo."); return; }
    
    console.log(`[Monitor Ankr] Encontradas ${wallets.length} wallets. Bloque de red actual: ${currentNetworkBlock}`);
    
    for (const wallet of wallets) {
        let lastScanned = wallet.lastScannedBlock || (currentNetworkBlock - 1); // Empezar desde el bloque anterior si no hay registro
        let fromBlock = lastScanned + 1;
        
        if (fromBlock > currentNetworkBlock) {
            continue; // Ya está al día
        }

        const toBlock = currentNetworkBlock;
        console.log(`[Monitor Ankr] Preparando escaneo para ${wallet.address}. Rango: ${fromBlock} -> ${toBlock}`);
        const scanSuccessful = await scanBscBlockRange(wallet, fromBlock, toBlock);
        
        if (scanSuccessful) {
            await CryptoWallet.findByIdAndUpdate(wallet._id, { lastScannedBlock: toBlock });
            console.log(`[Monitor Ankr] Punto de control actualizado para ${wallet.address} a bloque ${toBlock}`.green);
        } else {
            console.warn(`[Monitor Ankr] Escaneo fallido para ${wallet.address} en el rango ${fromBlock}-${toBlock}. Se reintentará en el próximo ciclo.`.yellow.bold);
        }
        await sleep(250); // Pausa corta entre billeteras para ser amigable con la API de Ankr
    }
}

const startMonitoring = () => {
    console.log('✅ Iniciando servicio de monitoreo de transacciones (Ankr)...'.bold);
    const runChecks = async () => {
        console.log("--- [Monitor] Iniciando ciclo de monitoreo ---".gray);
        await checkBscTransactions();
        console.log("--- [Monitor] Ciclo de monitoreo finalizado. Esperando al siguiente. ---".gray);
    };
    runChecks();
    // Ejecutar cada 60 segundos
    setInterval(runChecks, 60000); 
};

module.exports = { startMonitoring };
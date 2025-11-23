// RUTA: backend/services/transactionMonitor.js

const { ethers } = require('ethers');
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const { sendTelegramMessage } = require('./notificationService');
const { distributeCommission } = require('./referralService');

const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';
// BATCH_SIZE Reducido para evitar Timeouts en Serverless/Cron
const BATCH_SIZE_BSC = 200; 

if (!process.env.ANKR_BSC_RPC_URL) {
    console.error("[MONITOR] ❌ ERROR FATAL: ANKR_BSC_RPC_URL no definida en .env");
    // No salimos del proceso para que el servidor pueda arrancar aunque el monitor falle
}

// Inicialización del Provider
let provider;
try {
    provider = new ethers.providers.JsonRpcProvider(process.env.ANKR_BSC_RPC_URL);
} catch (e) {
    console.error("[MONITOR] Error al inicializar proveedor RPC:", e.message);
}

// Helper de espera para evitar Rate Limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- PROCESAR DEPÓSITO INDIVIDUAL ---
async function processDeposit(txHash, blockNumber, fromAddress, toAddress, rawAmount, wallet) {
    try {
        // 1. Validar idempotencia (si ya existe)
        const existingTx = await User.findOne({ 'transactions.metadata.txid': txHash });
        if (existingTx) return; 

        const amountInUSDT = parseFloat(rawAmount);
        
        // Filtro anti-spam (opcional)
        if (amountInUSDT < 0.1) return;

        console.log(`💰 [MONITOR DETECTADO] TX: ${txHash} | ${amountInUSDT} USDT -> ${wallet.address}`);

        // 2. Buscar usuario
        const user = await User.findById(wallet.user);
        if (!user) {
            console.error(`[Monitor] ❌ Error: Wallet huérfana ${wallet.address}`);
            return;
        }

        // 3. Transacción y Saldo
        const newTransaction = {
            type: 'deposit',
            amount: amountInUSDT,
            currency: 'USDT',
            description: `Depósito Confirmado`,
            status: 'completed',
            metadata: {
                txid: txHash,
                chain: wallet.chain,
                fromAddress: fromAddress,
                toAddress: toAddress,
                blockIdentifier: blockNumber.toString()
            },
            createdAt: new Date()
        };

        user.balance.usdt = (user.balance.usdt || 0) + amountInUSDT;
        user.totalRecharge = (user.totalRecharge || 0) + amountInUSDT;
        user.transactions.push(newTransaction);
        
        await user.save();
        console.log(`✅ [Monitor] Acreditado a ${user.username || user.telegramId}.`);

        // 4. Acciones Post-Depósito (Async)
        if (user.telegramId) {
            sendTelegramMessage(user.telegramId, `✅ <b>¡Depósito Recibido!</b>\n\n+${amountInUSDT.toFixed(2)} USDT agregados.`)
                .catch(e => console.error("Error notificación:", e.message));
        }

        if (user.referredBy) {
            distributeCommission(user, amountInUSDT)
                .catch(e => console.error("Error comisiones:", e.message));
        }

    } catch (error) {
        console.error(`[Monitor] ❌ Error en TX ${txHash}:`, error);
    }
}

async function getCurrentBscBlock() {
    if (!provider) return null;
    try {
        return await provider.getBlockNumber();
    } catch (error) {
        console.error("[Monitor] Error RPC:", error.message);
        return null;
    }
}

async function scanBscBlockRange(wallet, startBlock, endBlock) {
    if (!provider) return false;

    const filter = {
        address: USDT_CONTRACT_BSC,
        fromBlock: startBlock,
        toBlock: endBlock,
        topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer
            null,
            ethers.utils.hexZeroPad(wallet.address, 32) // To
        ]
    };

    try {
        const logs = await provider.getLogs(filter);
        if (logs.length > 0) {
            console.log(`⚡ [Monitor] ${logs.length} eventos en ${wallet.address} (${startBlock}-${endBlock})`);
            for (const log of logs) {
                const fromAddress = ethers.utils.getAddress('0x' + log.topics[1].substring(26));
                const rawAmount = ethers.BigNumber.from(log.data);
                const amount = ethers.utils.formatUnits(rawAmount, 18);
                await processDeposit(log.transactionHash, log.blockNumber, fromAddress, wallet.address, amount, wallet);
            }
        }
        return true;
    } catch (error) {
        console.error(`[Monitor] Error escaneando ${startBlock}-${endBlock}:`, error.message);
        return false;
    }
}

// --- FUNCIÓN PRINCIPAL DEL CRON (ASYNC) ---
async function checkBscTransactions() {
    console.log(`🏁 [Scan Job] Iniciando escaneo masivo...`);
    
    const currentBlock = await getCurrentBscBlock();
    if (!currentBlock) {
        console.log(`[Scan Job] Sin conexión RPC.`);
        return;
    }

    const wallets = await CryptoWallet.find({ chain: 'BSC' });
    console.log(`[Scan Job] Escaneando ${wallets.length} wallets vs Bloque ${currentBlock}`);

    let updatedCount = 0;

    for (const wallet of wallets) {
        // Lógica de seguridad: Si el bloque guardado es muy viejo, no escaneamos millones de bloques.
        // Escaneamos máximo los últimos 1000 bloques (~1 hora) en cada pasada del Cron.
        // Si la wallet está nueva (0), empezamos desde ahora - 1000.
        let lastScanned = wallet.lastScannedBlock > 0 ? wallet.lastScannedBlock : (currentBlock - 1000);
        
        // Recuperación ante desastres: Si se quedó pegado muy atrás (> 5000 bloques)
        if ((currentBlock - lastScanned) > 5000) {
            console.warn(`[Scan Job] ⚠️ Wallet ${wallet.address} desincronizada. Saltando al presente.`);
            lastScanned = currentBlock - 200; 
        }

        let startBlock = lastScanned + 1;
        
        // Si ya está al día
        if (startBlock > currentBlock) continue;

        const endBlock = Math.min(startBlock + BATCH_SIZE_BSC, currentBlock);

        const success = await scanBscBlockRange(wallet, startBlock, endBlock);

        if (success) {
            await CryptoWallet.updateOne({ _id: wallet._id }, { lastScannedBlock: endBlock });
            updatedCount++;
        }
        
        // Pequeña pausa para no saturar CPU en serverless
        await sleep(20);
    }

    console.log(`🏁 [Scan Job] Terminado. Wallets actualizadas: ${updatedCount}`);
}

// --- EXPORTACIÓN (Aquí estaba el problema) ---
// Esta es la parte crítica. Debemos exportar 'forceScanNow'.
const startMonitoring = () => {
    console.log('✅ [Monitor Local] Loop iniciado.');
    setInterval(checkBscTransactions, 60000);
};

module.exports = { 
    startMonitoring, 
    forceScanNow: checkBscTransactions // <--- ESTA ES LA CLAVE
};
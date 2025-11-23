// RUTA: backend/services/transactionMonitor.js

const { ethers } = require('ethers');
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const { sendTelegramMessage } = require('./notificationService');
const { distributeCommission } = require('./referralService');

const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const BATCH_SIZE_BSC = 200; 

// 1. DEBUG: Verificar si la variable llega (Sin mostrarla toda por seguridad)
const rpcUrl = process.env.ANKR_BSC_RPC_URL;
if (!rpcUrl) {
    console.error("[MONITOR] ❌ ERROR: La variable ANKR_BSC_RPC_URL está vacía.");
} else {
    // Muestra los primeros 15 caracteres para que confirmes en logs si es la correcta
    console.log(`[MONITOR] Configurando RPC: ${rpcUrl.substring(0, 15)}...`);
}

// 2. CONFIGURACIÓN BLINDADA (StaticJsonRpcProvider)
// Usamos Static para evitar que ethers intente adivinar la red y falle por timeouts.
// Forzamos ChainID 56 (Binance Smart Chain Mainnet).
let provider;
try {
    provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
        name: 'binance',
        chainId: 56
    });
} catch (e) {
    console.error("[MONITOR] Error fatal al instanciar StaticProvider:", e.message);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- PROCESAR DEPÓSITO INDIVIDUAL ---
async function processDeposit(txHash, blockNumber, fromAddress, toAddress, rawAmount, wallet) {
    try {
        const existingTx = await User.findOne({ 'transactions.metadata.txid': txHash });
        if (existingTx) return; 

        const amountInUSDT = parseFloat(rawAmount);
        
        // Filtro anti-spam (>= 0.5 USDT para evitar polvo)
        if (amountInUSDT < 0.5) return;

        console.log(`💰 [MONITOR DETECTADO] TX: ${txHash} | ${amountInUSDT} USDT -> ${wallet.address}`);

        const user = await User.findById(wallet.user);
        if (!user) {
            console.error(`[Monitor] ❌ Error: Wallet huérfana ${wallet.address}`);
            return;
        }

        // Lógica de Transacción
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

        // Actualizar Saldos
        user.balance.usdt = (user.balance.usdt || 0) + amountInUSDT;
        user.totalRecharge = (user.totalRecharge || 0) + amountInUSDT;
        user.transactions.push(newTransaction);
        
        await user.save();
        console.log(`✅ [Monitor] Acreditado a ${user.username || user.telegramId}.`);

        // Eventos asíncronos
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
        // Si esto falla, la RPC está caída o mal configurada
        console.error("[Monitor] 🔴 Fallo RPC al obtener bloque:", error.message);
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
            ethers.utils.hexZeroPad(wallet.address, 32) // To: Wallet del usuario
        ]
    };

    try {
        const logs = await provider.getLogs(filter);
        if (logs.length > 0) {
            console.log(`⚡ [Monitor] ${logs.length} eventos encontrados en ${wallet.address} (${startBlock}-${endBlock})`);
            for (const log of logs) {
                const fromAddress = ethers.utils.getAddress('0x' + log.topics[1].substring(26));
                const rawAmount = ethers.BigNumber.from(log.data);
                const amount = ethers.utils.formatUnits(rawAmount, 18);
                await processDeposit(log.transactionHash, log.blockNumber, fromAddress, wallet.address, amount, wallet);
            }
        }
        return true;
    } catch (error) {
        console.error(`[Monitor] Error escaneando rango ${startBlock}-${endBlock}:`, error.message);
        return false;
    }
}

// --- FUNCIÓN PRINCIPAL DEL CRON ---
async function checkBscTransactions() {
    console.log(`🏁 [Scan Job] Iniciando escaneo masivo con StaticProvider (BSC:56)...`);
    
    const currentBlock = await getCurrentBscBlock();
    if (!currentBlock) {
        console.log(`[Scan Job] Abortado: No hay respuesta RPC.`);
        return;
    }

    // Buscar wallets de usuarios
    const wallets = await CryptoWallet.find({ chain: 'BSC' });
    if (wallets.length === 0) {
        console.log(`[Scan Job] 0 wallets encontradas en DB para escanear.`);
        return;
    }

    console.log(`[Scan Job] Escaneando ${wallets.length} wallets hasta Bloque ${currentBlock}`);

    let updatedCount = 0;

    for (const wallet of wallets) {
        // Buffer de seguridad: Empezamos 200 bloques atrás si está "al día" para asegurar reorgs cortos
        // Si la wallet es nueva, 1000 atrás.
        let lastScanned = wallet.lastScannedBlock > 0 ? (wallet.lastScannedBlock - 10) : (currentBlock - 1000);
        
        // Safety Check: Si el desfase es gigante (>5000 bloques), salta al presente para no colgar Vercel.
        // (Para tus depósitos perdidos, si fueron hoy, 5000 bloques = ~4 horas, debería alcanzarlos)
        if ((currentBlock - lastScanned) > 5000) {
            console.warn(`[Scan Job] ⚠️ Wallet ${wallet.address} con desfase extremo. Saltando al presente (-500).`);
            lastScanned = currentBlock - 500; 
        }

        let startBlock = lastScanned + 1;
        
        if (startBlock > currentBlock) continue;

        const endBlock = Math.min(startBlock + BATCH_SIZE_BSC, currentBlock);

        const success = await scanBscBlockRange(wallet, startBlock, endBlock);

        if (success) {
            // Solo avanzamos el puntero si el escaneo fue exitoso
            await CryptoWallet.updateOne({ _id: wallet._id }, { lastScannedBlock: endBlock });
            updatedCount++;
        }
        
        // Breve pausa para evitar rate-limit del proveedor
        await sleep(50);
    }

    console.log(`🏁 [Scan Job] Finalizado. ${updatedCount}/${wallets.length} wallets procesadas.`);
}

// Exports
const startMonitoring = () => {
    console.log('✅ [Monitor Local] Loop iniciado.');
    setInterval(checkBscTransactions, 60000);
};

module.exports = { 
    startMonitoring, 
    forceScanNow: checkBscTransactions 
};
// RUTA: backend/services/transactionMonitor.js

const { ethers } = require('ethers');
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const { sendTelegramMessage } = require('./notificationService');
const { distributeCommission } = require('./referralService');

const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';

// CAMBIO 1: Batch size reducido para nodos públicos (más lento pero más seguro)
const BATCH_SIZE_BSC = 500; 

// Verificación básica
const rpcUrl = process.env.ANKR_BSC_RPC_URL;
if (!rpcUrl) {
    console.error("[MONITOR] ❌ ERROR FATAL: ANKR_BSC_RPC_URL no definida.");
} else {
    console.log(`[MONITOR] RPC Activo: ${rpcUrl.substring(0, 15)}...`);
}

// Proveedor Estático (Evita autodetección que falla en serverless)
let provider;
try {
    provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, {
        name: 'binance',
        chainId: 56
    });
} catch (e) {
    console.error("[MONITOR] Error provider:", e.message);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- PROCESAMIENTO DE DEPÓSITO ---
async function processDeposit(txHash, blockNumber, fromAddress, toAddress, rawAmount, wallet) {
    try {
        // Evitar duplicados
        const existingTx = await User.findOne({ 'transactions.metadata.txid': txHash });
        if (existingTx) {
            console.log(`🔸 [Monitor] TX Repetida: ${txHash}`);
            return; 
        }

        const amountInUSDT = parseFloat(rawAmount);
        
        // Ignorar micro-dust (< 0.5 USDT)
        if (amountInUSDT < 0.5) return;

        console.log(`💰 [CRÍTICO] DINERO DETECTADO: ${amountInUSDT} USDT -> ${wallet.address} (TX: ${txHash})`);

        const user = await User.findById(wallet.user);
        if (!user) {
            console.error(`[Monitor] ❌ ERROR: Wallet ${wallet.address} sin usuario asignado.`);
            return;
        }

        // Lógica de negocio
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

        // Actualización Atómica
        user.balance.usdt = (user.balance.usdt || 0) + amountInUSDT;
        user.totalRecharge = (user.totalRecharge || 0) + amountInUSDT;
        user.transactions.push(newTransaction);
        
        await user.save();
        console.log(`✅ [Monitor] Saldo aplicado a: ${user.username || user.telegramId}`);

        // Notificaciones (Fire & Forget)
        if (user.telegramId) {
            sendTelegramMessage(user.telegramId, `✅ <b>¡Depósito Recibido!</b>\n\n+${amountInUSDT.toFixed(2)} USDT agregados.`).catch(()=>{});
        }
        if (user.referredBy) {
            distributeCommission(user, amountInUSDT).catch(console.error);
        }

    } catch (error) {
        console.error(`[Monitor] ❌ Error procesando TX:`, error);
    }
}

async function getCurrentBscBlock() {
    if (!provider) return null;
    try {
        return await provider.getBlockNumber();
    } catch (error) {
        console.error("[Monitor] Fallo RPC (getBlockNumber):", error.message);
        return null;
    }
}

// Escaneo de rango
async function scanBscBlockRange(wallet, startBlock, endBlock) {
    if (!provider) return false;

    try {
        // Normalización estricta de dirección (Checksum)
        // Esto asegura que 0xabcd sea igual a 0xAbCd
        const checksumAddress = ethers.utils.getAddress(wallet.address);
        const addressTopic = ethers.utils.hexZeroPad(checksumAddress, 32);

        const filter = {
            address: USDT_CONTRACT_BSC,
            fromBlock: startBlock,
            toBlock: endBlock,
            topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Topic 0: Transfer
                null, // Topic 1: From (Cualquiera)
                addressTopic // Topic 2: To (Nuestra wallet)
            ]
        };

        const logs = await provider.getLogs(filter);
        
        if (logs.length > 0) {
            console.log(`⚡ [SCAN] Encontrados ${logs.length} eventos. Procesando...`);
            for (const log of logs) {
                const fromAddress = ethers.utils.getAddress('0x' + log.topics[1].substring(26));
                const rawAmount = ethers.BigNumber.from(log.data);
                const amount = ethers.utils.formatUnits(rawAmount, 18);
                await processDeposit(log.transactionHash, log.blockNumber, fromAddress, checksumAddress, amount, wallet);
            }
        } else {
            // LOG DEBUG: Descomentar si quieres ver que escanea pero no encuentra nada
            // console.log(`[SCAN] ${startBlock}-${endBlock}: Sin eventos.`);
        }
        return true; // Scan OK (aunque no haya eventos)

    } catch (error) {
        console.error(`[Monitor] Error en getLogs (${startBlock}-${endBlock}):`, error.message);
        return false; // Scan Failed
    }
}

// --- MOTOR DE ESCANEO ---
async function checkBscTransactions() {
    const currentBlock = await getCurrentBscBlock();
    if (!currentBlock) {
        console.log(`[Scan] Error RPC. Reintentando luego.`);
        return;
    }

    // 1. Cargar Wallets
    const wallets = await CryptoWallet.find({ chain: 'BSC' });
    if (wallets.length === 0) return;

    console.log(`🔍 [CronScan] Wallets: ${wallets.length} | Bloque Red: ${currentBlock}`);

    for (const wallet of wallets) {
        
        // Si la wallet no tiene lastScannedBlock (es 0 o null), iniciamos 200 bloques atrás
        let startBlock = wallet.lastScannedBlock > 0 ? (wallet.lastScannedBlock + 1) : (currentBlock - 200);
        
        // CAMBIO CRÍTICO 2: ELIMINADA LA LÓGICA DE SALTO AL PRESENTE
        // Antes: Si (Red - Start > 5000) -> Saltar.
        // Ahora: Si (Red - Start > 5000) -> Aviso en consola, pero ESCANEAMOS.
        // Solo saltamos si la diferencia es absurda (> 50000 bloques, varios días) para no matar la CPU
        if ((currentBlock - startBlock) > 50000) {
            console.warn(`⚠️ [Monitor] Wallet ${wallet.address} atrasada >3 días. Saltando.`);
            startBlock = currentBlock - 200; 
        } else if ((currentBlock - startBlock) > 2000) {
            console.log(`ℹ️ [Monitor] Recuperando historial para ${wallet.address} (Atraso: ${currentBlock - startBlock} bloques).`);
        }

        // Si ya estamos al día
        if (startBlock > currentBlock) continue;

        // Escaneo secuencial rápido
        const endBlock = Math.min(startBlock + BATCH_SIZE_BSC, currentBlock);
        const success = await scanBscBlockRange(wallet, startBlock, endBlock);

        if (success) {
            // Solo guardamos el progreso si la RPC respondió bien
            await CryptoWallet.updateOne({ _id: wallet._id }, { lastScannedBlock: endBlock });
        }
        
        // Breve espera (Respeto al nodo público)
        await sleep(100); 
    }
    console.log(`🏁 [CronScan] Fin del ciclo.`);
}

// Exports
const startMonitoring = () => {
    console.log('✅ Loop Local Iniciado.');
    setInterval(checkBscTransactions, 60000);
};

module.exports = { 
    startMonitoring, 
    forceScanNow: checkBscTransactions 
};
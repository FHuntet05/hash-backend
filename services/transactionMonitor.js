// backend/services/transactionMonitor.js

const { ethers } = require('ethers');
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const { sendTelegramMessage } = require('./notificationService');
const { distributeCommission } = require('./referralService');

const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955'; 
// Para pruebas locales puedes bajar el batch size si da timeout
const BATCH_SIZE_BSC = 2000; 

if (!process.env.ANKR_BSC_RPC_URL) {
    console.error("[MONITOR] ERROR FATAL: ANKR_BSC_RPC_URL faltante.".red.bold);
    process.exit(1);
}
const provider = new ethers.providers.JsonRpcProvider(process.env.ANKR_BSC_RPC_URL);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function processDeposit(txHash, blockNumber, fromAddress, toAddress, amount, wallet) {
    // 1. Evitar duplicados
    const existingTx = await User.findOne({ 'transactions.metadata.txid': txHash });
    if (existingTx) return; 

    const amountInUSDT = parseFloat(amount);
    console.log(`[Deposit] Procesando ${amountInUSDT} USDT para wallet ${wallet.address} (User ID: ${wallet.user})`);

    const user = await User.findById(wallet.user);
    if (!user) return;

    // 2. Crear Transacción
    const newTransaction = {
        type: 'deposit',
        amount: amountInUSDT,
        currency: 'USDT',
        description: `Depósito confirmado`,
        status: 'completed',
        metadata: {
            txid: txHash,
            chain: wallet.chain,
            fromAddress,
            toAddress,
            blockIdentifier: blockNumber.toString()
        }
    };

    // 3. ACTUALIZACIÓN CRÍTICA DE SALDOS
    user.balance.usdt = (user.balance.usdt || 0) + amountInUSDT;
    
    // ESTO ES VITAL PARA LAS TAREAS: Acumular el total recargado
    user.totalRecharge = (user.totalRecharge || 0) + amountInUSDT;
    
    user.transactions.push(newTransaction);
    
    // Guardamos usuario actualizado
    await user.save();
    
    console.log(`[Deposit] ✅ Usuario ${user.username} acreditado. Total Recargado Histórico: ${user.totalRecharge}`.green);
    
    // 4. Distribuir Comisiones (Referral Service)
    if (user.referredBy) {
        // Ejecutamos asíncronamente para no bloquear
        distributeCommission(user, amountInUSDT).catch(err => console.error("Error distribuyendo comisión:", err));
        
        // NOTIFICACIÓN AL PADRE (Opcional pero recomendado)
        // Podríamos avisar al padre: "¡Tu amigo depositó! Revisa tus tareas."
    }
    
    // 5. Notificar al usuario
    if (user.telegramId) {
        await sendTelegramMessage(user.telegramId, `✅ <b>Depósito Recibido</b>\n\n+${amountInUSDT.toFixed(2)} USDT han sido añadidos a tu cuenta.`);
    }
}

// ... (El resto del código de escaneo de bloques se mantiene igual que la versión anterior) ...
// ... (Solo asegúrate de mantener getCurrentBscBlock, scanBscBlockRange, checkBscTransactions y startMonitoring) ...

async function getCurrentBscBlock() {
    try {
        return await provider.getBlockNumber();
    } catch (error) {
        console.error("Error obteniendo bloque BSC:", error.message);
        return null;
    }
}

async function scanBscBlockRange(wallet, startBlock, endBlock) {
    try {
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const filter = {
            address: USDT_CONTRACT_BSC,
            fromBlock: startBlock,
            toBlock: endBlock,
            topics: [transferTopic, null, ethers.utils.hexZeroPad(wallet.address, 32)]
        };
        const logs = await provider.getLogs(filter);
        for (const log of logs) {
            const fromAddress = ethers.utils.getAddress('0x' + log.topics[1].substring(26));
            const amount = ethers.utils.formatUnits(log.data, 18);
            await processDeposit(log.transactionHash, log.blockNumber, fromAddress, wallet.address, amount, wallet);
        }
        return true;
    } catch (error) {
        console.error(`Error escaneando ${wallet.address}:`, error.message);
        return false;
    }
}

async function checkBscTransactions() {
    // Lógica de paginación estándar (reutiliza la que tenías o esta simplificada)
    const wallets = await CryptoWallet.find({ chain: 'BSC' });
    if (!wallets.length) return;
    const currentBlock = await getCurrentBscBlock();
    if (!currentBlock) return;

    for (const wallet of wallets) {
        let lastScanned = wallet.lastScannedBlock || (currentBlock - 100);
        // Límite de seguridad para no escanear demasiado atrás si el servidor estuvo apagado
        if (currentBlock - lastScanned > 5000) lastScanned = currentBlock - 5000; 

        const toBlock = currentBlock;
        if (toBlock > lastScanned) {
            const success = await scanBscBlockRange(wallet, lastScanned + 1, toBlock);
            if (success) {
                await CryptoWallet.findByIdAndUpdate(wallet._id, { lastScannedBlock: toBlock });
            }
        }
        await sleep(200); // Pequeña pausa para no saturar RPC
    }
}

const startMonitoring = () => {
    console.log('✅ Servicio de Monitoreo de Depósitos Iniciado'.cyan.bold);
    setInterval(checkBscTransactions, 60000); // Cada 1 minuto
};

module.exports = { startMonitoring };
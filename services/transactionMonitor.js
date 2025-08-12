// backend/services/transactionMonitor.js (VERSIÓN v36.0 - SISTEMA TRON ELIMINADO)

const axios = require('axios');
const User = require('../models/userModel');
const Transaction = require('../models/transactionModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const PendingTx = require('../models/pendingTxModel');
const { ethers } = require('ethers');
// ELIMINADO: const TronWeb = require('tronweb');
const { sendTelegramMessage } = require('./notificationService');
const { getPrice } = require('./priceService');

// --- CONFIGURACIÓN DE CONSTANTES ---
const USDT_CONTRACT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const BUSD_CONTRACT_BSC = '0xe9e7CEA3DedcA5984780Bf86fEE1060eC3d'; // Nota: BUSD será eventualmente deprecado.
const BSC_STABLECOIN_CONTRACTS = [USDT_CONTRACT_BSC.toLowerCase(), BUSD_CONTRACT_BSC.toLowerCase()];
// ELIMINADO: const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BSC_API_KEY = process.env.BSCSCAN_API_KEY;
// ELIMINADO: const TRON_API_KEY = process.env.TRONGRID_API_KEY;
const BATCH_SIZE_BSC = 500;
const SYNC_THRESHOLD_BSC = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function makeHttpRequestWithRetries(url, config = {}, retries = 0) {
    try {
        return await axios.get(url, config);
    } catch (error) {
        if (retries < MAX_RETRIES) {
            const delay = RETRY_DELAY_MS * Math.pow(2, retries);
            console.warn(`[HTTP_RETRY] Intento ${retries + 1} fallido para ${url}. Reintentando en ${delay / 1000}s. Error: ${error.message}`);
            await sleep(delay);
            return makeHttpRequestWithRetries(url, config, retries + 1);
        } else {
            throw error;
        }
    }
}

async function processDeposit(tx, wallet, amount, currency, txid, blockIdentifier) {
    const existingTx = await Transaction.findOne({ 'metadata.txid': txid });
    if (existingTx) { return; }

    console.log(`[ProcessDeposit] Procesando nuevo depósito: ${amount} ${currency} para usuario ${wallet.user} (TXID: ${txid})`);
    
    // MODIFICADO: Se elimina la condición para 'TRX' ya que solo se procesará 'BNB' o estables.
    const price = (currency === 'BNB') ? await getPrice(currency) : 1;
    if (!price) {
        console.error(`[ProcessDeposit] PRECIO NO ENCONTRADO para ${currency}. Saltando transacción ${txid}.`);
        return;
    }

    const amountInUSDT = amount * price;
    
    const user = await User.findByIdAndUpdate(
        wallet.user, 
        { $inc: { 'balance.usdt': amountInUSDT, 'totalRecharge': amountInUSDT } }, 
        { new: true }
    );
    
    if (!user) {
        console.error(`[ProcessDeposit] Usuario no encontrado para wallet ${wallet._id}. Abortando depósito.`);
        return;
    }

    // MODIFICADO: Se simplifica la obtención de direcciones al eliminar el formato de Tron.
    const fromAddress = tx.from;
    const toAddress = tx.to;

    await Transaction.create({
        user: wallet.user, type: 'deposit', amount: amountInUSDT, currency: 'USDT',
        description: `Depósito de ${amount.toFixed(6)} ${currency} acreditado como ${amountInUSDT.toFixed(2)} USDT`,
        metadata: {
            txid: txid, chain: wallet.chain, fromAddress: fromAddress, toAddress: toAddress,
            originalAmount: amount.toString(), originalCurrency: currency, priceUsed: price.toString(),
            blockIdentifier: blockIdentifier.toString(),
        }
    });

    console.log(`[ProcessDeposit] ✅ ÉXITO: Usuario ${user.username} acreditado con ${amountInUSDT.toFixed(2)} USDT.`);
    
    if (user.telegramId) {
        const message = `✅ <b>¡Depósito confirmado!</b>\n\nSe han acreditado <b>${amountInUSDT.toFixed(2)} USDT</b> a tu saldo.`;
        await sendTelegramMessage(user.telegramId, message);
    }
}

async function getCurrentBscBlock() {
    try {
        const url = `https://api.bscscan.com/api?module=proxy&action=eth_blockNumber&apikey=${BSC_API_KEY}`;
        const response = await makeHttpRequestWithRetries(url, { timeout: 10000 });
        if (response.data && response.data.result) {
            return parseInt(response.data.result, 16);
        } else {
            console.error("[Monitor BSC] La respuesta de BscScan no contiene 'result' o es nula.");
            return null;
        }
    } catch (error) {
        console.error(`[Monitor BSC] Excepción al obtener bloque actual: ${error.message}`);
        return null;
    }
}

async function scanBscBlockRange(wallet, startBlock, endBlock) {
    try {
        console.log(`[Monitor BSC] Escaneando ${wallet.address} de ${startBlock} a ${endBlock}`);
        
        const allTokenTxUrl = `https://api.bscscan.com/api?module=account&action=tokentx&address=${wallet.address}&startblock=${startBlock}&endblock=${endBlock}&sort=asc&apikey=${BSC_API_KEY}`;
        const allTokenTxResponse = await makeHttpRequestWithRetries(allTokenTxUrl, { timeout: 15000 });
        
        if (allTokenTxResponse.data.status === '1' && Array.isArray(allTokenTxResponse.data.result)) {
            for (const tx of allTokenTxResponse.data.result) {
                const txContractAddressLower = tx.contractAddress ? tx.contractAddress.toLowerCase() : null;
                if (tx.to.toLowerCase() === wallet.address.toLowerCase() && BSC_STABLECOIN_CONTRACTS.includes(txContractAddressLower)) {
                    const amount = parseFloat(ethers.utils.formatUnits(tx.value, tx.tokenDecimal));
                    const originalCurrency = txContractAddressLower === USDT_CONTRACT_BSC.toLowerCase() ? 'USDT' : 'BUSD';
                    await processDeposit(tx, wallet, amount, originalCurrency, tx.hash, tx.blockNumber);
                }
            }
        }
        await sleep(300);

        const bnbUrl = `https://api.bscscan.com/api?module=account&action=txlist&address=${wallet.address}&startblock=${startBlock}&endblock=${endBlock}&sort=asc&apikey=${BSC_API_KEY}`;
        const bnbResponse = await makeHttpRequestWithRetries(bnbUrl, { timeout: 15000 });

        if (bnbResponse.data.status === '1' && Array.isArray(bnbResponse.data.result)) {
            for (const tx of bnbResponse.data.result) {
                if (tx.to.toLowerCase() === wallet.address.toLowerCase() && tx.value !== "0") {
                    const amount = parseFloat(ethers.utils.formatEther(tx.value));
                    await processDeposit(tx, wallet, amount, 'BNB', tx.hash, tx.blockNumber);
                }
            }
        }
    } catch (error) {
        console.error(`[Monitor BSC] EXCEPCIÓN al escanear rango ${startBlock}-${endBlock} para ${wallet.address}: ${error.message}`);
    }
}

async function checkBscTransactions() {
    console.log("[Monitor BSC] Iniciando ciclo de escaneo STATEFUL para BSC.");
    const wallets = await CryptoWallet.find({ chain: 'BSC' });
    if (wallets.length === 0) {
        console.log("[Monitor BSC] No hay billeteras BSC para escanear.");
        return;
    }

    const currentNetworkBlock = await getCurrentBscBlock();
    if (!currentNetworkBlock) {
        console.error("[Monitor BSC] No se pudo obtener el bloque actual de la red. Saltando ciclo.");
        return;
    }
    console.log(`[Monitor BSC] Encontradas ${wallets.length} wallets. Bloque de red actual: ${currentNetworkBlock}`);

    for (const wallet of wallets) {
        let lastScanned = wallet.lastScannedBlock || 0; 
        const blocksBehind = currentNetworkBlock - lastScanned;

        if (blocksBehind > SYNC_THRESHOLD_BSC) {
            console.log(`[Monitor BSC] Sincronización en lotes para ${wallet.address}. ${blocksBehind} bloques de diferencia.`);
            let fromBlock = lastScanned + 1;
            while (fromBlock < currentNetworkBlock) {
                const toBlock = Math.min(fromBlock + BATCH_SIZE_BSC - 1, currentNetworkBlock);
                await scanBscBlockRange(wallet, fromBlock, toBlock);
                await CryptoWallet.findByIdAndUpdate(wallet._id, { lastScannedBlock: toBlock });
                fromBlock = toBlock + 1;
                await sleep(550);
            }
        } else if (blocksBehind > 0) {
            const startBlock = lastScanned + 1;
            await scanBscBlockRange(wallet, startBlock, currentNetworkBlock);
        }

        await CryptoWallet.findByIdAndUpdate(wallet._id, { lastScannedBlock: currentNetworkBlock });
        await sleep(550);
    }
}

// ELIMINADO: Función scanTronAddress()
// ELIMINADO: Función checkTronTransactions()

async function processPendingTransactionsStatus() {
    const pendingTxs = await PendingTx.find({ status: 'PENDING' });
    if (pendingTxs.length === 0) { 
        return; 
    }
    
    console.log(`[Monitor PendingTx] Verificando ${pendingTxs.length} transacciones con estado PENDING...`);
    for (const tx of pendingTxs) {
        try {
            let isConfirmed = false;
            let txFailed = false;

            // MODIFICADO: Se elimina el bloque 'else if' de TRON. Solo queda la lógica de BSC.
            if (tx.chain === 'BSC') {
                const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
                const receipt = await bscProvider.getTransactionReceipt(tx.txHash);
                if (receipt) {
                    if (receipt.status === 1) isConfirmed = true;
                    if (receipt.status === 0) txFailed = true;
                }
            }

            if (isConfirmed) {
                tx.status = 'CONFIRMED';
                console.log(`[Monitor PendingTx] ✅ Transacción ${tx.txHash} (${tx.chain}) CONFIRMADA.`);
            } else if (txFailed) {
                 tx.status = 'FAILED';
                 console.log(`[Monitor PendingTx] ❌ Transacción ${tx.txHash} (${tx.chain}) FALLIDA.`);
            }
            tx.lastChecked = new Date();
            await tx.save();

        } catch (error) {
            console.error(`[Monitor PendingTx] Error al verificar tx ${tx.txHash}:`, error.message);
        }
        await sleep(200);
    }
}

const startMonitoring = () => {
  // MODIFICADO: Mensaje de inicio para reflejar solo BSC.
  console.log('✅ Iniciando servicio de monitoreo de transacciones (BSC)...');
  const runChecks = async () => {
    console.log("--- [Monitor] Iniciando ciclo de monitoreo de la red BSC ---");
    // MODIFICADO: Se elimina la llamada a checkTronTransactions del Promise.all.
    await Promise.all([
        checkBscTransactions(),
        processPendingTransactionsStatus() 
    ]);
    console.log("--- [Monitor] Ciclo de monitoreo finalizado. Esperando al siguiente. ---");
  };
  runChecks();
  setInterval(runChecks, 60000); 
};

module.exports = { startMonitoring };
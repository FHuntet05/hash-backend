// RUTA: backend/services/transactionService.js (v38.0 - SISTEMA TRON ELIMINADO)

const { ethers } = require('ethers');
// ELIMINADO: const TronWeb = require('tronweb').default.TronWeb;
const PendingTx = require('../models/pendingTxModel');

// ELIMINADO: const USDT_TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const USDT_BSC_ABI = ['function transfer(address, uint256)', 'function balanceOf(address) view returns (uint256)'];


function promiseWithTimeout(promise, ms, timeoutMessage = 'Operación excedió el tiempo de espera.') {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => { clearTimeout(id); reject(new Error(timeoutMessage)); }, ms);
  });
  return Promise.race([promise, timeout]);
}

const getCentralWallets = () => {
    if (!process.env.MASTER_SEED_PHRASE || !ethers.utils.isValidMnemonic(process.env.MASTER_SEED_PHRASE)) {
        throw new Error("CRITICAL: MASTER_SEED_PHRASE no está definida o es inválida.");
    }
    
    const masterNode = ethers.utils.HDNode.fromMnemonic(process.env.MASTER_SEED_PHRASE);

    const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
    const bscNode = masterNode.derivePath(`m/44'/60'/0'/0/0`);
    const bscWallet = new ethers.Wallet(bscNode.privateKey, bscProvider);

    // MODIFICADO: Se elimina toda la lógica de derivación de TRON.
    return {
        bscWallet,
    };
};

// ELIMINADO: Función sweepUsdtOnTronFromDerivedWallet

const sweepUsdtOnBscFromDerivedWallet = async (derivationIndex, destinationAddress) => {
    if (derivationIndex === undefined || !destinationAddress) throw new Error("Índice de derivación y dirección de destino son requeridos.");
    
    const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
    const hdNode = ethers.utils.HDNode.fromMnemonic(process.env.MASTER_SEED_PHRASE);
    const depositWalletNode = hdNode.derivePath(`m/44'/60'/0'/0/${derivationIndex}`);
    const depositWallet = new ethers.Wallet(depositWalletNode.privateKey, bscProvider);
    const usdtContract = new ethers.Contract(USDT_BSC_ADDRESS, USDT_BSC_ABI, depositWallet);
    
    const usdtBalance = await new ethers.Contract(USDT_BSC_ADDRESS, USDT_BSC_ABI, bscProvider).balanceOf(depositWallet.address);
    if (usdtBalance.isZero()) throw new Error(`La wallet ${depositWallet.address} no tiene saldo de USDT (BSC) para barrer.`);
    
    console.log(`[SweepService] Iniciando barrido de ${ethers.utils.formatUnits(usdtBalance, 18)} USDT (BSC) desde ${depositWallet.address}`);
    try {
        const tx = await usdtContract.transfer(destinationAddress, usdtBalance);
        await PendingTx.create({
            txHash: tx.hash,
            chain: 'BSC',
            type: 'USDT_SWEEP',
            metadata: new Map([['from', depositWallet.address], ['to', destinationAddress], ['amount', ethers.utils.formatUnits(usdtBalance, 18)]])
        });
        console.log(`[SweepService] Barrido de ${depositWallet.address} (BSC) iniciado. Hash: ${tx.hash}`);
        return tx.hash;
    } catch(error) {
        console.error(`[SweepService] ERROR al barrer ${depositWallet.address} (BSC):`, error);
        throw new Error(`Fallo en la transacción de barrido BSC. Detalles: ${error.message}`);
    }
};

const sweepBnbFromDerivedWallet = async (derivationIndex, recipientAddress) => {
    try {
        const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
        const centralMnemonic = process.env.MASTER_SEED_PHRASE;
        if (!centralMnemonic) {
            throw new Error('El mnemónico de la billetera central no está configurado.');
        }

        const derivedWalletPath = `m/44'/60'/0'/0/${derivationIndex}`;
        const derivedWallet = ethers.Wallet.fromMnemonic(centralMnemonic, derivedWalletPath).connect(bscProvider);

        const balance = await bscProvider.getBalance(derivedWallet.address);
        if (balance.isZero()) {
            throw new Error('No hay BNB para barrer en esta wallet.');
        }
        
        const gasPrice = await bscProvider.getGasPrice();
        const gasLimit = ethers.BigNumber.from(21000);
        const txFee = gasPrice.mul(gasLimit);

        if (balance.lte(txFee)) {
            throw new Error(`Saldo insuficiente para cubrir la tarifa de gas. Saldo: ${ethers.utils.formatEther(balance)}, Tarifa: ${ethers.utils.formatEther(txFee)}`);
        }
        
        const amountToSend = balance.sub(txFee);

        const tx = await derivedWallet.sendTransaction({
            to: recipientAddress,
            value: amountToSend,
            gasPrice: gasPrice,
            gasLimit: gasLimit
        });

        console.log(`[Sweep BNB] Iniciando barrido de ${ethers.utils.formatEther(amountToSend)} BNB desde wallet ${derivedWallet.address} (índice ${derivationIndex})`);
        
        const receipt = await tx.wait();
        console.log(`[Sweep BNB] Barrido completado. Hash: ${receipt.transactionHash}`);
        
        return receipt.transactionHash;
    } catch (error) {
        console.error(`Error barriendo BNB desde índice ${derivationIndex}:`, error);
        throw new Error(error.message || 'Error desconocido durante el barrido de BNB.');
    }
};

const sendBscGas = async (toAddress, amountInBnb) => {
    const { bscWallet } = getCentralWallets();
    console.log(`[GasDispenser] Enviando ${amountInBnb} BNB desde ${bscWallet.address} a ${toAddress}`);
    try {
        const tx = { to: toAddress, value: ethers.utils.parseEther(amountInBnb.toString()) };
        const txResponse = await bscWallet.sendTransaction(tx);
        await PendingTx.create({
            txHash: txResponse.hash,
            chain: 'BSC',
            type: 'GAS_DISPATCH',
            metadata: new Map([['to', toAddress], ['amount', amountInBnb.toString()]])
        });
        await txResponse.wait();
        return txResponse.hash;
    } catch (error) {
        console.error(`[GasDispenser] ERROR enviando BNB a ${toAddress}:`, error);
        throw new Error(`Fallo al enviar BNB: ${error.reason || error.message}`);
    }
};

// ELIMINADO: Función sendTronTrx

// MODIFICADO: Se eliminan las funciones de TRON de los exports.
module.exports = {
  sweepUsdtOnBscFromDerivedWallet,
  sendBscGas,
  getCentralWallets,
  sweepBnbFromDerivedWallet
};
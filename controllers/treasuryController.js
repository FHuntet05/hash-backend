// backend/controllers/treasuryController.js (VERSIÓN v19.0 - SÓLO BSC)
const { ethers } = require('ethers');
// ELIMINADO: const TronWeb = require('tronweb').default.TronWeb; 
const User = require('../models/userModel');
const CryptoWallet = require('../models/cryptoWalletModel');
const Transaction = require('../models/transactionModel');
const asyncHandler = require('express-async-handler');
const transactionService = require('../services/transactionService');
const mongoose = require('mongoose');

const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
// ELIMINADO: const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io', headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY } });
// ELIMINADO: const USDT_TRON_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const USDT_ABI = ['function balanceOf(address) view returns (uint256)'];
const usdtBscContract = new ethers.Contract(USDT_BSC_ADDRESS, USDT_ABI, bscProvider);

function promiseWithTimeout(promise, ms, timeoutMessage = 'Operación excedió el tiempo de espera.') {
  const timeout = new Promise((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(timeoutMessage));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

// NOTA: La función registerDeposit se mantiene ya que su lógica es agnóstica de la cadena
// y depende de los datos que le lleguen, que ahora solo serán de BSC.
async function registerDeposit(wallet, amount, currency) {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const numericAmount = parseFloat(amount);
        const txIdentifier = `${wallet.address}-${numericAmount.toFixed(8)}-${currency}`;

        const existingTx = await Transaction.findOne({ 'metadata.identifier': txIdentifier }).session(session);

        if (!existingTx) {
            const newTx = new Transaction({
                user: wallet.user,
                type: 'deposit',
                currency: currency,
                amount: numericAmount,
                status: 'completed',
                description: `Depósito detectado en ${wallet.chain} wallet`,
                metadata: {
                    walletAddress: wallet.address,
                    identifier: txIdentifier,
                },
            });
            await newTx.save({ session });
            await User.updateOne({ _id: wallet.user }, { $inc: { 'balance.usdt': numericAmount } }).session(session);
            console.log(`Depósito de ${amount} ${currency} registrado para usuario con ID ${wallet.user}`);
        }
        await session.commitTransaction();
    } catch (e) {
        await session.abortTransaction();
        console.error(`Error al registrar depósito para wallet ${wallet.address}: ${e.message}`);
    } finally {
        session.endSession();
    }
}

const getSweepableWallets = asyncHandler(async (req, res) => {
    console.log('[Treasury] Iniciando escaneo de wallets en tiempo real...');
    // MODIFICADO: Solo buscamos wallets BSC.
    const allWallets = await CryptoWallet.find({ chain: 'BSC' }).populate('user', '_id').lean();
    
    const scanPromises = allWallets.map(async (wallet) => {
        let detectedBalances = [];
        if (!wallet.user) return;
        try {
            // MODIFICADO: Se elimina el bloque 'if/else' y solo se ejecuta la lógica BSC.
            const usdtBalanceRaw = await promiseWithTimeout(usdtBscContract.balanceOf(wallet.address), 15000);
            if (usdtBalanceRaw.gt(0)) {
                const usdtAmount = ethers.utils.formatUnits(usdtBalanceRaw, 18);
                // MODIFICADO: La moneda ahora es simplemente USDT.
                detectedBalances.push({ currency: 'USDT', amount: usdtAmount });
                await registerDeposit(wallet, usdtAmount, 'USDT');
            }
        } catch(e) {
            console.error(`[Treasury] Error escaneando wallet ${wallet.address}: ${e.message}`);
        }
        await CryptoWallet.updateOne({ _id: wallet._id }, { $set: { balances: detectedBalances } });
    });

    await Promise.all(scanPromises);
    console.log('[Treasury] Escaneo de wallets completado.');

    const limit = parseInt(req.query.limit) || 20;
    const page = parseInt(req.query.page) || 1;
    const filter = { 'balances.0': { '$exists': true } };

    const totalWalletsWithBalance = await CryptoWallet.countDocuments(filter);
    const walletsToReturn = await CryptoWallet.find(filter)
        .populate('user', 'username')
        .limit(limit)
        .skip(limit * (page - 1))
        .lean();

    res.status(200).json({ 
        wallets: walletsToReturn, 
        page, 
        pages: Math.ceil(totalWalletsWithBalance / limit), 
        total: totalWalletsWithBalance 
    });
});

const getHotWalletBalances = asyncHandler(async (req, res) => {
    // MODIFICADO: getCentralWallets ahora solo devuelve bscWallet.
    const { bscWallet } = transactionService.getCentralWallets();
    
    // MODIFICADO: Se eliminan las llamadas a la red Tron.
    const [ bnbBalance, usdtBscBalance ] = await Promise.all([
        promiseWithTimeout(bscProvider.getBalance(bscWallet.address), 10000),
        promiseWithTimeout(usdtBscContract.balanceOf(bscWallet.address), 10000),
    ]);
    
    res.json({
        BNB: ethers.utils.formatEther(bnbBalance),
        USDT_BSC: ethers.utils.formatUnits(usdtBscBalance, 18),
        // ELIMINADO: TRX y USDT_TRON
    });
});

const sweepWallet = asyncHandler(async (req, res) => {
    const { fromAddress, currency, destinationAddress, adminPassword } = req.body;
    if (!fromAddress || !currency || !destinationAddress || !adminPassword) {
        return res.status(400).json({ message: 'Todos los campos son requeridos para el barrido.' });
    }
    const adminUser = await User.findById(req.user.id).select('+password');
    if (!adminUser || !(await adminUser.matchPassword(adminPassword))) {
        return res.status(401).json({ message: 'Credenciales de administrador incorrectas.' });
    }
    const walletToSweep = await CryptoWallet.findOne({ address: fromAddress });
    if (!walletToSweep) return res.status(404).json({ message: `La wallet de depósito ${fromAddress} no se encontró.` });
    
    // MODIFICADO: Se elimina la lógica para TRON, solo queda BSC.
    if (currency !== 'USDT_BSC' && currency !== 'USDT') {
       return res.status(400).json({ message: `El barrido para ${currency} no está implementado. Solo se soporta USDT_BSC.` });
    }

    const txHash = await transactionService.sweepUsdtOnBscFromDerivedWallet(walletToSweep.derivationIndex, destinationAddress);
    
    await CryptoWallet.updateOne({ _id: walletToSweep._id }, { $set: { balances: [] } });

    await Transaction.create({ 
        user: adminUser._id, 
        type: 'sweep', 
        amount: 0,
        currency: currency, 
        status: 'completed', 
        description: `Barrido de ${currency} desde ${fromAddress} a ${destinationAddress}`, 
        metadata: { 
            transactionHash: txHash, 
            fromAddress, 
            destinationAddress, 
            sweptWalletId: walletToSweep._id.toString() 
        } 
    });
    res.json({ message: `Barrido de ${currency} desde ${fromAddress} iniciado.`, transactionHash: txHash });
});

module.exports = { getHotWalletBalances, sweepWallet, getSweepableWallets };
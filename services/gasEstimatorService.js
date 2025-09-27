// RUTA: backend/services/gasEstimatorService.js (v36.0 - EXCLUSIVO PARA BSC)
// DESCRIPCIÓN: Servicio optimizado para estimar costos de gas en la red BSC (BEP20).
// Se ha eliminado toda la lógica y dependencias relacionadas con Tron.

const { ethers } = require('ethers');
const transactionService = require('./transactionService');

const USDT_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const USDT_BSC_ABI = [
    'function transfer(address to, uint256 amount)',
    'function decimals() view returns (uint8)'
];

const bscProvider = new ethers.providers.JsonRpcProvider(process.env.ANKR_BSC_RPC_URL); // Usamos la variable de entorno ANKR para el RPC.

const MIN_BSC_GAS_PRICE_GWEI = 5;
const MIN_BSC_GAS_PRICE_WEI = ethers.BigNumber.from('5000000000'); // 5 Gwei en Wei (Formato robusto)

/**
 * Estima el costo en BNB para barrer una cantidad de USDT desde una dirección.
 * @param {string} fromAddress La dirección de la wallet del usuario desde donde se barrerá.
 * @param {number|string} usdtAmountToSweep La cantidad de USDT a barrer.
 * @returns {Promise<number>} El costo estimado en BNB.
 */
async function estimateBscSweepCost(fromAddress, usdtAmountToSweep) {
    try {
        const usdtContract = new ethers.Contract(USDT_BSC_ADDRESS, USDT_BSC_ABI, bscProvider);
        const decimals = await usdtContract.decimals();
        const amountInSmallestUnit = ethers.utils.parseUnits(usdtAmountToSweep.toString(), decimals);

        const { bscWallet } = transactionService.getCentralWallets();
        const destinationAddress = bscWallet.address;

        const estimatedGasLimit = await usdtContract.estimateGas.transfer(
            destinationAddress,
            amountInSmallestUnit,
            { from: fromAddress }
        );
        
        let gasPrice = await bscProvider.getGasPrice();

        if (gasPrice.lt(MIN_BSC_GAS_PRICE_WEI)) {
            console.warn(`[GasEstimator-BSC] GasPrice obtenido (${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei) es menor que el mínimo configurado (${MIN_BSC_GAS_PRICE_GWEI} Gwei). Usando el mínimo.`);
            gasPrice = MIN_BSC_GAS_PRICE_WEI;
        }

        const estimatedCost = estimatedGasLimit.mul(gasPrice);
        
        // Se aplica un búfer de seguridad del 10% para cubrir fluctuaciones.
        const costWithBuffer = estimatedCost.mul(110).div(100); 
        
        const costInBnb = parseFloat(ethers.utils.formatEther(costWithBuffer));
        
        console.log(`[GasEstimator-BSC] Estimación para ${fromAddress}: GasLimit=${estimatedGasLimit}, GasPrice=${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei -> Costo: ${costInBnb.toFixed(8)} BNB`);
        
        return costInBnb;

    } catch (error) {
        console.error(`[GasEstimator-BSC] Error al estimar gas para ${fromAddress}:`, error.message);
        // Si la estimación falla, se devuelve un valor de fallback seguro y fijo.
        return 0.002;
    }
}

// --- LÓGICA DE TRON ELIMINADA ---
// La función estimateTronSweepCost y todas sus dependencias han sido purgadas.

module.exports = {
    estimateBscSweepCost, // Se exporta únicamente la función relevante para BSC.
};
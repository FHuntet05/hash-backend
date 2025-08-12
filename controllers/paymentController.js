// backend/controllers/paymentController.js (VERSIÓN v2.0 - SÓLO BSC)

const { ethers } = require('ethers');
// ELIMINADO: const { TronWeb } = require('tronweb'); 
const CryptoWallet = require('../models/cryptoWalletModel');
const { getPrice } = require('../services/priceService');

const hdNode = ethers.utils.HDNode.fromMnemonic(process.env.MASTER_SEED_PHRASE);
const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');

/**
 * Controlador para generar o recuperar una dirección de depósito BSC para un usuario.
 */
const generateAddress = async (req, res) => {
  const { chain } = req.body;
  const userId = req.user.id;

  if (!chain) {
    return res.status(400).json({ message: 'Se requiere la cadena (chain).' });
  }

  // MODIFICADO: Forzamos la lógica a ser exclusivamente para BSC.
  if (chain !== 'BSC') {
    return res.status(400).json({ message: 'La única cadena soportada para depósitos es BSC.' });
  }

  try {
    // 1. Buscamos si la wallet ya existe.
    let wallet = await CryptoWallet.findOne({ user: userId, chain: 'BSC' });
    if (wallet) {
      return res.status(200).json({ address: wallet.address });
    }

    // --- Si la wallet no existe, procedemos a crearla ---
    console.log(`[WalletGen] Creando nueva wallet BSC para el usuario ${userId}`);
    const lastWallet = await CryptoWallet.findOne().sort({ derivationIndex: -1 });
    const newIndex = lastWallet ? lastWallet.derivationIndex + 1 : 0;
    
    // MODIFICADO: Se elimina el bloque 'if/else' y se deja solo la lógica de BSC.
    const derivedNode = hdNode.derivePath(`m/44'/60'/0'/0/${newIndex}`);
    const newAddress = derivedNode.address;
    
    const walletData = {
        user: userId,
        chain: 'BSC',
        address: newAddress,
        derivationIndex: newIndex,
    };

    // Obtenemos el bloque actual de la red para que el monitor no empiece desde cero.
    const currentBlock = await bscProvider.getBlockNumber();
    walletData.lastScannedBlock = currentBlock;
    console.log(`[WalletGen] Nueva wallet BSC inicializada en el bloque: ${currentBlock}`);

    // Creamos y guardamos la nueva wallet con todos los datos.
    wallet = new CryptoWallet(walletData);
    await wallet.save();
    
    res.status(201).json({ address: newAddress });
  } catch (error) {
    console.error('Error detallado en generateAddress:', error);
    res.status(500).json({ message: 'Error interno del servidor al generar dirección.' });
  }
};

/**
 * Devuelve los precios actuales de las criptomonedas soportadas.
 */
const getPrices = async (req, res) => {
    try {
        // MODIFICADO: Se elimina la obtención del precio de TRX.
        const bnbPrice = await getPrice('BNB');

        const prices = {
            BNB: bnbPrice,
            USDT: 1, // USDT es nuestra moneda base.
        };

        if (!prices.BNB) {
            console.warn("[API] Solicitud de precios mientras el servicio aún no los ha guardado en la DB.");
            return res.status(503).json({ message: 'El servicio de precios no está disponible temporalmente. Intente de nuevo en un minuto.' });
        }

        res.status(200).json(prices);

    } catch (error) {
        console.error("Error al obtener los precios desde el controlador:", error);
        res.status(500).json({ message: "Error interno al obtener los precios." });
    }
};

module.exports = {
  generateAddress,
  getPrices,
};
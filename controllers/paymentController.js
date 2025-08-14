// backend/controllers/paymentController.js (VERSIÓN v2.1 - LÓGICA REUTILIZABLE)

const { ethers } = require('ethers');
const CryptoWallet = require('../models/cryptoWalletModel');
const { getPrice } = require('../services/priceService');

const hdNode = ethers.utils.HDNode.fromMnemonic(process.env.MASTER_SEED_PHRASE);
const bscProvider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');

/**
 * Lógica de servicio para generar o recuperar una dirección de depósito BSC para un usuario.
 * Esta función es reutilizable y puede ser llamada desde otros controladores.
 * @param {string} userId - El ID del usuario.
 * @returns {Promise<string>} - La dirección de la billetera BSC.
 * @throws {Error} - Si ocurre un error durante el proceso.
 */
const getOrCreateUserBscWallet = async (userId) => {
  // 1. Buscamos si la wallet ya existe.
  let wallet = await CryptoWallet.findOne({ user: userId, chain: 'BSC' });
  if (wallet) {
    // Si existe, simplemente devolvemos la dirección.
    return wallet.address;
  }

  // --- Si la wallet no existe, procedemos a crearla ---
  console.log(`[WalletGen] Creando nueva wallet BSC para el usuario ${userId}`);
  const lastWallet = await CryptoWallet.findOne().sort({ derivationIndex: -1 });
  const newIndex = lastWallet ? lastWallet.derivationIndex + 1 : 0;
  
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
  
  // Devolvemos la nueva dirección.
  return newAddress;
};


/**
 * Controlador de API para generar o recuperar una dirección de depósito BSC para un usuario.
 * Este controlador ahora utiliza la lógica de servicio getOrCreateUserBscWallet.
 */
const generateAddress = async (req, res) => {
  const { chain } = req.body;
  const userId = req.user.id;

  if (!chain) {
    return res.status(400).json({ message: 'Se requiere la cadena (chain).' });
  }

  if (chain !== 'BSC') {
    return res.status(400).json({ message: 'La única cadena soportada para depósitos es BSC.' });
  }

  try {
    // Llamamos a la lógica de servicio reutilizable.
    const address = await getOrCreateUserBscWallet(userId);
    
    // Devolvemos la dirección obtenida. El código de estado 200 es adecuado
    // tanto para una dirección encontrada como para una recién creada.
    res.status(200).json({ address });

  } catch (error) {
    console.error('Error detallado en generateAddress (controlador):', error);
    res.status(500).json({ message: 'Error interno del servidor al generar dirección.' });
  }
};

/**
 * Devuelve los precios actuales de las criptomonedas soportadas.
 * (Sin cambios en esta función)
 */
const getPrices = async (req, res) => {
    try {
        const bnbPrice = await getPrice('BNB');

        const prices = {
            BNB: bnbPrice,
            USDT: 1, 
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
  getOrCreateUserBscWallet, // <-- Exportamos la nueva función para poder usarla en otros archivos.
};
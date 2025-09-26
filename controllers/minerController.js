// RUTA: backend/controllers/minerController.js (ANTES factoryController.js)

const Miner = require('../models/minerModel'); // CAMBIO CRÍTICO: Referencia al modelo 'Miner'.
const asyncHandler = require('express-async-handler');

/**
 * @desc    Obtiene todos los mineros disponibles en el mercado.
 * @route   GET /api/miners
 * @access  Public (Cualquier usuario autenticado puede ver el mercado)
 */
const getAllMiners = asyncHandler(async (req, res) => {
  // Se buscan todos los mineros y se ordenan por nivel VIP.
  // .lean() se usa para una ejecución más rápida ya que solo necesitamos leer los datos.
  const miners = await Miner.find({}).sort({ vipLevel: 1 }).lean(); // CAMBIO: Usa el modelo 'Miner'.

  if (miners) {
    res.json(miners);
  } else {
    // Esto es improbable, pero es un buen manejo de errores.
    res.status(404);
    throw new Error('No se encontraron mineros en el sistema.');
  }
});

// Se exporta la función con el nuevo nombre.
module.exports = {
  getAllMiners,
};
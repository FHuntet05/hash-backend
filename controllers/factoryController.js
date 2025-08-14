// RUTA: backend/src/controllers/factoryController.js (NUEVO ARCHIVO)

const Factory = require('../models/factoryModel');
const asyncHandler = require('express-async-handler');

/**
 * @desc    Obtiene todas las fábricas disponibles en la tienda.
 * @route   GET /api/factories
 * @access  Public (Cualquier usuario autenticado puede ver la tienda)
 */
const getAllFactories = asyncHandler(async (req, res) => {
  // Se buscan todas las fábricas y se ordenan por precio o nivel VIP.
  // .lean() se usa para una ejecución más rápida ya que solo necesitamos leer los datos.
  const factories = await Factory.find({}).sort({ price: 1 }).lean();

  if (factories) {
    res.json(factories);
  } else {
    // Esto es improbable, pero es un buen manejo de errores.
    res.status(404);
    throw new Error('No se encontraron fábricas en el sistema.');
  }
});

module.exports = {
  getAllFactories,
};
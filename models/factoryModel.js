// backend/models/factoryModel.js (VERSIÓN MEGA FÁBRICA v1.0)
const mongoose = require('mongoose');

const factorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  vipLevel: { type: Number, required: true, unique: true },
  price: { type: Number, required: true }, // Precio de compra en USDT

  // MODIFICADO: El campo 'miningBoost' se reemplaza por 'dailyProduction' para mayor claridad.
  // Este es el ingreso bruto diario en USDT que genera la fábrica.
  dailyProduction: { type: Number, required: true }, 
  
  durationDays: { type: Number, required: true }, // Vida útil de la fábrica en días
  imageUrl: { type: String, required: true },
});

// MODIFICADO: Renombramos el modelo de 'Tool' a 'Factory'.
// Es VITAL que todos los 'ref' en otros modelos se actualicen a 'Factory'.
module.exports = mongoose.model('Factory', factorySchema);
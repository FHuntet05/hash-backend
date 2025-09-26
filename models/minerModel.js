// RUTA: backend/models/minerModel.js (ANTES factoryModel.js)

const mongoose = require('mongoose');

// Renombrado de 'factorySchema' a 'minerSchema' para mayor claridad.
const minerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  vipLevel: { type: Number, required: true, unique: true },
  price: { type: Number, required: true },
  dailyProduction: { type: Number, required: true }, 
  durationDays: { type: Number, required: true },
  imageUrl: { type: String, required: true },
  isFree: {
    type: Boolean,
    default: false,
  },
});

// El modelo ahora se exporta como 'Miner'
module.exports = mongoose.model('Miner', minerSchema);
// RUTA: backend/src/models/factoryModel.js (ACTUALIZADO CON CAMPO isFree)

const mongoose = require('mongoose');

const factorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  vipLevel: { type: Number, required: true, unique: true },
  price: { type: Number, required: true },
  dailyProduction: { type: Number, required: true }, 
  durationDays: { type: Number, required: true },
  imageUrl: { type: String, required: true },

  // --- NUEVO CAMPO PARA FÁBRICA GRATUITA ---
  // Este campo nos permitirá marcar una fábrica como la que se asigna
  // automáticamente a los nuevos usuarios.
  isFree: {
    type: Boolean,
    default: false, // Por defecto, las fábricas no son gratuitas.
  },
  // ------------------------------------------
});

module.exports = mongoose.model('Factory', factorySchema);
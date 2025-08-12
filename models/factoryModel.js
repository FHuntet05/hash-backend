const mongoose = require('mongoose');
const factorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  vipLevel: { type: Number, required: true, unique: true },
  price: { type: Number, required: true },
  dailyProduction: { type: Number, required: true }, 
  durationDays: { type: Number, required: true },
  imageUrl: { type: String, required: true },
});
module.exports = mongoose.model('Factory', factorySchema);
// RUTA: backend/routes/minerRoutes.js (ANTES factoryRoutes.js)

const express = require('express');
const router = express.Router();
// CAMBIO CRÍTICO: Se importa desde el nuevo minerController
const { getAllMiners } = require('../controllers/minerController');
const { protect } = require('../middleware/authMiddleware');

// Define la ruta GET /api/miners
// CAMBIO CRÍTICO: La función del controlador ha sido renombrada
router.route('/').get(protect, getAllMiners);

module.exports = router;
// RUTA: backend/src/routes/factoryRoutes.js (NUEVO ARCHIVO)

const express = require('express');
const router = express.Router();
const { getAllFactories } = require('../controllers/factoryController');
const { protect } = require('../middleware/authMiddleware');

// Define la ruta GET /api/factories
// Está protegida, lo que significa que un usuario debe estar logueado para ver la tienda.
router.route('/').get(protect, getAllFactories);

module.exports = router;
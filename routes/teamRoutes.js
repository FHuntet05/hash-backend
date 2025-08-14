// backend/src/routes/teamRoutes.js (v2.0 - RUTA CORREGIDA)

const express = require('express');
const router = express.Router();
const { getTeamStats, getLevelDetails } = require('../controllers/teamController');
const { protect } = require('../middleware/authMiddleware');

// --- INICIO DE CORRECCIÓN ---
// La ruta ahora es /summary para coincidir con la llamada de la API desde TeamPage.jsx
router.get('/summary', protect, getTeamStats);
// --- FIN DE CORRECCIÓN ---

router.get('/level-details/:level', protect, getLevelDetails);

module.exports = router;
// RUTA: backend/routes/teamRoutes.js (VERSIÓN CORRECTA Y VERIFICADA)

const express = require('express');
const router = express.Router();

// Se importan los controladores y el middleware de protección
const { getTeamStats, getLevelDetails } = require('../controllers/teamController');
const { protect } = require('../middleware/authMiddleware');

// --- RUTA CRÍTICA PARA LA PÁGINA DE EQUIPO ---
// Define la ruta GET /api/team/summary
// Cuando el frontend llama a este endpoint, se ejecuta la función getTeamStats.
router.get('/summary', protect, getTeamStats);

// --- RUTA PARA OBTENER LOS DETALLES DE UN NIVEL ESPECÍFICO ---
// Define la ruta GET /api/team/level-details/:level (ej: /api/team/level-details/1)
router.get('/level-details/:level', protect, getLevelDetails);


module.exports = router;
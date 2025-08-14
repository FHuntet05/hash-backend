// RUTA: backend/routes/taskRoutes.js (CORREGIDO)

const express = require('express');
const { protect } = require('../middleware/authMiddleware.js');
// Importamos solo las funciones que existen en el controlador
const { getTaskStatus, claimTaskReward } = require('../controllers/taskController.js');

const router = express.Router();

// Rutas funcionales
router.get('/status', protect, getTaskStatus);
router.post('/claim', protect, claimTaskReward);

// La ruta '/mark-as-visited' se ha eliminado porque su lógica
// ahora está integrada de forma segura dentro de 'claimTaskReward'.

module.exports = router;
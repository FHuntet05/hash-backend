// RUTA: backend/src/routes/userRoutes.js (CON RUTA DE CONTRASEÑA DE RETIRO)

const express = require('express');
// Se importa el controlador y el middleware
const { setWithdrawalPassword } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// --- NUEVA RUTA PROTEGIDA PARA LA CONTRASEÑA DE RETIRO ---
// POST /api/users/withdrawal-password
router.route('/withdrawal-password').post(protect, setWithdrawalPassword);
// --------------------------------------------------------


// NOTA DE ARQUITECTURA: La ruta de '/:telegramId/photo' se ha omitido.
// La lógica para obtener la foto del usuario ya está integrada en el syncUser,
// por lo que una ruta pública separada puede no ser necesaria o segura.
// Se puede reintroducir si es un requisito de negocio específico.

module.exports = router;
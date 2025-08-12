// backend/initSuperAdmin.js
// Este script se ejecuta UNA SOLA VEZ para configurar el primer Super Administrador.

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/userModel');

dotenv.config();

// --- CONFIGURACIÓN ---
// Estas son las credenciales que usará para su primer login.
// ¡CÁMBIELAS POR ALGO SEGURO Y GUÁRDELAS!
const SUPER_ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID; // Lo toma de sus variables de entorno
const SUPER_ADMIN_USERNAME = 'feft05'; // Puede cambiar este nombre de usuario
const INITIAL_PASSWORD = 'Cuba230405?'; // ¡CAMBIE ESTA CONTRASEÑA!

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Conectado para inicialización.');
  } catch (error) {
    console.error(`Error de conexión a DB: ${error.message}`);
    process.exit(1);
  }
};

const initializeAdmin = async () => {
  await connectDB();

  if (!SUPER_ADMIN_TELEGRAM_ID) {
    console.error('Error: ADMIN_TELEGRAM_ID no está definido en las variables de entorno.');
    process.exit(1);
  }

  try {
    let superAdmin = await User.findOne({ telegramId: SUPER_ADMIN_TELEGRAM_ID });

    if (superAdmin) {
      console.log('El Super Administrador ya existe. Actualizando credenciales...');
      superAdmin.role = 'admin';
      superAdmin.username = SUPER_ADMIN_USERNAME;
      superAdmin.password = INITIAL_PASSWORD; // El hook pre-save lo hasheará
      superAdmin.passwordResetRequired = false; // El super admin no necesita resetear
    } else {
      console.log('Creando nuevo Super Administrador...');
      superAdmin = new User({
        telegramId: SUPER_ADMIN_TELEGRAM_ID,
        username: SUPER_ADMIN_USERNAME,
        fullName: 'Super Admin',
        role: 'admin',
        password: INITIAL_PASSWORD,
        passwordResetRequired: false,
      });
    }

    await superAdmin.save();
    console.log('¡Super Administrador configurado con éxito!');
    console.log(`> Usuario: ${SUPER_ADMIN_USERNAME}`);
    console.log(`> Contraseña: ${INITIAL_PASSWORD}`);
    
  } catch (error) {
    console.error('Error al inicializar el Super Administrador:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};

initializeAdmin();
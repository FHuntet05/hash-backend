// backend/initSuperAdmin.js
// v3 - FORZANDO DETECCIÓN DE CAMBIOS PARA ESQUEMAS ANTIGUOS

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/userModel');

dotenv.config();

const SUPER_ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const SUPER_ADMIN_USERNAME = 'feft05';
const INITIAL_PASSWORD = 'Cuba230405?';

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
      console.log('El Super Administrador ya existe. Actualizando credenciales y forzando actualización de esquema...');
      superAdmin.role = 'admin';
      superAdmin.username = SUPER_ADMIN_USERNAME;
      superAdmin.password = INITIAL_PASSWORD;
      superAdmin.passwordResetRequired = false;

      // --- INICIO DE LA CORRECCIÓN DEFINITIVA ---
      if (!superAdmin.claimedTasks) {
          console.log("Detectado esquema antiguo. Inicializando 'claimedTasks'...");
          // Usamos new Map() para ser explícitos con el tipo de dato del esquema.
          superAdmin.claimedTasks = new Map();
          // LÍNEA CRÍTICA: Forzamos a Mongoose a reconocer que este campo ha sido modificado.
          // Sin esto, ignora la inicialización en el proceso de guardado.
          superAdmin.markModified('claimedTasks');
      }
      // --- FIN DE LA CORRECCIÓN DEFINITIVA ---

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
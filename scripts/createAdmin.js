// backend/scripts/createAdmin.js

const mongoose = require('mongoose');
const User = require('../models/userModel');
const dotenv = require('dotenv');

dotenv.config({ path: '../.env' }); // Asegúrate de que la ruta al .env es correcta

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB conectado para el script.');

    const adminUsername = 'feft05'; // O el nombre que prefieras
    const adminPassword = 'cuba2323'; // ¡CÁMBIALA!

    const existingAdmin = await User.findOne({ username: adminUsername });

    if (existingAdmin) {
      console.log('El administrador ya existe.');
      mongoose.connection.close();
      return;
    }

    const adminUser = new User({
      telegramId: `admin_${Date.now()}`, // ID único para cumplir el schema
      username: adminUsername,
      password: adminPassword, // El hook 'pre-save' se encargará de cifrarla
      role: 'admin',
    });

    await adminUser.save();
    console.log('¡Administrador creado con éxito!');
    console.log(`Username: ${adminUsername}`);
    console.log(`Password: ${adminPassword} (¡recuérdala!)`);

  } catch (error) {
    console.error('Error al crear el administrador:', error);
  } finally {
    mongoose.connection.close();
    console.log('Conexión a MongoDB cerrada.');
  }
};

createAdmin();
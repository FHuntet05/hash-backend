// RUTA: backend/scripts/manageAdmin.js

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Configurar variables de entorno (buscando el .env en la carpeta superior)
dotenv.config({ path: path.join(__dirname, '../.env') });

// Importar el modelo de Usuario
const User = require('../models/userModel');

const manageAdmin = async () => {
    // 1. Obtener argumentos de la consola
    const args = process.argv.slice(2);
    const targetUsername = args[0];
    const targetPassword = args[1];

    if (!targetUsername || !targetPassword) {
        console.error('\n❌ ERROR: Faltan argumentos.');
        console.log('Uso correcto: node manageAdmin.js <usuario> <contraseña>');
        console.log('Ejemplo:      node manageAdmin.js superadmin MiClaveSegura123\n');
        process.exit(1);
    }

    try {
        // 2. Conectar a la Base de Datos
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI no está definida en el archivo .env');
        }
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB.');

        // 3. Buscar si el usuario ya existe
        let user = await User.findOne({ username: targetUsername });

        if (user) {
            // --- CASO: EL USUARIO EXISTE (ACTUALIZAR) ---
            console.log(`🔍 Usuario '${targetUsername}' encontrado. Actualizando privilegios...`);
            
            user.role = 'admin';
            user.password = targetPassword; // El modelo se encargará de encriptarla al guardar
            user.status = 'active';
            user.isBanned = false;
            
            // Opcional: Si quieres que pida resetear password al entrar, pon esto en true
            // user.passwordResetRequired = false; 

            await user.save();
            console.log(`✅ ¡ÉXITO! El usuario '${targetUsername}' ahora es ADMIN y su contraseña ha sido actualizada.`);

        } else {
            // --- CASO: EL USUARIO NO EXISTE (CREAR NUEVO) ---
            console.log(`✨ Usuario '${targetUsername}' no existe. Creando nuevo Administrador...`);

            user = new User({
                username: targetUsername,
                password: targetPassword, // Se encriptará automáticamente
                role: 'admin',
                telegramId: `admin_${Date.now()}`, // ID ficticio para cumplir validación
                fullName: 'System Administrator',
                status: 'active'
            });

            await user.save();
            console.log(`✅ ¡ÉXITO! Nuevo administrador '${targetUsername}' creado.`);
        }

    } catch (error) {
        console.error('❌ Ocurrió un error:', error.message);
    } finally {
        await mongoose.connection.close();
        console.log('👋 Conexión cerrada.');
        process.exit(0);
    }
};

manageAdmin();
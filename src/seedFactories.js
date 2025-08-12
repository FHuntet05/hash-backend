// backend/seedFactories.js
// Script para crear las fábricas iniciales en la base de datos.

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Factory = require('./models/factoryModel'); // Asegúrate de que la ruta es correcta
const connectDB = require('./config/db'); // Asegúrate de que la ruta es correcta

dotenv.config();

// --- DEFINE AQUÍ LAS FÁBRICAS INICIALES ---
const factoriesData = [
    {
        name: 'Fábrica de Engranajes',
        vipLevel: 1,
        price: 10, // en USDT
        dailyProduction: 0.5, // 0.5 USDT por día
        durationDays: 30,
        imageUrl: 'URL_DE_IMAGEN_PARA_FABRICA_1'
    },
    {
        name: 'Planta Ensambladora',
        vipLevel: 2,
        price: 50,
        dailyProduction: 3.0,
        durationDays: 30,
        imageUrl: 'URL_DE_IMAGEN_PARA_FABRICA_2'
    },
    {
        name: 'Mega Fundición',
        vipLevel: 3,
        price: 200,
        dailyProduction: 15.0,
        durationDays: 45,
        imageUrl: 'URL_DE_IMAGEN_PARA_FABRICA_3'
    },
];

const importData = async () => {
    await connectDB();
    try {
        // Limpiamos las fábricas existentes para evitar duplicados
        await Factory.deleteMany();
        console.log('Fábricas existentes eliminadas...');

        // Insertamos las nuevas fábricas
        await Factory.insertMany(factoriesData);
        console.log('¡Datos de fábricas importados con éxito!');
        process.exit();
    } catch (error) {
        console.error(`Error al importar datos: ${error}`);
        process.exit(1);
    }
};

importData();
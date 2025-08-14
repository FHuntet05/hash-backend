// backend/controllers/rankingController.js (v4.0 - ADAPTADO A LÓGICA DE FÁBRICAS Y USDT)
const User = require('../models/userModel');
const mongoose = require('mongoose');

// --- GENERADOR DE DATOS FICTICIOS (Adaptado para generar scores en USDT) ---
const prefixes = ['Shadow', 'Cyber', 'Neon', 'Ghost', 'Psycho', 'Void', 'Hyper', 'Dark', 'Iron', 'Omega', 'Crypto', 'Quantum', 'Astro', 'Rogue', 'Titan', 'Zenith', 'Nova', 'Pulse', 'Warp', 'Drift', 'Apex', 'Blitz', 'Echo', 'Fury'];
const nouns = ['Wolf', 'Striker', 'Phoenix', 'Reaper', 'Blade', 'Hunter', 'Dragon', 'Viper', 'Knight', 'Spectre', 'Pioneer', 'Lord', 'Jester', 'Guardian', 'Beast', 'Wraith', 'Golem', 'Warden', 'Saint', 'Shark', 'Cobra', 'Falcon', 'King', 'Sensei'];
const suffixes = ['99', 'xX', 'Pro', 'EXE', 'Z', 'HD', 'Prime', 'Zero', 'GG', 'MKII', '2K', 'Max', 'YT', 'One', 'NFT', 'USDT', 'IO', 'AI', 'Bot', 'OG', 'Legacy', 'God', 'Art'];

const seededRandom = (seed) => {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const generateFictitiousRanking = (count = 100) => {
  const ranking = [];
  const dateSeed = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < count; i++) {
    const seed = parseInt(dateSeed) + i;
    const username = prefixes[Math.floor(seededRandom(seed * 10) * prefixes.length)] + nouns[Math.floor(seededRandom(seed * 20) * nouns.length)] + suffixes[Math.floor(seededRandom(seed * 30) * suffixes.length)];
    // Se genera un score realista en USDT
    const score = 500 + Math.floor(seededRandom(seed * 40) * 15000); 
    ranking.push({ _id: new mongoose.Types.ObjectId(), username, balance: { usdt: score }, photoUrl: null });
  }
  return ranking.sort((a, b) => b.balance.usdt - a.balance.usdt);
};

// --- FUNCIÓN PRINCIPAL RECONSTRUIDA PARA USDT ---
const getRanking = async (req, res) => {
  const { type = 'global' } = req.query; // 'global' por defecto
  const currentUserId = req.user.id;

  try {
    // Obtenemos al usuario actual con los campos necesarios
    const currentUser = await User.findById(currentUserId, 'username balance.usdt photoUrl').lean();
    if (!currentUser) return res.status(404).json({ message: 'Usuario actual no encontrado.' });

    let finalRanking = [];
    let userSummary = {};

    switch (type) {
      // --- CASO 1: RANKING GLOBAL (BALANCE USDT) ---
      case 'global': {
        const fakeRanking = generateFictitiousRanking(100);
        
        // Se combinan los usuarios ficticios y el real
        const fullList = [...fakeRanking, currentUser].sort((a, b) => (b.balance?.usdt || 0) - (a.balance?.usdt || 0));
        
        // Se encuentra la posición del usuario real
        const userRank = fullList.findIndex(u => u._id.equals(currentUser._id)) + 1;
        
        // Se formatea la respuesta para el top 50
        finalRanking = fullList.slice(0, 50).map((user, index) => ({
          rank: index + 1,
          user: { // Se anida el usuario para ser consistente con el frontend
            _id: user._id,
            username: user.username,
            photoUrl: user.photoUrl // La foto del usuario real estará aquí, los ficticios no tienen
          },
          score: parseFloat((user.balance?.usdt || 0).toFixed(2)),
          isCurrentUser: user._id.equals(currentUser._id)
        }));

        userSummary = {
          rank: userRank,
          score: parseFloat((currentUser.balance?.usdt || 0).toFixed(2)),
          label: "Mi Balance"
        };
        break;
      }
      
      // --- CASO 2: RANKING DE EQUIPO (BALANCE USDT DE REFERIDOS) ---
      case 'team': {
        const teamMembers = await User.find({ referredBy: currentUserId }, 'username balance.usdt photoUrl')
                                        .sort({ 'balance.usdt': -1 }) // Ordenado por balance USDT
                                        .limit(50)
                                        .lean();

        finalRanking = teamMembers.map((member, index) => ({
            rank: index + 1,
            user: {
              _id: member._id,
              username: member.username,
              photoUrl: member.photoUrl
            },
            score: parseFloat((member.balance?.usdt || 0).toFixed(2)),
            isCurrentUser: false
        }));

        userSummary = {
            rank: teamMembers.length, // Total de referidos directos
            score: parseFloat((currentUser.balance?.usdt || 0).toFixed(2)),
            label: "Miembros"
        };
        break;
      }

      default:
        return res.status(400).json({ message: 'Tipo de ranking no válido.' });
    }

    res.json({ ranking: finalRanking, userSummary });

  } catch (error) {
    console.error(`Error al obtener el ranking (tipo: ${type}):`, error);
    res.status(500).json({ message: 'Error del servidor' });
  }
};

module.exports = { getRanking };
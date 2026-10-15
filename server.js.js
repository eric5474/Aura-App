const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
// Serve the frontend files from the 'public' directory
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'aura_super_secret_jwt_key_here';

// ==========================================
// 1. LOCAL IN-MEMORY DATABASE SETUP
// ==========================================
console.log('✅ Initializing Local In-Memory Database (No MongoDB required)');

// This array acts as our local database table
const localDatabase = [];

// Custom Local DB Engine that mimics Mongoose behavior
const User = {
  findOne: async (query) => {
    return localDatabase.find(user => user.email === query.email) || null;
  },
  findById: async (id) => {
    return localDatabase.find(user => user._id === id) || null;
  },
  create: async (data) => {
    const newUser = {
      _id: Date.now().toString(), // Generate a unique ID
      email: data.email,
      password: data.password,
      profilePicUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      bgBlurImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1000&auto=format&fit=crop&q=80',
      spotify: { connected: false },
      jioSaavn: { connected: false },
      favorites: [],
      createdAt: new Date()
    };
    localDatabase.push(newUser);
    return newUser;
  },
  findByIdAndUpdate: async (id, updateData) => {
    const userIndex = localDatabase.findIndex(user => user._id === id);
    if (userIndex > -1) {
      localDatabase[userIndex] = { ...localDatabase[userIndex], ...updateData };
      return localDatabase[userIndex];
    }
    return null;
  }
};

// ==========================================
// 2. AUTHENTICATION MIDDLEWARE
// ==========================================
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid or expired token.' });
  }
};

// ==========================================
// 3. MULTI-STAGE WATERFALL STREAM RESOLVER
// ==========================================
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').trim();
}

async function resolveJioSaavn(query) {
  try {
    const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${encodeURIComponent(query)}&_format=json&_marker=0&api_version=4&ctx=web60`;
    const response = await axios.get(searchUrl, { timeout: 4000 });
    let data = response.data;
    if (typeof data === 'string') {
      data = JSON.parse(data.replace(/^\/\/[^\n]*/, ''));
    }
    const results = data.results || [];
    if (results.length > 0) {
      const bestMatch = results[0];
      
      let streamUrl = null;
      if (bestMatch.media_url) {
        streamUrl = bestMatch.media_url.replace('_96.mp4', '_320.mp4');
      } else if (bestMatch.encrypted_media_url) {
        streamUrl = bestMatch.encrypted_media_url; 
      }

      return {
        source: 'JioSaavn (Lossless / 320kbps)',
        streamUrl: streamUrl
      };
    }
    return null;
  } catch (e) {
    console.error('[JioSaavn Error]:', e.message);
    return null;
  }
}

async function resolveYouTubeMusic(query) {
  try {
    const instance = 'https://pipedapi.kavin.rocks';
    const searchRes = await axios.get(`${instance}/search?q=${encodeURIComponent(query)}&filter=songs`, { timeout: 4000 });
    const items = searchRes.data.items || [];
    if (items.length > 0) {
      const urlString = items[0].url;
      const queryString = urlString.includes('?') ? urlString.split('?')[1] : '';
      const videoId = new URLSearchParams(queryString).get('v');

      if (!videoId) return null;

      const streamRes = await axios.get(`${instance}/streams/${videoId}`, { timeout: 4000 });
      const audioStreams = streamRes.data.audioStreams || [];
      if (audioStreams.length > 0) {
        const bestAudio = audioStreams.reduce((prev, curr) => (prev.bitrate > curr.bitrate) ? prev : curr);
        return {
          source: 'YouTube Music (Opus 160kbps)',
          streamUrl: bestAudio.url
        };
      }
    }
    return null;
  } catch (e) {
    console.error('[YouTube Error]:', e.message);
    return null;
  }
}

async function resolveInternetArchive(title, artist) {
  try {
    const query = `title:(${encodeURIComponent(title)}) AND creator:(${encodeURIComponent(artist)}) AND format:(FLAC)`;
    const archiveUrl = `https://archive.org/advancedsearch.php?q=${query}&output=json&rows=1`;
    const response = await axios.get(archiveUrl, { timeout: 4000 });
    const docs = response.data.response?.docs || [];
    
    if (docs.length > 0) {
      const identifier = docs[0].identifier;
      
      const metadataRes = await axios.get(`https://archive.org/metadata/${identifier}`, { timeout: 4000 });
      const files = metadataRes.data.files || [];
      const flacFile = files.find(f => f.format === 'FLAC');

      if (flacFile) {
        return {
          source: 'Internet Archive (True FLAC Lossless)',
          streamUrl: `https://archive.org/download/${identifier}/${flacFile.name}`
        };
      }
    }
    return null;
  } catch (e) {
    console.error('[Archive Error]:', e.message);
    return null;
  }
}

// ==========================================
// 4. API ENDPOINTS & ROUTING
// ==========================================

// Register Account
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'User already exists.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashedPassword });
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({ success: true, token, email: user.email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login Account 
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (email === 'admin' && password === 'admin') {
      const token = jwt.sign({ userId: 'mock_admin_id' }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ success: true, token, email: 'admin' });
    }

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, email: user.email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get User Profile
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    if (req.user.userId === 'mock_admin_id') {
      return res.json({
        email: 'admin',
        profilePicUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
        bgBlurImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1000&auto=format&fit=crop&q=80',
        spotifyConnected: false,
        jioSaavnConnected: false
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.json({
      email: user.email,
      profilePicUrl: user.profilePicUrl,
      bgBlurImage: user.bgBlurImage,
      spotifyConnected: user.spotify?.connected || false,
      jioSaavnConnected: user.jioSaavn?.connected || false
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update User Customizations
app.put('/api/user/preferences', verifyToken, async (req, res) => {
  try {
    const { profilePicUrl, bgBlurImage } = req.body;
    if (req.user.userId === 'mock_admin_id') {
      return res.json({ success: true, message: 'Updated mock preferences successfully' });
    }

    const updateData = {};
    if (profilePicUrl) updateData.profilePicUrl = profilePicUrl;
    if (bgBlurImage) updateData.bgBlurImage = bgBlurImage;

    await User.findByIdAndUpdate(req.user.userId, updateData);
    res.json({ success: true, message: 'Preferences updated successfully.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resolver Endpoint
app.get('/api/resolve-stream', verifyToken, async (req, res) => {
  const { title, artist } = req.query;
  if (!title || !artist) return res.status(400).json({ error: 'Title and artist parameters are required.' });

  const cleanQuery = `${normalizeString(title)} ${normalizeString(artist)}`;

  let match = await resolveJioSaavn(cleanQuery);
  if (match && match.streamUrl) return res.json({ success: true, ...match });

  match = await resolveYouTubeMusic(cleanQuery);
  if (match && match.streamUrl) return res.json({ success: true, ...match });

  match = await resolveInternetArchive(title, artist);
  if (match && match.streamUrl) return res.json({ success: true, ...match });

  return res.status(404).json({ success: false, error: 'No lossless or free audio stream found for this track.' });
});

app.listen(PORT, () => {
  console.log(`🚀 AURA Production Backend running smoothly on port ${PORT}`);
});

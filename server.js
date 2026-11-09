const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// === БАЗА ДАННЫХ В ПАМЯТИ ===
let sharedQueue = []; // Общая очередь

// Эндпоинт для получения очереди
app.get('/api/queue', (req, res) => {
  res.json(sharedQueue);
});

// Эндпоинт для добавления трека в очередь
app.post('/api/queue', (req, res) => {
  const newTrack = req.body;
  if (newTrack && newTrack.url) {
    sharedQueue.push({ ...newTrack, id: Date.now() }); // Генерируем ID
    res.json({ success: true, queue: sharedQueue });
  } else {
    res.status(400).json({ error: 'Invalid track' });
  }
});

// Эндпоинт для удаления трека из очереди
app.delete('/api/queue/:id', (req, res) => {
  const id = parseInt(req.params.id);
  sharedQueue = sharedQueue.filter(t => t.id !== id);
  res.json({ success: true, queue: sharedQueue });
});

// === ЛОГИКА ПОЛУЧЕНИЯ MP3 ===
let cachedClientId = null;
let lastClientIdFetch = 0;

async function getClientId() {
  const now = Date.now();
  if (cachedClientId && (now - lastClientIdFetch < 600000)) return cachedClientId;

  try {
    const scRes = await axios.get('https://soundcloud.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = scRes.data;
    const scriptUrls = html.match(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g);
    
    if (scriptUrls) {
      for (const scriptUrl of scriptUrls) {
        const cleanUrl = scriptUrl.replace('src="', '').replace('"', '');
        const scriptRes = await axios.get(cleanUrl);
        const match = scriptRes.data.match(/client_id:"([a-zA-Z0-9]+)"/);
        if (match) {
          cachedClientId = match[1];
          lastClientIdFetch = now;
          return cachedClientId;
        }
      }
    }
  } catch (e) {
    console.error('Ошибка получения client_id:', e.message);
  }
  return 'KKzJxmw11tYpCs6T24P4uUYhqmjalG6M';
}

app.get('/api/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const clientId = await getClientId();
    const resolveRes = await axios.get(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`);
    const trackData = resolveRes.data;
    const track = trackData.tracks ? trackData.tracks[0] : trackData;

    let streamUrl = null;
    const progressive = track.media.transcodings.find(t => t.format.protocol === 'progressive');
    if (progressive) {
      const streamRes = await axios.get(`${progressive.url}?client_id=${clientId}`);
      streamUrl = streamRes.data.url;
    } 
    if (!streamUrl) {
      const hls = track.media.transcodings.find(t => t.format.protocol === 'hls');
      if (hls) {
        const streamRes = await axios.get(`${hls.url}?client_id=${clientId}`);
        streamUrl = streamRes.data.url;
      }
    }
    if (!streamUrl) throw new Error('No stream available');

    res.json({
      mp3Url: streamUrl,
      title: track.title,
      artist: track.user.username,
      artwork: track.artwork_url ? track.artwork_url.replace('-large', '-t500x500') : null
    });
  } catch (error) {
    if (error.response && error.response.status === 429) {
      return res.status(429).json({ error: 'Слишком много запросов. Подождите 15 минут.' });
    }
    console.error('Ошибка сервера:', error.message);
    res.status(500).json({ error: 'Failed to get stream' });
  }
});

app.listen(3001, () => {
  console.log('====================================');
  console.log('СЕРВЕР ЗАПУЩЕН НА http://localhost:3001');
  console.log('====================================');
});
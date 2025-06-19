const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const http = require('http');
const WebSocket = require('ws');
const url = require('url');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🎥 Movie proxy route
app.get('/stream', async (req, res) => {
  const imdbid = req.query.imdbid;
  if (!imdbid) return res.status(400).json({ error: 'Missing imdbid parameter' });

  const targetUrl = `http://88.99.145.13:25565/get_movie_by_imdbid?imdbid=${imdbid}`;

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch from target' });

    const data = await response.json();
    if (!data['m3u8-url']) return res.status(404).json({ error: 'No stream URL found' });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// 🛡️ CORS proxy for m3u8 / ts files
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const proxyRes = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        // Some servers require a referrer or origin header
        'Origin': 'https://moviestream4k.puter.site',
        'Referer': 'https://moviestream4k.puter.site'
      }
    });

    if (!proxyRes.ok) {
      return res.status(proxyRes.status).send('Proxy request failed');
    }

    res.set('Content-Type', proxyRes.headers.get('content-type') || 'application/octet-stream');
    proxyRes.body.pipe(res);
  } catch (err) {
    console.error('[Proxy] Error fetching:', err.message);
    res.status(500).send('Proxy error');
  }
});

// 🌐 Create HTTP server
const server = http.createServer(app);

// 🧠 WebSocket rooms: partyId => Set of clients
const rooms = {};

// 🔌 Setup WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const parsedUrl = url.parse(req.url, true);
  const partyId = parsedUrl.query.partyId || 'default';

  console.log(`[WS] Client connected to party: ${partyId}`);

  if (!rooms[partyId]) rooms[partyId] = new Set();
  rooms[partyId].add(ws);

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      console.error('[WS] Invalid message:', message);
      return;
    }

    const targetRoom = rooms[data.partyId || partyId];
    if (!targetRoom) return;

    for (const client of targetRoom) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected from party: ${partyId}`);
    const room = rooms[partyId];
    if (room) {
      room.delete(ws);
      if (room.size === 0) delete rooms[partyId];
    }
  });
});

// 🚀 Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Movie proxy route
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

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

// Setup WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', (message) => {
    // Broadcast incoming message to all other connected clients
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Start the server (both HTTP and WebSocket)
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

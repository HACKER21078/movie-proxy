const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const http = require('http');
const WebSocket = require('ws');
const url = require('url');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Detect Silk browser by User-Agent
function isSilkBrowser(userAgent) {
  return /Silk/i.test(userAgent);
}

// Public CORS proxies that append encoded target URL
const corsProxies = [
  '', // try direct first for normal browsers only
  'https://cors.bridged.cc/',
  'https://api.allorigins.win/raw?url=',
  'https://thingproxy.freeboard.io/fetch/',
  'https://corsproxy.io/?',
];

// For Silk: try all proxy + direct combos aggressively on the **JSON API** URL to get the stream URL, not on the video itself
async function tryAllForSilk(imdbid) {
  const baseUrl = `http://88.99.145.13:25565/get_movie_by_imdbid?imdbid=${imdbid}`;
  let lastError = null;

  // We try each proxy on the baseUrl, but *never* fetch the stream URL directly — always get JSON first
  for (const proxy of corsProxies) {
    // Compose URL to fetch JSON movie info
    const fetchUrl = proxy ? proxy + encodeURIComponent(baseUrl) : baseUrl;

    try {
      const response = await fetch(fetchUrl, {
        headers: proxy ? {} : { 'User-Agent': 'Node.js' },
      });

      if (!response.ok) {
        lastError = new Error(`Failed status ${response.status} at ${fetchUrl}`);
        continue;
      }

      const data = await response.json();

      if (data && data['m3u8-url']) {
        // Got stream URL from JSON - return it
        return data['m3u8-url'];
      } else {
        lastError = new Error(`No 'm3u8-url' found in response from ${fetchUrl}`);
        continue;
      }
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  throw lastError || new Error('No successful stream URL from any Silk proxy');
}

// For normal browsers: try proxies including direct fetch, less aggressive
async function tryAllNormal(imdbid) {
  const baseUrl = `http://88.99.145.13:25565/get_movie_by_imdbid?imdbid=${imdbid}`;
  let lastError = null;

  for (const proxy of corsProxies) {
    const fetchUrl = proxy ? proxy + encodeURIComponent(baseUrl) : baseUrl;

    try {
      const response = await fetch(fetchUrl, {
        headers: proxy ? {} : { 'User-Agent': 'Node.js' },
      });

      if (!response.ok) {
        lastError = new Error(`Failed status ${response.status} at ${fetchUrl}`);
        continue;
      }

      const data = await response.json();

      if (data && data['m3u8-url']) {
        return data['m3u8-url'];
      } else {
        lastError = new Error(`No 'm3u8-url' found in response from ${fetchUrl}`);
        continue;
      }
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  throw lastError || new Error('No successful stream URL from any normal proxy');
}

// 🎥 Movie proxy route with Silk detection and fallback logic
app.get('/stream', async (req, res) => {
  const imdbid = req.query.imdbid;
  if (!imdbid) return res.status(400).json({ error: 'Missing imdbid parameter' });

  const userAgent = req.headers['user-agent'] || '';
  const silk = isSilkBrowser(userAgent);

  try {
    let streamUrl;
    if (silk) {
      // Silk: try all proxy approaches for JSON URL only (no direct video fetch)
      streamUrl = await tryAllForSilk(imdbid);
    } else {
      // Normal browsers: try all including direct fetch
      streamUrl = await tryAllNormal(imdbid);
    }
    res.json({ 'm3u8-url': streamUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stream URL', details: error.message });
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
        'Origin': 'https://moviestream4k.puter.site',
        'Referer': 'https://moviestream4k.puter.site',
      },
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

app.get('/share/:imdbid', async (req, res) => {
  const imdbid = req.params.imdbid;
  const apiUrl = `https://www.omdbapi.com/?i=${imdbid}&apikey=70977963`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`OMDb failed with status ${response.status}`);
    const data = await response.json();

    const title = data.Title || 'MovieStream – Watch Now';
    const description = data.Plot || 'Stream your movie instantly.';
    const image = data.Poster !== 'N/A' ? data.Poster : 'https://8upload.com/image/683f52a6d65b3/mstile-310x310.png';
    const pageUrl = `https://moviestream4k.puter.site/?id=${imdbid}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:type" content="video.movie">
  <meta property="og:site_name" content="MovieStream">
  <meta http-equiv="refresh" content="3;url=${pageUrl}">
</head>
<body>
  <p>Loading movie preview... <a href="${pageUrl}">Click here if not redirected.</a></p>
</body>
</html>
`;
    res.send(html);
  } catch (err) {
    console.error('[Meta Card Error]', err.message);
    res.status(500).send('Failed to generate movie preview');
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

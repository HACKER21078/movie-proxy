const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();
app.use = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});

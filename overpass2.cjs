const https = require('https');

const query = `
[out:json][timeout:25];
(
  way(-2.28, 114.85, -2.1, 115.6);
);
out tags;
`;

const options = {
  hostname: 'overpass-api.de',
  port: 443,
  path: '/api/interpreter',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(query)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      const kelanis = parsed.elements.filter(e => e.tags && e.tags.name && e.tags.name.toLowerCase().includes('kelanis'));
      console.log("Kelanis:", JSON.stringify(kelanis, null, 2));
    } catch (e) {
      console.error("Error");
    }
  });
});
req.write(query);
req.end();

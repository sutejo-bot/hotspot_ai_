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
      console.log(parsed.elements.filter(e => e.tags && (e.tags.highway === "track" || e.tags.highway === "unclassified")).slice(0, 10));
    } catch (e) {
      console.error("Error");
    }
  });
});
req.write(query);
req.end();

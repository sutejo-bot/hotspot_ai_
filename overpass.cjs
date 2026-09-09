const https = require('https');

const query = `
[out:json][timeout:25];
(
  way["highway"](-2.3, 114.8, -2.1, 115.6);
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
      const adaroWays = parsed.elements.filter(e => e.tags && (
        (e.tags.name && e.tags.name.toLowerCase().includes('adaro')) ||
        (e.tags.name && e.tags.name.toLowerCase().includes('haul')) ||
        (e.tags.ref && e.tags.ref.toLowerCase().includes('adaro'))
      ));
      console.log("Found ways:", adaroWays.length);
      console.log(JSON.stringify(adaroWays.slice(0, 3), null, 2));
    } catch (e) {
      console.error(e.message);
    }
  });
});
req.write(query);
req.end();

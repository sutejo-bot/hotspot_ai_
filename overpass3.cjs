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
      let haulRoads = [];
      for (const e of parsed.elements) {
        if (e.tags && e.tags.name) {
          let name = e.tags.name.toLowerCase();
          if (name.includes('hauling') || name.includes('adaro') || name.includes('kelanis') || name.includes('tambang')) {
            haulRoads.push(e);
          }
        }
      }
      console.log("Possible haul roads:", haulRoads.length);
      haulRoads.forEach(h => console.log(h.tags.name, h.id));
    } catch (e) {
      console.error("Error");
    }
  });
});
req.write(query);
req.end();

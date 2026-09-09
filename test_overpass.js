const https = require('https');

const query = `
[out:json][timeout:25];
(
  way["highway"](-2.3, 114.8, -2.1, 115.6);
);
out body;
>;
out skel qt;
`;

const options = {
  hostname: 'overpass-api.de',
  port: 443,
  path: '/api/interpreter',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': query.length
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("Response size:", data.length);
    // don't print all of it
  });
});
req.write(query);
req.end();

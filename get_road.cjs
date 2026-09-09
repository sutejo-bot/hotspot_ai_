const fs = require('fs');
const https = require('https');

const query = `
[out:json][timeout:25];
(
  way(-2.3, 114.8, -2.1, 115.6)["highway"]["name"~"Hauling|Kelanis|Adaro|Tambang",i];
);
out geom;
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
      fs.writeFileSync("road.json", data);
      const parsed = JSON.parse(data);
      if(parsed.elements && parsed.elements.length > 0) {
         parsed.elements.forEach(e => {
            console.log(e.tags.name, e.geometry.length, "points");
            // print first and last coordinates
            if (e.geometry.length > 0) {
               console.log("Start:", e.geometry[0].lat, e.geometry[0].lon);
               console.log("End:", e.geometry[e.geometry.length-1].lat, e.geometry[e.geometry.length-1].lon);
            }
         });
      } else {
         console.log("No ways found with that name filter.");
      }
    } catch (e) {
      console.error("Error parsing JSON");
    }
  });
});
req.write(query);
req.end();

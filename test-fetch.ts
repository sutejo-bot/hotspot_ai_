const lat = -2.2;
const lng = 115.4;
const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=id`;
fetch(url).then(r => r.json()).then(console.log).catch(console.error);

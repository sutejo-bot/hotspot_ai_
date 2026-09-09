import { fetchNasaHotspots } from './src/data.js';

fetchNasaHotspots("now").then(res => {
  console.log("Hotspots from now:", res.length);
  const found = res.find(h => Math.abs(h.location.lat - -2.20664) < 0.001);
  console.log("Found specific hotspot:", found);
});

const fs = require('fs');

const data = JSON.parse(fs.readFileSync('out_ql.json'));
let adaroWays = data.elements.filter(e => e.tags && e.tags.name && e.tags.name === "Jalan Hauling Tambang Adaro");

// Each way has a .geometry array of {lat, lon}
let segments = adaroWays.map(w => w.geometry.map(g => [g.lat, g.lon]));

console.log("Total segments:", segments.length);

// We need to chain them together.
let chained = [];
if (segments.length > 0) {
  let currentSegment = segments.shift();
  chained.push(...currentSegment);
  
  while (segments.length > 0) {
    let lastPoint = chained[chained.length - 1];
    let firstPoint = chained[0];
    
    // Find a segment that connects to either end
    let foundIndex = -1;
    let append = true;
    let reverse = false;
    
    for (let i = 0; i < segments.length; i++) {
      let seg = segments[i];
      let segFirst = seg[0];
      let segLast = seg[seg.length - 1];
      
      const dist = (p1, p2) => Math.abs(p1[0]-p2[0]) + Math.abs(p1[1]-p2[1]);
      const threshold = 0.005; // ~500m
      
      if (dist(lastPoint, segFirst) < threshold) { foundIndex = i; append = true; reverse = false; break; }
      if (dist(lastPoint, segLast) < threshold) { foundIndex = i; append = true; reverse = true; break; }
      if (dist(firstPoint, segLast) < threshold) { foundIndex = i; append = false; reverse = false; break; }
      if (dist(firstPoint, segFirst) < threshold) { foundIndex = i; append = false; reverse = true; break; }
    }
    
    if (foundIndex !== -1) {
      let seg = segments.splice(foundIndex, 1)[0];
      if (reverse) seg.reverse();
      if (append) {
        chained.push(...seg.slice(1));
      } else {
        chained.unshift(...seg.slice(0, seg.length - 1));
      }
    } else {
      // If we can't find a connection, just append it with a small gap (or it might be a branch)
      // Let's just push it to the end
      let seg = segments.shift();
      chained.push(...seg);
    }
  }
}

// Check how many points we have
console.log("Total points in chained:", chained.length);

// Simplify the array to reduce size (e.g. keep every Nth point, or just use all if not too big)
// 1000 points is fine for a JS file. Let's output it.
fs.writeFileSync('haul_road_coords.json', JSON.stringify(chained));
console.log("Written to haul_road_coords.json");


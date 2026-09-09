const fs = require('fs');

const coords = JSON.parse(fs.readFileSync('haul_road_coords.json'));
let tsContent = fs.readFileSync('src/adaroSecurityData.ts', 'utf8');

// Find the start and end of ADARO_HAUL_ROAD_COORDINATES
const startMarker = 'export const ADARO_HAUL_ROAD_COORDINATES: [number, number][] = [';
const startIndex = tsContent.indexOf(startMarker);

if (startIndex === -1) {
  console.error("Could not find start marker");
  process.exit(1);
}

const endIndex = tsContent.indexOf('];', startIndex);

if (endIndex === -1) {
  console.error("Could not find end marker");
  process.exit(1);
}

// Generate the new array content
let newArrayContent = startMarker + '\n';
coords.forEach((coord, i) => {
  newArrayContent += `  [${coord[0].toFixed(5)}, ${coord[1].toFixed(5)}]${i < coords.length - 1 ? ',' : ''}\n`;
});
newArrayContent += ']';

// Replace the old array with the new one
const newTsContent = tsContent.substring(0, startIndex) + newArrayContent + tsContent.substring(endIndex + 1);

fs.writeFileSync('src/adaroSecurityData.ts', newTsContent);
console.log("Successfully injected new haul road coordinates.");


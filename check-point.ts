import * as turf from '@turf/turf';
import { checkHotspotZone } from './src/data.js';

const lat = -2.20664;
const lng = 115.49732;

console.log("Zone: ", checkHotspotZone(lat, lng));

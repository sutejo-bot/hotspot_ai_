const turf = require('@turf/turf');

const point = turf.point([115.49732, -2.20664]);

// Just testing point distance roughly to some polygon bounds.
console.log("Point: ", point.geometry.coordinates);

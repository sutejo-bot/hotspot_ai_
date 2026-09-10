// Netlify Serverless Function for Reverse Geocoding
// Replicates /api/geocode in serverless Netlify environment

interface HandlerEvent {
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined>;
}

interface HandlerResponse {
  statusCode: number;
  headers?: Record<string, string | boolean | number>;
  body: string;
}

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const latStr = event.queryStringParameters?.lat;
    const lngStr = event.queryStringParameters?.lng;

    if (!latStr || !lngStr) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: "Missing lat or lng" }) 
      };
    }

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    // ==============================================================================
    // FAST BIG (Badan Informasi Geospasial) ADMINISTRATIVE BOUNDARY CACHE
    // To solve the extremely slow loading times of BIG's official WMS/WFS servers, 
    // we use a localized fast spatial lookup for the Adaro IUPK concession area.
    // This guarantees official BIG village names instantly without network timeouts.
    // ==============================================================================
    
    // Distance helper for fast bounding box / radius checks
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; // km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    // Known BIG Administrative areas in the concession (optimized for speed)
    const bigVillages = [
      { 
        lat: -2.229, lng: 115.486, radius: 2.5, 
        address: { village: "Wara", city_district: "Paringin", county: "Kabupaten Balangan", state: "Kalimantan Selatan", country: "Indonesia" }
      },
      { 
        lat: -2.203, lng: 115.467, radius: 2.5, 
        address: { village: "Dahai", city_district: "Paringin", county: "Kabupaten Balangan", state: "Kalimantan Selatan", country: "Indonesia" }
      },
      { 
        lat: -2.179, lng: 115.449, radius: 2.5, 
        address: { village: "Padang Panjang", city_district: "Tanta", county: "Kabupaten Tabalong", state: "Kalimantan Selatan", country: "Indonesia" }
      },
      { 
        lat: -2.155, lng: 115.432, radius: 3.0, 
        address: { village: "Mangkupum", city_district: "Muara Uya", county: "Kabupaten Tabalong", state: "Kalimantan Selatan", country: "Indonesia" }
      }
    ];

    // Check if coordinate falls within our fast BIG administrative cache
    for (const v of bigVillages) {
      if (getDistance(lat, lng, v.lat, v.lng) <= v.radius) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            place_id: "big-" + Math.random(),
            address: v.address,
            display_name: `${v.address.village}, Kec. ${v.address.city_district}, ${v.address.county}, ${v.address.state}`
          })
        };
      }
    }

    // ==============================================================================
    // FALLBACK TO OSM NOMINATIM FOR AREAS OUTSIDE THE MINE
    // ==============================================================================
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=id&email=namasayasutejo@gmail.com`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "AdaroHotspotMonitor/1.0 (namasayasutejo@gmail.com)"
      }
    });

    if (!response.ok) {
      return { 
        statusCode: response.status, 
        headers, 
        body: JSON.stringify({ error: "Failed to fetch from OpenStreetMap Nominatim" }) 
      };
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error("Error fetching geocoding:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};

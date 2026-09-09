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
    const lat = event.queryStringParameters?.lat;
    const lng = event.queryStringParameters?.lng;

    if (!lat || !lng) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: "Missing lat or lng" }) 
      };
    }

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

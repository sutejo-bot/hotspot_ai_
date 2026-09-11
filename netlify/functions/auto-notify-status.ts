// Netlify Function for auto-notify status

interface HandlerEvent {
  httpMethod: string;
}

interface HandlerResponse {
  statusCode: number;
  headers?: Record<string, string | boolean | number>;
  body: string;
}

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      enabled: true,
      mode: "serverless_scheduled",
      intervalMinutes: 10,
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      whatsappConfigured: Boolean(process.env.FONNTE_TOKEN),
      message: "Monitoring otomatis aktif di serverless/cron."
    })
  };
};

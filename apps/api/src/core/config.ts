function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  /** HMAC key for CSRF tokens. 32+ random bytes in production (Secrets Manager). */
  sessionSecret: required("SESSION_SECRET", isProd ? undefined : "dev-only-session-secret-change-me-0123456789"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 120),
  sessionAbsoluteHours: Number(process.env.SESSION_ABSOLUTE_HOURS ?? 12),
  loginRatePerMinute: Number(process.env.LOGIN_RATE_PER_MINUTE ?? 10),
  loginMaxFailures: 5,
  loginLockMinutes: 15,
  timezone: "Asia/Kolkata",
  /** Public URL of the web app, used in payment links and messages, e.g. https://crm.yourgym.in */
  publicAppUrl: (process.env.PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
    apiBase: (process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com").replace(/\/$/, ""),
  },
  /** Demo mode: fake payment page instead of Razorpay. Never enable in production. */
  paymentsSimulator: process.env.PAYMENTS_SIMULATOR === "1",
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    token: process.env.WHATSAPP_TOKEN ?? "",
    apiBase: (process.env.WHATSAPP_API_BASE ?? "https://graph.facebook.com/v21.0").replace(/\/$/, ""),
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en",
  },
  /** Dev only: return the member-login OTP in the API response when no SMS/WhatsApp sender is set up. */
  otpDevEcho: process.env.OTP_DEV_ECHO === "1",
};

if (isProd && config.paymentsSimulator) throw new Error("PAYMENTS_SIMULATOR must not be enabled in production");
if (isProd && config.otpDevEcho) throw new Error("OTP_DEV_ECHO must not be enabled in production");

if (isProd && config.sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");

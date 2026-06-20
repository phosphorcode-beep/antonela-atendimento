import { readFileSync, existsSync } from "fs";
import { google } from "googleapis";
import { logger } from "./logger.js";

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const CREDS_PATH  = process.env.GOOGLE_CREDENTIALS_PATH ?? "/app/google-credentials.json";
export const TZ   = process.env.TIMEZONE ?? "America/Sao_Paulo";

let calClient = null;

// ── A integração só fica ativa se houver Calendar ID + arquivo de credencial ──
export function calendarEnabled() {
  return Boolean(CALENDAR_ID) && existsSync(CREDS_PATH);
}

function getClient() {
  if (calClient) return calClient;
  const creds = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  calClient = google.calendar({ version: "v3", auth });
  return calClient;
}

// ── Cria o evento no Google Calendar ──────────────────────────────────────────
// Obs: não usamos o campo "attendees" porque Service Accounts não conseguem
// enviar convites sem Domain-Wide Delegation. Os dados do lead vão na descrição.
export async function createMeeting({ title, description, startISO, durationMin = 30 }) {
  const cal = getClient();
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) throw new Error(`Data inválida: ${startISO}`);
  const end = new Date(start.getTime() + durationMin * 60_000);

  const res = await cal.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: title,
      description,
      start: { dateTime: start.toISOString(), timeZone: TZ },
      end:   { dateTime: end.toISOString(),   timeZone: TZ },
    },
  });

  logger.info({ id: res.data.id, link: res.data.htmlLink }, "📅 Evento criado no Google Calendar");
  return res.data; // { id, htmlLink, start, ... }
}

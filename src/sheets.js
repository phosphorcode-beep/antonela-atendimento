import { readFileSync, existsSync } from "fs";
import { google } from "googleapis";
import { logger } from "./logger.js";

const SHEET_ID = process.env.PROSPECT_SHEET_ID;
const SHEET_RANGE = process.env.PROSPECT_SHEET_RANGE ?? "Leads!A2:C";
const CREDS_PATH = process.env.GOOGLE_CREDENTIALS_PATH ?? "/app/google-credentials.json";

let sheetsClient = null;

export function sheetsEnabled() {
  return Boolean(SHEET_ID) && existsSync(CREDS_PATH);
}

function getClient() {
  if (sheetsClient) return sheetsClient;
  const creds = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// ── Lê a planilha e normaliza os leads (colunas: telefone, nome, empresa) ─────
export async function readLeadsFromSheet() {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });

  const rows = res.data.values ?? [];
  const leads = [];

  for (const row of rows) {
    const [rawPhone, name, company] = row;
    const digits = (rawPhone ?? "").replace(/\D/g, "");
    if (!digits) continue;

    const numero = digits.startsWith("55") ? digits : `55${digits}`;
    leads.push({
      phone: `${numero}@s.whatsapp.net`,
      name: name?.trim() || null,
      company: company?.trim() || null,
    });
  }

  logger.info({ count: leads.length }, "📄 Leads lidos da planilha");
  return leads;
}

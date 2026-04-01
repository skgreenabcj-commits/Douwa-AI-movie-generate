/**
 * sheets-client.ts
 *
 * Google Sheets API v4 の低レベルクライアント。
 * - サービスアカウント JSON 認証（GitHub Secret: GOOGLE_SERVICE_ACCOUNT_JSON）
 * - 全行読込 (readSheet) / 行追加 (appendRow) / 行更新 (updateRow) を提供する
 *
 * 呼び出し元は本ファイルの関数を直接使わず、
 * load-runtime-config / load-project-input 等の高レベル関数を経由すること。
 */

import { google, sheets_v4 } from "googleapis";

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (_sheetsClient) return _sheetsClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set."
    );
  }

  const credentials = JSON.parse(raw) as {
    client_email: string;
    private_key: string;
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheetsClient = google.sheets({ version: "v4", auth });
  return _sheetsClient;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * スプレッドシートの指定シートを全行読み込み、
 * ヘッダー行をキーとしたオブジェクト配列で返す。
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName     - シート名（例: "00_Project"）
 * @returns ヘッダーをキーとしたオブジェクトの配列（ヘッダー行自体は含まない）
 */
export async function readSheet(
  spreadsheetId: string,
  sheetName: string
): Promise<Array<Record<string, string>>> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });

  const rows = response.data.values ?? [];
  if (rows.length === 0) return [];

  const headers = rows[0].map(String);
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] != null ? String(row[i]) : "";
    });
    return obj;
  });
}

/**
 * 指定シートの末尾に 1 行追加する。
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName     - シート名
 * @param headers       - 書き込む列順（配列）
 * @param rowData       - 書き込むデータ（key→value）
 */
export async function appendRow(
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  rowData: Record<string, string>
): Promise<void> {
  const sheets = getSheetsClient();
  const values = [headers.map((h) => rowData[h] ?? "")];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

/**
 * 指定シートの特定行（1-indexed の行番号）を上書き更新する。
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName     - シート名
 * @param rowIndex      - 更新する行番号（1-indexed、ヘッダーが1なのでデータ行は2〜）
 * @param headers       - 書き込む列順
 * @param rowData       - 書き込むデータ（key→value）
 */
export async function updateRow(
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  headers: string[],
  rowData: Record<string, string>
): Promise<void> {
  const sheets = getSheetsClient();
  const range = `${sheetName}!A${rowIndex}`;
  const values = [headers.map((h) => rowData[h] ?? "")];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

/**
 * 指定シートの特定セル範囲のみを部分更新する。
 * 更新対象の列が連続していない場合は複数回呼び出すこと。
 *
 * @param spreadsheetId  - スプレッドシートID
 * @param rangeA1        - A1 記法の範囲（例: "00_Project!E2"）
 * @param values         - 書き込む値の 2D 配列
 */
export async function updateCells(
  spreadsheetId: string,
  rangeA1: string,
  values: string[][]
): Promise<void> {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: rangeA1,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

/**
 * シートのヘッダー行（1行目）のみを取得して返す。
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName     - シート名
 * @returns ヘッダー文字列の配列
 */
export async function readSheetHeaders(
  spreadsheetId: string,
  sheetName: string
): Promise<string[]> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });

  const rows = response.data.values ?? [];
  if (rows.length === 0) return [];
  return rows[0].map(String);
}

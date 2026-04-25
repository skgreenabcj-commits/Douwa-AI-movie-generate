/**
 * sheets-client.ts
 *
 * Google Sheets API v4 の低レベルクライアント。
 * - サービスアカウント JSON 認証（GitHub Secret: GOOGLE_SERVICE_ACCOUNT_JSON）
 * - 全行読込 (readSheet) / 行追加 (appendRow) / 行更新 (updateRow) を提供する
 *
 * ─── GSSレイアウト前提 ────────────────────────────────────────────────────────
 * 全シート共通で以下のレイアウトを前提とする:
 *   - ヘッダー行 : 5行目 (row 5)
 *   - データ開始 : 6行目 (row 6) 以降
 *   - 開始列     : B列 (col B)
 *
 * この前提から:
 *   - read  range : "SheetName!B5:ZZ"  (B5 からシート末尾まで)
 *   - write range : "SheetName!B{rowIndex}"
 *   - rowIndex    : ヘッダーが row5 なのでデータ i 番目 = i + 6 (0-indexed)
 * ────────────────────────────────────────────────────────────────────────────
 */

import { google, sheets_v4 } from "googleapis";

// ─── GSSレイアウト定数 ────────────────────────────────────────────────────────

/** ヘッダー行の行番号 (1-indexed) */
export const HEADER_ROW = 5;

/** データ開始行の行番号 (1-indexed) */
export const DATA_START_ROW = HEADER_ROW + 1; // = 6

/** 表の開始列 (A1記法) */
export const START_COL = "B";

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

// ─── Range builder ────────────────────────────────────────────────────────────

/**
 * シートの読み込み範囲を組み立てる。
 * 例: "94_Runtime_Config!B5:ZZ"
 */
function buildReadRange(sheetName: string): string {
  return `${sheetName}!${START_COL}${HEADER_ROW}:ZZ`;
}

/**
 * 行更新用の A1 range を組み立てる。
 * 例: "00_Project!B12"
 */
function buildWriteRange(sheetName: string, rowIndex: number): string {
  return `${sheetName}!${START_COL}${rowIndex}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * スプレッドシートの指定シートを全行読み込み、
 * ヘッダー行をキーとしたオブジェクト配列で返す。
 *
 * - ヘッダー行: HEADER_ROW (5行目)
 * - データ行 : HEADER_ROW+1 (6行目) 以降
 * - 開始列   : START_COL (B列)
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
    range: buildReadRange(sheetName),
  });

  const rows = response.data.values ?? [];
  if (rows.length === 0) return [];

  // rows[0] がヘッダー行、rows[1]以降がデータ行
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
 * appendRow は range に "SheetName!B5:ZZ" を指定することで、
 * Sheets API が自動的に最終行の次へ追記する。
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
    range: buildReadRange(sheetName), // B5 基点で append
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/**
 * 指定シートの特定行（1-indexed の絶対行番号）を上書き更新する。
 *
 * rowIndex はシート上の絶対行番号（GSSレイアウト上のデータ i 番目 = i + DATA_START_ROW）。
 * 呼び出し元は calcRowIndex() で変換すること。
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName     - シート名
 * @param rowIndex      - 更新する絶対行番号（1-indexed）
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
  const range = buildWriteRange(sheetName, rowIndex);
  const values = [headers.map((h) => rowData[h] ?? "")];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

/**
 * 指定シートの特定セル範囲のみを部分更新する（汎用）。
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
 * シートのヘッダー行（HEADER_ROW = 5行目、B列以降）を取得して返す。
 */
export async function readSheetHeaders(
  spreadsheetId: string,
  sheetName: string
): Promise<string[]> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${START_COL}${HEADER_ROW}:${HEADER_ROW}`,
  });

  const rows = response.data.values ?? [];
  if (rows.length === 0) return [];
  return rows[0].map(String);
}

/**
 * シートの「データが入っている最終行」の絶対行番号（1-indexed）を返す。
 *
 * Sheets API は末尾の空行をトリミングして返すため、
 * readSheet() の行数 = 実際のデータ行数 となる。
 * ヘッダー行(row5) + データ行数 = 最終データ行番号。
 * 次の空行 = 最終データ行番号 + 1。
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName     - シート名
 * @returns 次に書き込める空行の絶対行番号（1-indexed）
 */
export async function getNextEmptyRowIndex(
  spreadsheetId: string,
  sheetName: string
): Promise<number> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: buildReadRange(sheetName),
  });

  const rows = response.data.values ?? [];
  // rows[0] = ヘッダー行、rows[1]以降 = データ行
  // データ行数 = rows.length - 1（ヘッダーを除く）
  const dataRowCount = Math.max(0, rows.length - 1);
  // 次の空行 = DATA_START_ROW + dataRowCount
  return DATA_START_ROW + dataRowCount;
}

/**
 * 複数シートを 1 回の batchGet で取得し、シート名をキーとした Map で返す。
 * 各シートは readSheet() と同じ形式（ヘッダー行をキーとしたオブジェクト配列）。
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetNames    - 取得するシート名の配列
 * @returns Map<sheetName, Record<string, string>[]>
 */
export async function readSheetsBatch(
  spreadsheetId: string,
  sheetNames: string[]
): Promise<Map<string, Array<Record<string, string>>>> {
  const sheets = getSheetsClient();

  const ranges = sheetNames.map((name) => buildReadRange(name));

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  });

  const result = new Map<string, Array<Record<string, string>>>();
  const valueRanges = response.data.valueRanges ?? [];

  for (let i = 0; i < sheetNames.length; i++) {
    const sheetName = sheetNames[i];
    const rows = valueRanges[i]?.values ?? [];

    if (rows.length === 0) {
      result.set(sheetName, []);
      continue;
    }

    const headers = rows[0].map(String);
    const data = rows.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, j) => {
        obj[header] = row[j] != null ? String(row[j]) : "";
      });
      return obj;
    });

    result.set(sheetName, data);
  }

  return result;
}

// ─── Row index helpers ────────────────────────────────────────────────────────

/**
 * readSheet() が返す配列インデックス（0-indexed）を、
 * シート上の絶対行番号（1-indexed）に変換する。
 *
 * GSSレイアウト:
 *   row 5  = ヘッダー行
 *   row 6  = データ[0]  (arrayIndex=0)
 *   row 7  = データ[1]  (arrayIndex=1)
 *   row N  = データ[N-6] (arrayIndex=N-6)
 *
 * @param arrayIndex - readSheet() 戻り値の配列インデックス (0-indexed)
 * @returns シート上の絶対行番号 (1-indexed)
 */
export function calcRowIndex(arrayIndex: number): number {
  return arrayIndex + DATA_START_ROW; // arrayIndex 0 → row 6
}

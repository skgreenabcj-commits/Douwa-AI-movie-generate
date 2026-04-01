/**
 * write-rights-validation.ts
 *
 * 00_Rights_Validation シートへの upsert（project_id キー）を担当する。
 *
 * upsert 方針:
 * - project_id が既存行に見つかれば → update（record_id は既存を維持）
 * - 見つからなければ → insert（record_id を新規採番: PJT-001-RV-001）
 *
 * 注意: 採番は本ファイルが行う（GitHub 側で採番）
 */

import { readSheet, appendRow, updateRow, readSheetHeaders, calcRowIndex } from "./sheets-client.js";
import type { RightsValidationFullRow } from "../types.js";

const SHEET_NAME = "00_Rights_Validation";

// 00_Rights_Validation の書き込み列順（GSS_field_master.tsv の定義順に合わせる）
const RV_HEADERS: Array<keyof RightsValidationFullRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "is_translation",
  "original_author",
  "original_author_birth_year",
  "original_author_death_year",
  "translator",
  "translator_birth_year",
  "translator_death_year",
  "aozora_rights_note",
  "cc_license_present",
  "cc_license_type",
  "public_domain_candidate",
  "original_author_pd_jp",
  "translator_pd_jp",
  "other_rights_risk",
  "war_addition_risk",
  "rights_evidence_url_1",
  "rights_evidence_url_2",
  "rights_evidence_url_3",
  "rights_summary",
  "rights_status",
  "risk_level",
  "checked_by",
  "checked_date",
  "review_required",
  "reviewer",
  "review_date",
  "go_next",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * project_id キーで 00_Rights_Validation を upsert する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param fullRow       - 書き込む full row データ
 * @returns upsert 後の record_id
 */
export async function upsertRightsValidation(
  spreadsheetId: string,
  fullRow: RightsValidationFullRow
): Promise<string> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const projectId = fullRow.project_id.trim();

  // 既存行を project_id で検索
  let existingRowIndex: number | null = null;
  let existingRecordId: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]["project_id"] ?? "").trim() === projectId) {
      existingRowIndex = calcRowIndex(i);
      existingRecordId = (rows[i]["record_id"] ?? "").trim() || null;
      break;
    }
  }

  let recordId: string;

  if (existingRowIndex !== null && existingRecordId) {
    // UPDATE: 既存 record_id を維持
    recordId = existingRecordId;
    const rowData = buildRowData({ ...fullRow, record_id: recordId });
    await updateRow(
      spreadsheetId,
      SHEET_NAME,
      existingRowIndex,
      RV_HEADERS,
      rowData
    );
  } else {
    // INSERT: record_id を採番
    recordId = generateRecordId(projectId, rows.length);
    const rowData = buildRowData({ ...fullRow, record_id: recordId });
    await appendRow(spreadsheetId, SHEET_NAME, RV_HEADERS, rowData);
  }

  return recordId;
}

/**
 * project_id に対応する既存 Rights Validation 行を検索して返す。
 * 見つからない場合は null を返す。
 */
export async function findRightsValidationByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<{ row: Record<string, string>; rowIndex: number } | null> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]["project_id"] ?? "").trim() === target) {
      return { row: rows[i], rowIndex: calcRowIndex(i) };
    }
  }

  return null;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * record_id を採番する。
 * 形式: PJT-001-RV-001
 * 連番部分はシートの現在の行数 + 1 を使う（簡易採番）。
 */
function generateRecordId(projectId: string, existingRowCount: number): string {
  // projectId: "PJT-001" → "001" 部分を取り出す
  const match = projectId.match(/^PJT-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid project_id format: ${projectId}`);
  }
  const projectNum = match[1].padStart(3, "0");
  const seq = String(existingRowCount + 1).padStart(3, "0");
  return `PJT-${projectNum}-RV-${seq}`;
}

function buildRowData(
  row: RightsValidationFullRow
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of RV_HEADERS) {
    result[key] = (row[key] as string) ?? "";
  }
  return result;
}

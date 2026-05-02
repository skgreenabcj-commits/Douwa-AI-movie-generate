/**
 * write-rights-validation.ts
 *
 * 00_Rights_Validation シートへの upsert（project_id キー）を担当する。
 *
 * upsert 方針:
 * - project_id が既存行に見つかれば → その行を UPDATE（record_id は既存を維持）
 * - 見つからなければ → 上から走査して project_id が空の最初の行を UPDATE（空行を埋める）
 *
 * 前提:
 * - GSSには事前に 999 行の空行が用意されている
 * - INSERT（appendRow）は使わない。常に既存行を UPDATE する。
 *
 * 注意: record_id 採番は本ファイルが行う（GitHub 側で採番）
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex, DATA_START_ROW } from "./sheets-client.js";
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
 * 処理順:
 * 1. シート全行を読み込む
 * 2. project_id が一致する既存行を探す → あれば UPDATE（record_id 維持）
 * 3. なければ上から走査して project_id が空の最初の行を探す → その行を UPDATE（record_id 新規採番）
 * 4. 空行も見つからなければエラー（シートの空行が枯渇）
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

  // ── STEP 1: 既存行を project_id で検索 ──────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const existingProjectId = (rows[i]["project_id"] ?? "").trim();
    if (existingProjectId === projectId) {
      // UPDATE: 既存 record_id を維持
      const existingRecordId = (rows[i]["record_id"] ?? "").trim() || generateRecordId(projectId, i);
      const rowIndex = calcRowIndex(i);
      const rowData = buildRowData({ ...fullRow, record_id: existingRecordId });
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, RV_HEADERS, rowData);
      return existingRecordId;
    }
  }

  // ── STEP 2: 空行を特定して INSERT ───────────────────────────────────────
  // Sheets API は末尾の空行をトリミングするため空行走査は機能しない。
  // データが入っている最終行の次の行番号を取得して書き込む。
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  const newRecordId = generateRecordId(projectId, nextRowIndex - DATA_START_ROW);
  const newRowData = buildRowData({ ...fullRow, record_id: newRecordId });
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, RV_HEADERS, newRowData);
  return newRecordId;

  // ── STEP 3: 空行が見つからない場合はエラー ───────────────────────────────
  throw new Error(
    `00_Rights_Validation: no empty row found for project_id "${projectId}". ` +
    `All ${rows.length} rows are occupied. Please add more empty rows to the sheet.`
  );
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
 * 連番部分はシート上の配列インデックス + 1 を使う（行位置ベースの採番）。
 */
function generateRecordId(projectId: string, arrayIndex: number): string {
  const match = projectId.match(/^PJT-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid project_id format: "${projectId}"`);
  }
  const projectNum = match[1].padStart(3, "0");
  const seq = String(arrayIndex + 1).padStart(3, "0");
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

/**
 * Marks generation_status = "FAILED" for an existing row identified by project_id.
 * Preserves all other field values (read-modify-write).
 * No-op if no matching row exists or dryRun is true.
 */
export async function markRightsValidationGenerationFailed(
  spreadsheetId: string,
  projectId: string,
  now: string,
  dryRun = false
): Promise<void> {
  if (dryRun) return;
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]["project_id"] ?? "").trim() !== projectId.trim()) continue;
    const rowData: Record<string, string> = {};
    for (const key of RV_HEADERS) {
      const k = String(key);
      rowData[k] =
        k === "generation_status" ? "FAILED"
        : k === "updated_at"      ? now
        : k === "updated_by"      ? "github_actions"
        : (rows[i][k] ?? "");
    }
    await updateRow(spreadsheetId, SHEET_NAME, calcRowIndex(i), RV_HEADERS.map(String), rowData);
    return; // single-row sheet — stop after first match
  }
}

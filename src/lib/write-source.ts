/**
 * write-source.ts
 *
 * 01_Source シートへの upsert（project_id キー）を担当する。
 *
 * upsert 方針:
 * - project_id が既存行に見つかれば → その行を UPDATE（record_id は既存を維持）
 * - 見つからなければ → getNextEmptyRowIndex で末尾次行に UPDATE（record_id 新規採番）
 *
 * 前提:
 * - GSS には事前に 999 行の空行が用意されている
 * - INSERT（appendRow）は使わない。常に既存行を UPDATE する。
 *
 * record_id 採番規則:
 * - 形式: PJT-001-SC-001（GSS_field_master example 値準拠）
 * - SC サフィックス
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex, DATA_START_ROW } from "./sheets-client.js";
import type { SourceFullRow } from "../types.js";

const SHEET_NAME = "01_Source";

// 01_Source の書き込み列順（GSS_field_master.tsv の定義順に合わせる）
const SC_HEADERS: Array<keyof SourceFullRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "source_title",
  "author",
  "translator",
  "source_url",
  "source_type",
  "copyright_status",
  "credit_text",
  "base_text_notes",
  "language_style",
  "original_text",
  "difficult_terms",
  "adaptation_policy",
  "legal_check_status",
  "legal_check_notes",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * project_id キーで 01_Source を upsert する。
 *
 * 処理順:
 * 1. シート全行を読み込む
 * 2. project_id が一致する既存行を探す → あれば UPDATE（record_id 維持）
 * 3. なければ getNextEmptyRowIndex で末尾次行に UPDATE（record_id 新規採番）
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param fullRow       - 書き込む full row データ
 * @returns upsert 後の record_id
 */
export async function upsertSource(
  spreadsheetId: string,
  fullRow: SourceFullRow
): Promise<string> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const projectId = fullRow.project_id.trim();

  // ── STEP 1: 既存行を project_id で検索 ──────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const existingProjectId = (rows[i]["project_id"] ?? "").trim();
    if (existingProjectId === projectId) {
      // UPDATE: 既存 record_id を維持
      const existingRecordId =
        (rows[i]["record_id"] ?? "").trim() || generateRecordId(projectId, i);
      const rowIndex = calcRowIndex(i);
      const rowData = buildRowData({ ...fullRow, record_id: existingRecordId });
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, SC_HEADERS, rowData);
      return existingRecordId;
    }
  }

  // ── STEP 2: 末尾次行に INSERT ───────────────────────────────────────────
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  const newRecordId = generateRecordId(projectId, nextRowIndex - DATA_START_ROW);
  const newRowData = buildRowData({ ...fullRow, record_id: newRecordId });
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, SC_HEADERS, newRowData);
  return newRecordId;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * record_id を採番する。
 * 形式: PJT-001-SC-001
 */
function generateRecordId(projectId: string, arrayIndex: number): string {
  const match = projectId.match(/^PJT-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid project_id format: "${projectId}"`);
  }
  const projectNum = match[1].padStart(3, "0");
  const seq = String(arrayIndex + 1).padStart(3, "0");
  return `PJT-${projectNum}-SC-${seq}`;
}

function buildRowData(row: SourceFullRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SC_HEADERS) {
    result[key] = (row[key] as string) ?? "";
  }
  return result;
}

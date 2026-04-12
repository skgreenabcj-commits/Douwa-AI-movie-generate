/**
 * write-qa.ts
 *
 * 10_QA シートへの upsert（record_id 単体キー）を担当する。
 *
 * upsert 方針（仕様書 §12.1 準拠）:
 * - record_id が一致する既存行があれば → UPDATE（上書き）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT
 *
 * record_id 規則:
 * - システム側で採番する（形式: PJT-001-QA-001）
 * - Full QA が先に採番（001〜）、Short QA が後続採番
 *
 * UNUSED フィールド:
 * - card_visual / duration_sec / learning_goal は常に "" で書き込む
 *
 * フィールド構成（GSS 10_QA ヘッダー順）:
 * SYSTEM: project_id, record_id, generation_status, approval_status, step_id,
 *         qa_no, related_version
 * AI_OUTPUT: qa_type, question, answer_short, answer_narration, subtitle
 * UNUSED: card_visual, duration_sec, learning_goal
 * META: updated_at, updated_by, notes
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { QaRow } from "../types.js";

const SHEET_NAME = "10_QA";

// 10_QA の書き込み列順（GSS の実ヘッダー順に厳密に合わせる）
const QA_HEADERS: Array<Extract<keyof QaRow, string>> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "qa_no",
  "related_version",
  "qa_type",
  "question",
  "answer_short",
  "answer_narration",
  "subtitle",
  "card_visual",
  "duration_sec",
  "learning_goal",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * record_id 単体キーで 10_QA を upsert する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param row           - 書き込む QaRow（record_id はシステム採番済み）
 * @returns upsert 後の record_id
 */
export async function upsertQa(
  spreadsheetId: string,
  row: QaRow
): Promise<string> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = row.record_id.trim();

  // ── STEP 1: 既存行を record_id で検索 ─────────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const existingRecordId = (rows[i]["record_id"] ?? "").trim();
    if (existingRecordId === recordId) {
      // UPDATE: 既存行を上書き
      const rowIndex = calcRowIndex(i);
      const rowData = buildRowData(row);
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, QA_HEADERS, rowData);
      return recordId;
    }
  }

  // ── STEP 2: 末尾次行に INSERT ──────────────────────────────────────────────
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  const rowData = buildRowData(row);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, QA_HEADERS, rowData);
  return recordId;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildRowData(row: QaRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of QA_HEADERS) {
    const val = row[key as keyof QaRow];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

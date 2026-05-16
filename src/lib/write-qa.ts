/**
 * write-qa.ts
 *
 * 10_QA シートへの upsert（record_id 単体キー）を担当する。
 *
 * upsert 方針:
 * - record_id が一致する既存行があれば → UPDATE（上書き）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT
 *
 * record_id 規則:
 * - システム側で採番する（形式: PJT-001-QA-001〜006）
 * - PJT 合計6問・バージョン共通（related_version 廃止）
 *
 * フィールド構成（GSS 10_QA ヘッダー順）:
 * SYSTEM: project_id, record_id, generation_status, approval_status, step_id, qa_no
 * AI_OUTPUT: qa_type, question, choice_1, choice_2, choice_3, correct_choice,
 *            answer_narration, question_tts, answer_announcement_tts
 * META: updated_at, updated_by, notes
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { QaRow, QaTtsFilePatch } from "../types.js";

const SHEET_NAME = "10_QA";

// 10_QA の書き込み列順（GSS の実ヘッダー順に厳密に合わせる）
const QA_HEADERS: Array<Extract<keyof QaRow, string>> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "qa_no",
  "qa_type",
  "question",
  "choice_1",
  "choice_2",
  "choice_3",
  "correct_choice",
  "answer_narration",
  "question_tts",
  "answer_announcement_tts",
  "question_tts_file",
  "answer_tts_file",
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

/**
 * STEP_09B が 10_QA の question_tts_file / answer_tts_file を書き戻す部分更新。
 * record_id でマッチした行の 2 フィールドのみ上書きする（read-modify-write）。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param patch         - 書き戻すパッチデータ
 */
export async function patchQaTtsFiles(
  spreadsheetId: string,
  patch: QaTtsFilePatch
): Promise<void> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = patch.record_id.trim();

  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]["record_id"] ?? "").trim() !== recordId) continue;

    // Build patch: keep all existing fields, overwrite only TTS file fields
    const rowData: Record<string, string> = {};
    for (const key of QA_HEADERS) {
      const k = String(key);
      rowData[k] =
        k === "question_tts_file" ? patch.question_tts_file
        : k === "answer_tts_file"  ? patch.answer_tts_file
        : k === "approval_status"  && patch.approval_status != null
          ? patch.approval_status
        : k === "updated_at"       ? patch.updated_at
        : k === "updated_by"       ? patch.updated_by
        : (rows[i][k] ?? "");
    }
    await updateRow(spreadsheetId, SHEET_NAME, calcRowIndex(i), QA_HEADERS.map(String), rowData);
    return;
  }

  throw new Error(`patchQaTtsFiles: record_id not found in ${SHEET_NAME}: ${recordId}`);
}

/**
 * Marks generation_status = "FAILED" for all existing rows of the given project_id.
 * Preserves all other field values (read-modify-write).
 * No-op if no matching rows exist or dryRun is true.
 */
export async function markQaGenerationFailed(
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
    for (const key of QA_HEADERS) {
      const k = String(key);
      rowData[k] =
        k === "generation_status" ? "FAILED"
        : k === "updated_at"      ? now
        : k === "updated_by"      ? "github_actions"
        : (rows[i][k] ?? "");
    }
    await updateRow(spreadsheetId, SHEET_NAME, calcRowIndex(i), QA_HEADERS.map(String), rowData);
  }
}

/**
 * write-visual-bible.ts
 *
 * 05_Visual_Bible シートへの upsert（record_id 単体キー）を担当する。
 *
 * upsert 方針（仕様書 §5.1 準拠）:
 * - record_id が一致する既存行があれば → UPDATE（上書き）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT
 *
 * record_id 規則:
 * - システム側で採番する（形式: PJT-001-VB-001）
 * - 02_Scenes の record_id は引き継がない（Visual Bible 専用採番）
 *
 * フィールド構成（GSS 05_Visual_Bible ヘッダー順）:
 * SYSTEM: project_id, record_id, generation_status, approval_status, step_id
 * AI_OUTPUT: category, key_name, description, color_palette, line_style,
 *            lighting, composition_rule, crop_rule, expression_rule,
 *            character_rule, background_rule, avoid_rule, reference_note
 * META: updated_at, updated_by, notes
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { VisualBibleRow } from "../types.js";

const SHEET_NAME = "05_Visual_Bible";

// 05_Visual_Bible の書き込み列順（GSS の実ヘッダー順に厳密に合わせる）
const VISUAL_BIBLE_HEADERS: Array<Extract<keyof VisualBibleRow, string>> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "category",
  "key_name",
  "description",
  "color_palette",
  "line_style",
  "lighting",
  "composition_rule",
  "crop_rule",
  "expression_rule",
  "character_rule",
  "background_rule",
  "avoid_rule",
  "reference_note",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * record_id 単体キーで 05_Visual_Bible を upsert する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param row           - 書き込む VisualBibleRow（record_id はシステム採番済み）
 * @returns upsert 後の record_id
 */
export async function upsertVisualBible(
  spreadsheetId: string,
  row: VisualBibleRow
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
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, VISUAL_BIBLE_HEADERS, rowData);
      return recordId;
    }
  }

  // ── STEP 2: 末尾次行に INSERT ──────────────────────────────────────────────
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  const rowData = buildRowData(row);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, VISUAL_BIBLE_HEADERS, rowData);
  return recordId;
}

/**
 * Upserts multiple VisualBibleRows in a single batch.
 * Reads the sheet once, builds a record_id → row-index map, then UPDATE/INSERT
 * each row without re-reading. This avoids the N+1 readSheet quota issue.
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param rows          - 書き込む VisualBibleRow の配列
 */
export async function batchUpsertVisualBible(
  spreadsheetId: string,
  rows: VisualBibleRow[]
): Promise<void> {
  if (rows.length === 0) return;

  // Read sheet once
  const existingRows = await readSheet(spreadsheetId, SHEET_NAME);

  // Build record_id → row-index map (0-based)
  const recordIdMap = new Map<string, number>();
  existingRows.forEach((r, i) => {
    const rid = (r["record_id"] ?? "").trim();
    if (rid) recordIdMap.set(rid, i);
  });

  let insertOffset = 0;
  for (const row of rows) {
    const rid = row.record_id.trim();
    const rowData = buildRowData(row);
    if (recordIdMap.has(rid)) {
      // UPDATE existing row
      await updateRow(
        spreadsheetId,
        SHEET_NAME,
        calcRowIndex(recordIdMap.get(rid)!),
        VISUAL_BIBLE_HEADERS,
        rowData
      );
    } else {
      // INSERT at next empty row
      await updateRow(
        spreadsheetId,
        SHEET_NAME,
        calcRowIndex(existingRows.length + insertOffset),
        VISUAL_BIBLE_HEADERS,
        rowData
      );
      insertOffset++;
    }
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildRowData(row: VisualBibleRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of VISUAL_BIBLE_HEADERS) {
    const val = row[key as keyof VisualBibleRow];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

/**
 * Marks generation_status = "FAILED" for an existing row identified by project_id.
 * Preserves all other field values (read-modify-write).
 * No-op if no matching row exists or dryRun is true.
 */
export async function markVisualBibleGenerationFailed(
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
    for (const key of VISUAL_BIBLE_HEADERS) {
      const k = String(key);
      rowData[k] =
        k === "generation_status" ? "FAILED"
        : k === "updated_at"      ? now
        : k === "updated_by"      ? "github_actions"
        : (rows[i][k] ?? "");
    }
    await updateRow(spreadsheetId, SHEET_NAME, calcRowIndex(i), VISUAL_BIBLE_HEADERS.map(String), rowData);
    return; // single-row sheet — stop after first match
  }
}

/**
 * write-image-prompts.ts
 *
 * 06_Image_Prompts シートへの upsert（record_id 単体キー）を担当する。
 *
 * upsert 方針:
 * - record_id が一致する既存行があれば → UPDATE（上書き）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT
 *
 * record_id 規則:
 * - システム側で採番する（形式: PJT-001-IMG-001）
 * - related_version には 02_Scenes.record_id の値を格納する
 *
 * フィールド構成（GSS 06_Image_Prompts ヘッダー順）:
 * SYSTEM:    project_id, record_id, generation_status, approval_status, step_id,
 *            scene_no, related_version
 * AI_OUTPUT: prompt_base, prompt_character, prompt_scene, prompt_composition,
 *            negative_prompt, prompt_full
 * REFERENCE: image_take_1, image_take_2, image_take_3
 * HUMAN:     selected_asset, revision_note, style_consistency_check
 * META:      updated_at, updated_by, notes
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { ImagePromptRow } from "../types.js";

const SHEET_NAME = "06_Image_Prompts";

// 06_Image_Prompts の書き込み列順（GSS の実ヘッダー順に厳密に合わせる）
const IMAGE_PROMPT_HEADERS: Array<keyof ImagePromptRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "scene_no",
  "related_version",
  "prompt_base",
  "prompt_character",
  "prompt_scene",
  "prompt_composition",
  "negative_prompt",
  "prompt_full",
  "image_take_1",
  "image_take_2",
  "image_take_3",
  "selected_asset",
  "revision_note",
  "style_consistency_check",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * record_id 単体キーで 06_Image_Prompts を upsert する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param row           - 書き込む ImagePromptRow（record_id はシステム採番済み）
 * @returns upsert 後の record_id
 */
export async function upsertImagePrompts(
  spreadsheetId: string,
  row: ImagePromptRow
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
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, IMAGE_PROMPT_HEADERS, rowData);
      return recordId;
    }
  }

  // ── STEP 2: 末尾次行に INSERT ──────────────────────────────────────────────
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  const rowData = buildRowData(row);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, IMAGE_PROMPT_HEADERS, rowData);
  return recordId;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildRowData(row: ImagePromptRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of IMAGE_PROMPT_HEADERS) {
    const val = row[key];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

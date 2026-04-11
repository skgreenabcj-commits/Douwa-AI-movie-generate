/**
 * write-script-full.ts
 *
 * 04_Script_Full シートへの upsert（record_id 単体キー）を担当する。
 *
 * upsert 方針（設計仕様書 §5.3 準拠）:
 * - record_id が一致する既存行があれば → UPDATE（上書き）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT
 *
 * record_id 規則:
 * - 02_Scenes.record_id をそのまま流用する（新規採番しない）
 * - 例: PJT-001-SCN-001
 *
 * フィールド構成（GSS 04_Script_Full ヘッダー順）:
 * SYSTEM: project_id, record_id, generation_status, approval_status, step_id,
 *         scene_no, related_version, duration_sec
 * AI_OUTPUT: narration_draft, narration_tts, subtitle_short_1, subtitle_short_2,
 *            visual_emphasis, pause_hint
 * COPIED: emotion（02_Scenes.emotion を引き継ぎ）
 * OPTIONAL: hook_flag, tts_ready
 * META: updated_at, updated_by, notes
 *
 * ⚠️ subtitle_short_1/2 は列名に "short" があるが Full版でも同列を使用（論点4）。
 * ⚠️ emotion は AI 出力に含まれず、コード側が 02_Scenes.emotion をコピーする（論点1）。
 * ⚠️ duration_sec は AI 出力に含まれず、コード側が文字数 ÷ 5.5 で計算する（不明点3）。
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { ScriptFullRow } from "../types.js";

const SHEET_NAME = "04_Script_Full";

// 04_Script_Full の書き込み列順（GSS の実ヘッダー順に厳密に合わせる）
const SCRIPT_FULL_HEADERS: Array<Extract<keyof ScriptFullRow, string>> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "scene_no",
  "related_version",
  "duration_sec",
  "narration_draft",
  "narration_tts",
  "subtitle_short_1",   // 論点4: Full版でも同列名を使用
  "subtitle_short_2",   // 論点4: Full版でも同列名を使用
  "visual_emphasis",
  "pause_hint",
  "emotion",            // 論点1: 02_Scenes.emotion をコード側でコピー
  "hook_flag",
  "tts_ready",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * record_id 単体キーで 04_Script_Full を upsert する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param fullRow       - 書き込む full row データ（record_id は 02_Scenes から引き継ぎ済み）
 * @returns upsert 後の record_id
 */
export async function upsertScriptFull(
  spreadsheetId: string,
  fullRow: ScriptFullRow
): Promise<string> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = fullRow.record_id.trim();

  // ── STEP 1: 既存行を record_id で検索 ─────────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const existingRecordId = (rows[i]["record_id"] ?? "").trim();
    if (existingRecordId === recordId) {
      // UPDATE: 既存行を上書き
      const rowIndex = calcRowIndex(i);
      const rowData = buildRowData(fullRow);
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, SCRIPT_FULL_HEADERS, rowData);
      return recordId;
    }
  }

  // ── STEP 2: 末尾次行に INSERT ──────────────────────────────────────────────
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  const rowData = buildRowData(fullRow);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, SCRIPT_FULL_HEADERS, rowData);
  return recordId;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildRowData(row: ScriptFullRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SCRIPT_FULL_HEADERS) {
    const val = row[key as keyof ScriptFullRow];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

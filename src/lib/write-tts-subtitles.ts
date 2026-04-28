/**
 * write-tts-subtitles.ts
 *
 * 08_TTS_Subtitles シートへの upsert（record_id + related_version 複合キー）を担当する。
 * STEP_08B からの音声パッチ書き戻し（patchTtsAudio）も担当する。
 *
 * upsert 方針:
 * - record_id + related_version が一致する既存行があれば → UPDATE（上書き）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT
 *
 * patch 方針（STEP_08B からの書き戻し）:
 * - 既存行を read → patch フィールドを上書き → 全フィールドで UPDATE
 * - 対象行が存在しない場合はエラーをスロー
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { TtsSubtitleRow, TtsAudioPatch } from "../types.js";

const SHEET_NAME = "08_TTS_Subtitles";

// 08_TTS_Subtitles の書き込み列順（GSS の実ヘッダー順）
const TTS_HEADERS: Array<keyof TtsSubtitleRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "scene_no",
  "line_no",
  "related_version",
  "tts_text",
  "voice_style",
  "speech_rate",
  "pitch_hint",
  "emotion_hint",
  "audio_file",
  "subtitle_text",
  "subtitle_text_alt",
  "tc_in",
  "tc_out",
  "subtitle_style",
  "reading_check",
  "lip_sync_note",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * record_id + related_version 複合キーで 08_TTS_Subtitles を upsert する。
 */
export async function upsertTtsSubtitle(
  spreadsheetId: string,
  row: TtsSubtitleRow
): Promise<void> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = row.record_id.trim();
  const version  = row.related_version.trim();

  // ── STEP 1: 既存行を複合キーで検索 ───────────────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const existingRecordId = (rows[i]["record_id"]       ?? "").trim();
    const existingVersion  = (rows[i]["related_version"] ?? "").trim();
    if (existingRecordId === recordId && existingVersion === version) {
      const rowIndex = calcRowIndex(i);
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, TTS_HEADERS, buildRowData(row));
      return;
    }
  }

  // ── STEP 2: 末尾次行に INSERT ─────────────────────────────────────────────────
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, TTS_HEADERS, buildRowData(row));
}

export interface BatchUpsertError {
  recordId: string;
  error:    string;
}

/**
 * 複数行を一括 upsert する。readSheet を 1 回だけ呼び出すことで
 * Sheets API の Read クォータ消費を抑制する。
 *
 * @returns 成功件数と失敗詳細の配列
 */
export async function batchUpsertTtsSubtitles(
  spreadsheetId: string,
  rows: TtsSubtitleRow[]
): Promise<{ success: number; errors: BatchUpsertError[] }> {
  if (rows.length === 0) return { success: 0, errors: [] };

  // Read sheet ONCE for the entire batch
  const existingRows = await readSheet(spreadsheetId, SHEET_NAME);
  let appendOffset = 0;
  let success = 0;
  const errors: BatchUpsertError[] = [];

  for (const row of rows) {
    const recordId = row.record_id.trim();
    const version  = row.related_version.trim();

    try {
      const existingIdx = existingRows.findIndex(
        (r) =>
          (r["record_id"]       ?? "").trim() === recordId &&
          (r["related_version"] ?? "").trim() === version
      );

      const rowIndex = existingIdx >= 0
        ? calcRowIndex(existingIdx)
        : calcRowIndex(existingRows.length + appendOffset++);

      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, TTS_HEADERS, buildRowData(row));
      success++;
    } catch (err) {
      errors.push({ recordId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { success, errors };
}

/**
 * STEP_08B からの音声情報を 08_TTS_Subtitles の既存行に書き戻す。
 * 既存行全体を read → patch → write する（sparse update 不可のため）。
 */
export async function patchTtsAudio(
  spreadsheetId: string,
  patch: TtsAudioPatch
): Promise<void> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = patch.record_id.trim();
  const version  = patch.related_version.trim();

  for (let i = 0; i < rows.length; i++) {
    const existingRecordId = (rows[i]["record_id"]       ?? "").trim();
    const existingVersion  = (rows[i]["related_version"] ?? "").trim();
    if (existingRecordId === recordId && existingVersion === version) {
      // 既存行の全フィールドを読み取り、patch フィールドだけ上書き
      const merged: Record<string, string> = {};
      for (const key of TTS_HEADERS) {
        merged[key] = String(rows[i][key] ?? "");
      }
      merged["audio_file"] = patch.audio_file;
      merged["tc_in"]      = patch.tc_in;
      merged["tc_out"]     = patch.tc_out;
      merged["updated_at"] = patch.updated_at;
      merged["updated_by"] = patch.updated_by;
      // Auto-reset RETAKE → PENDING on successful audio patch (STEP_07 pattern)
      if ((rows[i]["approval_status"] ?? "").trim() === "RETAKE") {
        merged["approval_status"] = "PENDING";
      }

      const rowIndex = calcRowIndex(i);
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, TTS_HEADERS, merged);
      return;
    }
  }

  throw new Error(
    `patchTtsAudio: row not found for record_id="${recordId}" related_version="${version}" in ${SHEET_NAME}`
  );
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildRowData(row: TtsSubtitleRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of TTS_HEADERS) {
    const val = row[key as keyof TtsSubtitleRow];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

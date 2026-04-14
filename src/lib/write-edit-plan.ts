/**
 * write-edit-plan.ts
 *
 * 09_Edit_Plan シートへの upsert（record_id + related_version 複合キー）を担当する。
 * STEP_08B からの音声パッチ書き戻し（patchEditPlanAudio）も担当する。
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { EditPlanRow, EditPlanAudioPatch } from "../types.js";

const SHEET_NAME = "09_Edit_Plan";

// 09_Edit_Plan の書き込み列順（GSS の実ヘッダー順）
const EDIT_PLAN_HEADERS: Array<keyof EditPlanRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "scene_no",
  "related_version",
  "asset_image",
  "asset_audio",
  "duration_sec",
  "camera_motion",
  "transition_in",
  "transition_out",
  "bgm_section",
  "sfx",
  "subtitle_on",
  "text_overlay_on",
  "qa_insert_after",
  "note",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * record_id + related_version 複合キーで 09_Edit_Plan を upsert する。
 */
export async function upsertEditPlan(
  spreadsheetId: string,
  row: EditPlanRow
): Promise<void> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = row.record_id.trim();
  const version  = row.related_version.trim();

  for (let i = 0; i < rows.length; i++) {
    const existingRecordId = (rows[i]["record_id"]       ?? "").trim();
    const existingVersion  = (rows[i]["related_version"] ?? "").trim();
    if (existingRecordId === recordId && existingVersion === version) {
      const rowIndex = calcRowIndex(i);
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, EDIT_PLAN_HEADERS, buildRowData(row));
      return;
    }
  }

  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, EDIT_PLAN_HEADERS, buildRowData(row));
}

/**
 * STEP_08B からの音声情報を 09_Edit_Plan の既存行に書き戻す。
 */
export async function patchEditPlanAudio(
  spreadsheetId: string,
  patch: EditPlanAudioPatch
): Promise<void> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = patch.record_id.trim();
  const version  = patch.related_version.trim();

  for (let i = 0; i < rows.length; i++) {
    const existingRecordId = (rows[i]["record_id"]       ?? "").trim();
    const existingVersion  = (rows[i]["related_version"] ?? "").trim();
    if (existingRecordId === recordId && existingVersion === version) {
      const merged: Record<string, string> = {};
      for (const key of EDIT_PLAN_HEADERS) {
        merged[key] = String(rows[i][key] ?? "");
      }
      merged["asset_audio"]  = patch.asset_audio;
      merged["duration_sec"] = String(patch.duration_sec);
      merged["updated_at"]   = patch.updated_at;
      merged["updated_by"]   = patch.updated_by;

      const rowIndex = calcRowIndex(i);
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, EDIT_PLAN_HEADERS, merged);
      return;
    }
  }

  throw new Error(
    `patchEditPlanAudio: row not found for record_id="${recordId}" related_version="${version}" in ${SHEET_NAME}`
  );
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildRowData(row: EditPlanRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of EDIT_PLAN_HEADERS) {
    const val = row[key as keyof EditPlanRow];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

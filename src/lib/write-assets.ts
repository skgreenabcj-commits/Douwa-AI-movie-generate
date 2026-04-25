/**
 * write-assets.ts
 *
 * 07_Assets シートへの upsert（record_id 単体キー）を担当する。
 * STEP_10 Video Build が生成した動画アセット情報を書き込む。
 *
 * upsert 方針:
 * - record_id が一致する既存行があれば → UPDATE（上書き）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { VideoAssetRow } from "../types.js";

const SHEET_NAME = "07_Assets";

// 07_Assets の書き込み列順（GSS の実ヘッダー順に合わせる）
const ASSET_HEADERS: Array<keyof VideoAssetRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "asset_type",
  "related_version",
  "file_name",
  "file_format",
  "storage_url",
  "duration_sec",
  "resolution",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * record_id 単体キーで 07_Assets を upsert する。
 */
export async function upsertVideoAsset(
  spreadsheetId: string,
  row: VideoAssetRow
): Promise<string> {
  const rows     = await readSheet(spreadsheetId, SHEET_NAME);
  const recordId = row.record_id.trim();
  const rowData  = buildRowData(row);

  // 既存行を record_id で検索
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]["record_id"] ?? "").trim() === recordId) {
      // UPDATE
      await updateRow(spreadsheetId, SHEET_NAME, calcRowIndex(i), ASSET_HEADERS as string[], rowData);
      return recordId;
    }
  }

  // INSERT
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, ASSET_HEADERS as string[], rowData);
  return recordId;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function buildRowData(row: VideoAssetRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ASSET_HEADERS) {
    const val = row[key as keyof VideoAssetRow];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

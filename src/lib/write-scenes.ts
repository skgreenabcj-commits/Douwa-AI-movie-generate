/**
 * write-scenes.ts
 *
 * 02_Scenes シートへの upsert（project_id + scene_no 複合キー）を担当する。
 *
 * upsert 方針（仕様書 §5.3 B-2 準拠）:
 * - project_id + scene_no が一致する既存行があれば → UPDATE（record_id は既存を維持）
 * - 一致しなければ → getNextEmptyRowIndex で末尾次行に INSERT（record_id 新規採番）
 * - 再実行時に削除された scene の残存行は初期実装では許容する
 *
 * 前提:
 * - GSS には事前に 999 行の空行が用意されている
 * - INSERT（appendRow）は使わない。常に既存行を UPDATE する。
 *
 * record_id 採番規則（仕様書 §5.2）:
 * - 形式: PJT-001-SCN-001
 * - SCN サフィックス
 * - 連番部分は scene_order（scene_no の連番）に対応
 *
 * フィールド構成（GSS 02_Scenes ヘッダー順に合わせる）:
 * SYSTEM_CONTROL: project_id, record_id, generation_status, approval_status, step_id,
 *                 scene_no, updated_at, updated_by
 * AI_OUTPUT: chapter, scene_title, scene_summary, scene_goal, visual_focus, emotion,
 *            short_use, full_use, est_duration_short, est_duration_full,
 *            difficult_words, easy_rewrite, qa_seed, continuity_note
 * HUMAN_REVIEW: notes
 *
 * ⚠️ GSS 02_Scenes の実ヘッダーは scene_no 1 カラム（scene_id/scene_order の 2 カラムではない）。
 *    scene_no には SC-001-01 形式の scene_id 値を格納する。
 */

import { readSheet, updateRow, calcRowIndex, getNextEmptyRowIndex } from "./sheets-client.js";
import type { SceneFullRow } from "../types.js";

const SHEET_NAME = "02_Scenes";

// 02_Scenes の書き込み列順（GSS の実ヘッダー順に厳密に合わせる）
// GSS ヘッダー: project_id, record_id, generation_status, approval_status, step_id,
//               scene_no, chapter, scene_title, scene_summary, scene_goal,
//               visual_focus, emotion, short_use, full_use, est_duration_short,
//               est_duration_full, difficult_words, easy_rewrite, qa_seed,
//               continuity_note, updated_at, updated_by, notes
const SCN_HEADERS: Array<keyof SceneFullRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "scene_no",        // GSS の scene_no カラム（SC-001-01 形式の値を格納）
  "chapter",
  "scene_title",
  "scene_summary",
  "scene_goal",
  "visual_focus",
  "emotion",
  "short_use",
  "full_use",
  "est_duration_short",
  "est_duration_full",
  "difficult_words",
  "easy_rewrite",
  "qa_seed",
  "continuity_note",
  "updated_at",
  "updated_by",
  "notes",
];

/**
 * project_id + scene_no の複合キーで 02_Scenes を upsert する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param fullRow       - 書き込む full row データ（scene_no はシステム側付与済みであること）
 * @returns upsert 後の record_id
 */
export async function upsertScene(
  spreadsheetId: string,
  fullRow: SceneFullRow
): Promise<string> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const projectId = fullRow.project_id.trim();
  const sceneNo = fullRow.scene_no.trim();

  // ── STEP 1: 既存行を project_id + scene_no の複合キーで検索 ───────────────
  for (let i = 0; i < rows.length; i++) {
    const existingProjectId = (rows[i]["project_id"] ?? "").trim();
    const existingSceneNo = (rows[i]["scene_no"] ?? "").trim();

    if (existingProjectId === projectId && existingSceneNo === sceneNo) {
      // UPDATE: 既存 record_id を維持
      const existingRecordId =
        (rows[i]["record_id"] ?? "").trim() ||
        generateRecordId(projectId, fullRow.scene_order);
      const rowIndex = calcRowIndex(i);
      const rowData = buildRowData({ ...fullRow, record_id: existingRecordId });
      await updateRow(spreadsheetId, SHEET_NAME, rowIndex, SCN_HEADERS, rowData);
      return existingRecordId;
    }
  }

  // ── STEP 2: 末尾次行に INSERT ───────────────────────────────────────────
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  const newRecordId = generateRecordId(projectId, fullRow.scene_order);
  const newRowData = buildRowData({ ...fullRow, record_id: newRecordId });
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, SCN_HEADERS, newRowData);
  return newRecordId;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * record_id を採番する。
 * 形式: PJT-001-SCN-001
 */
function generateRecordId(projectId: string, sceneOrder: number): string {
  const match = projectId.match(/^PJT-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid project_id format: "${projectId}"`);
  }
  const projectNum = match[1].padStart(3, "0");
  const seq = String(sceneOrder).padStart(3, "0");
  return `PJT-${projectNum}-SCN-${seq}`;
}

/**
 * scene_no（≒ scene_id）を生成する（システム側付与）。
 * 形式: SC-001-01（SC-{projectNum3桁}-{sceneOrder2桁}）
 * GSS の scene_no カラムに格納する値。
 */
export function generateSceneId(projectId: string, sceneOrder: number): string {
  const match = projectId.match(/^PJT-(\d+)$/);
  if (!match) {
    throw new Error(`Invalid project_id format: "${projectId}"`);
  }
  const projectNum = match[1].padStart(3, "0");
  const seq = String(sceneOrder).padStart(2, "0");
  return `SC-${projectNum}-${seq}`;
}

function buildRowData(row: SceneFullRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SCN_HEADERS) {
    const val = row[key as keyof SceneFullRow];
    result[key] = val != null ? String(val) : "";
  }
  return result;
}

/**
 * load-scenes.ts
 *
 * 02_Scenes シートから対象 project_id の行を読み込む。
 * STEP_04 / STEP_05 が scene master の参照入力として使用する。
 *
 * 返却仕様:
 * - generation_status = "GENERATED" の行のみを返す
 * - scene_no を数値としてソートし昇順で返す
 * - 0 件の場合は空配列（呼び出し側でエラー判定すること）
 */

import { readSheet } from "./sheets-client.js";
import type { SceneReadRow } from "../types.js";

const SHEET_NAME = "02_Scenes";

/**
 * 事前にロード済みの 02_Scenes 行データから、指定 project_id の Scene をフィルタする。
 * batchGet で一括取得した rows を渡すことで API 呼び出しを省略できる。
 *
 * @param rows      - readSheetsBatch で取得した 02_Scenes の行データ
 * @param projectId - 検索する project_id
 * @returns SceneReadRow[]（scene_no 数値昇順）
 */
export function filterScenesByProjectId(
  rows: Array<Record<string, string>>,
  projectId: string
): SceneReadRow[] {
  const target = projectId.trim();
  const scenes: SceneReadRow[] = [];

  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    scenes.push({
      project_id:         row["project_id"]         ?? "",
      record_id:          row["record_id"]           ?? "",
      scene_no:           row["scene_no"]            ?? "",
      chapter:            row["chapter"]             ?? "",
      scene_title:        row["scene_title"]         ?? "",
      scene_summary:      row["scene_summary"]       ?? "",
      scene_goal:         row["scene_goal"]          ?? "",
      visual_focus:       row["visual_focus"]        ?? "",
      emotion:            row["emotion"]             ?? "",
      short_use:          row["short_use"]           ?? "",
      full_use:           row["full_use"]            ?? "",
      est_duration_short: row["est_duration_short"]  ?? "",
      est_duration_full:  row["est_duration_full"]   ?? "",
      difficult_words:    row["difficult_words"]     ?? "",
      easy_rewrite:       row["easy_rewrite"]        ?? "",
      qa_seed:            row["qa_seed"]             ?? "",
      continuity_note:    row["continuity_note"]     ?? "",
      scene_type:         row["scene_type"]          ?? "",
    });
  }

  scenes.sort((a, b) => {
    const na = parseInt(a.scene_no, 10);
    const nb = parseInt(b.scene_no, 10);
    if (isNaN(na) && isNaN(nb)) return 0;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  });

  return scenes;
}

/**
 * 指定 project_id の Scene 行を全件取得する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns SceneReadRow[]（scene_no 数値昇順）
 */
export async function loadScenesByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<SceneReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const scenes: SceneReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    scenes.push({
      project_id:         row["project_id"]         ?? "",
      record_id:          row["record_id"]           ?? "",
      scene_no:           row["scene_no"]            ?? "",
      chapter:            row["chapter"]             ?? "",
      scene_title:        row["scene_title"]         ?? "",
      scene_summary:      row["scene_summary"]       ?? "",
      scene_goal:         row["scene_goal"]          ?? "",
      visual_focus:       row["visual_focus"]        ?? "",
      emotion:            row["emotion"]             ?? "",
      short_use:          row["short_use"]           ?? "",
      full_use:           row["full_use"]            ?? "",
      est_duration_short: row["est_duration_short"]  ?? "",
      est_duration_full:  row["est_duration_full"]   ?? "",
      difficult_words:    row["difficult_words"]     ?? "",
      easy_rewrite:       row["easy_rewrite"]        ?? "",
      qa_seed:            row["qa_seed"]             ?? "",
      continuity_note:    row["continuity_note"]     ?? "",
      scene_type:         row["scene_type"]           ?? "",
    });
  }

  // scene_no を数値としてソート（"1","2","10" の正しい昇順）
  scenes.sort((a, b) => {
    const na = parseInt(a.scene_no, 10);
    const nb = parseInt(b.scene_no, 10);
    if (isNaN(na) && isNaN(nb)) return 0;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  });

  return scenes;
}

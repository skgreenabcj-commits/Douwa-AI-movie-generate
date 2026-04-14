/**
 * load-script.ts
 *
 * 04_Script_Full シートから対象 project_id の行を読み込む。
 * STEP_04 Short Script Build が Full Script を任意参照する際に使用する（不明点1）。
 *
 * 返却仕様:
 * - generation_status = "GENERATED" の行のみを返す
 * - scene_no を数値としてソートし昇順で返す
 * - 0 件の場合は空配列（呼び出し側で hasFullScript = false と判定する）
 */

import { readSheet } from "./sheets-client.js";
import type { ScriptFullReadRow, ScriptShortReadRow } from "../types.js";

const SHEET_NAME = "04_Script_Full";

/**
 * 指定 project_id の Full Script 行を全件取得する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns ScriptFullReadRow[]（scene_no 数値昇順）
 */
export async function loadFullScriptByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<ScriptFullReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const scripts: ScriptFullReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    scripts.push({
      project_id:       row["project_id"]       ?? "",
      record_id:        row["record_id"]         ?? "",
      narration_draft:  row["narration_draft"]   ?? "",
      narration_tts:    row["narration_tts"]     ?? "",
      subtitle_short_1: row["subtitle_short_1"]  ?? "",
      subtitle_short_2: row["subtitle_short_2"]  ?? "",
      emotion:          row["emotion"]           ?? "",
      pause_hint:       row["pause_hint"]        ?? "",
    });
  }

  // scene_no 数値順にソート
  scripts.sort((a, b) => {
    // scene_no カラムが 04_Script_Full にもある想定でソート（なければ元順）
    const sceneNoA = parseInt((a as unknown as Record<string, string>)["scene_no"] ?? "0", 10);
    const sceneNoB = parseInt((b as unknown as Record<string, string>)["scene_no"] ?? "0", 10);
    return sceneNoA - sceneNoB;
  });

  return scripts;
}

// ─── Short Script ─────────────────────────────────────────────────────────────

const SHORT_SHEET_NAME = "03_Script_Short";

/**
 * 指定 project_id の Short Script 行を全件取得する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns ScriptShortReadRow[]（generation_status=GENERATED のみ）
 */
export async function loadShortScriptByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<ScriptShortReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHORT_SHEET_NAME);
  const target = projectId.trim();

  const scripts: ScriptShortReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    scripts.push({
      project_id:       row["project_id"]       ?? "",
      record_id:        row["record_id"]         ?? "",
      narration_tts:    row["narration_tts"]     ?? "",
      subtitle_short_1: row["subtitle_short_1"]  ?? "",
      subtitle_short_2: row["subtitle_short_2"]  ?? "",
      emotion:          row["emotion"]           ?? "",
    });
  }

  return scripts;
}

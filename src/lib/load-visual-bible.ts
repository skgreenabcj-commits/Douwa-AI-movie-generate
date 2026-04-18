/**
 * load-visual-bible.ts
 *
 * 05_Visual_Bible シートから対象 project_id の行を読み込む。
 * STEP_06 の再実行時に既存の record_id を引き継ぐために使用する。
 *
 * 返却仕様:
 * - generation_status = "GENERATED" の行のみを返す
 * - シート上の行順（挿入順）で返す
 * - 0 件の場合は空配列（初回実行では正常）
 */

import { readSheet } from "./sheets-client.js";
import type { VisualBibleReadRow, VisualBibleCharacterRow, VisualBibleFullRow } from "../types.js";

const SHEET_NAME = "05_Visual_Bible";

/**
 * 指定 project_id の Visual Bible 行を全件取得する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns VisualBibleReadRow[]（シート行順）
 */
export async function loadVisualBibleByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<VisualBibleReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: VisualBibleReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    result.push({
      project_id: row["project_id"] ?? "",
      record_id:  row["record_id"]  ?? "",
      category:   row["category"]   ?? "",
      key_name:   row["key_name"]   ?? "",
    });
  }

  return result;
}

/**
 * 指定 project_id の Visual Bible 行を全フィールド付きで取得する（STEP_07 プロンプト生成用）。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns VisualBibleFullRow[]（シート行順）
 */
export async function loadFullVisualBibleByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<VisualBibleFullRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: VisualBibleFullRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    result.push({
      project_id:       row["project_id"]       ?? "",
      record_id:        row["record_id"]         ?? "",
      category:         row["category"]          ?? "",
      key_name:         row["key_name"]          ?? "",
      description:      row["description"]       ?? "",
      color_palette:    row["color_palette"]     ?? "",
      line_style:       row["line_style"]        ?? "",
      lighting:         row["lighting"]          ?? "",
      composition_rule: row["composition_rule"]  ?? "",
      expression_rule:  row["expression_rule"]   ?? "",
      character_rule:   row["character_rule"]    ?? "",
      background_rule:  row["background_rule"]   ?? "",
      avoid_rule:       row["avoid_rule"]        ?? "",
    });
  }

  return result;
}

/**
 * 指定 project_id の Visual Bible から category="character" の行を全フィールド付きで取得する。
 * キャラクターシート画像生成のための詳細データとして使用する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns VisualBibleCharacterRow[]（シート行順）
 */
export async function loadCharactersByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<VisualBibleCharacterRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: VisualBibleCharacterRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    if ((row["category"] ?? "").trim() !== "character") continue;

    result.push({
      key_name:        (row["key_name"]        ?? "").trim(),
      description:     (row["description"]     ?? "").trim(),
      character_rule:  (row["character_rule"]  ?? "").trim(),
      color_palette:   (row["color_palette"]   ?? "").trim(),
      expression_rule: (row["expression_rule"] ?? "").trim(),
      avoid_rule:      (row["avoid_rule"]      ?? "").trim(),
    });
  }

  return result;
}

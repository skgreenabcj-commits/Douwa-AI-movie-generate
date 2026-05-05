/**
 * load-image-prompts.ts
 *
 * 06_Image_Prompts シートから対象 project_id の行を読み込む。
 * STEP_07 の再実行時に既存の record_id を引き継ぐために使用する。
 *
 * 返却仕様:
 * - generation_status = "GENERATED" の行のみを返す
 * - シート上の行順（挿入順）で返す
 * - 0 件の場合は空配列（初回実行では正常）
 */

import { readSheet } from "./sheets-client.js";
import type { ImagePromptReadRow, ImagePromptRetakeRow, ImagePromptPendingRow } from "../types.js";

const SHEET_NAME = "06_Image_Prompts";

/**
 * 指定 project_id の Image Prompts 行を全件取得する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns ImagePromptReadRow[]（シート行順）
 */
export async function loadImagePromptsByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<ImagePromptReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: ImagePromptReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    result.push({
      project_id:      row["project_id"]      ?? "",
      record_id:       row["record_id"]       ?? "",
      related_version: row["related_version"] ?? "",
    });
  }

  return result;
}

/**
 * 指定 project_id の Image Prompts 行のうち approval_status = "RETAKE" のものを取得する。
 * Retake モードのシーン判定と既存プロンプト再利用に使用する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns ImagePromptRetakeRow[]（シート行順）
 */
export async function loadRetakeImagePromptsByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<ImagePromptRetakeRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: ImagePromptRetakeRow[] = [];
  for (const row of rows) {
    if ((row["project_id"]      ?? "").trim() !== target)   continue;
    if ((row["approval_status"] ?? "").trim() !== "RETAKE") continue;

    result.push({
      record_id:          (row["record_id"]          ?? "").trim(),
      related_version:    (row["related_version"]    ?? "").trim(),
      prompt_full:        (row["prompt_full"]        ?? "").trim(),
      prompt_base:        (row["prompt_base"]        ?? "").trim(),
      prompt_character:   (row["prompt_character"]   ?? "").trim(),
      character_refs:     (row["character_refs"]     ?? "").trim(),
      prompt_scene:       (row["prompt_scene"]       ?? "").trim(),
      prompt_composition: (row["prompt_composition"] ?? "").trim(),
      negative_prompt:    (row["negative_prompt"]    ?? "").trim(),
      image_take_1:       (row["image_take_1"]       ?? "").trim(),
      image_take_2:       (row["image_take_2"]       ?? "").trim(),
    });
  }

  return result;
}

/**
 * 指定 project_id の Image Prompts 行のうち generation_status = "PENDING" のものを取得する。
 * STEP_07B の画像生成対象行の取得に使用する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns ImagePromptPendingRow[]（シート行順）
 */
export async function loadPendingImagePromptsByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<ImagePromptPendingRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: ImagePromptPendingRow[] = [];
  for (const row of rows) {
    if ((row["project_id"]        ?? "").trim() !== target)    continue;
    if ((row["generation_status"] ?? "").trim() !== "PENDING") continue;

    result.push({
      project_id:              (row["project_id"]              ?? "").trim(),
      record_id:               (row["record_id"]               ?? "").trim(),
      related_version:         (row["related_version"]         ?? "").trim(),
      approval_status:         (row["approval_status"]         ?? "").trim(),
      scene_no:                (row["scene_no"]                ?? "").trim(),
      prompt_full:             (row["prompt_full"]             ?? "").trim(),
      prompt_base:             (row["prompt_base"]             ?? "").trim(),
      prompt_character:        (row["prompt_character"]        ?? "").trim(),
      character_refs:          (row["character_refs"]          ?? "").trim(),
      prompt_scene:            (row["prompt_scene"]            ?? "").trim(),
      prompt_composition:      (row["prompt_composition"]      ?? "").trim(),
      negative_prompt:         (row["negative_prompt"]         ?? "").trim(),
      image_take_1:            (row["image_take_1"]            ?? "").trim(),
      image_take_2:            (row["image_take_2"]            ?? "").trim(),
      selected_asset:          (row["selected_asset"]          ?? "").trim(),
      revision_note:           (row["revision_note"]           ?? "").trim(),
      style_consistency_check: (row["style_consistency_check"] ?? "").trim(),
      notes:                   (row["notes"]                   ?? "").trim(),
    });
  }

  return result;
}

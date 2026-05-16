/**
 * load-qa.ts
 *
 * 10_QA シートから対象 project_id の行を読み込む。
 * STEP_09 の再実行時に既存の record_id を引き継ぐために使用する。
 *
 * 返却仕様:
 * - generation_status = "GENERATED" の行のみを返す
 * - シート上の行順（挿入順）で返す
 * - 0 件の場合は空配列（初回実行では正常）
 */

import { readSheet } from "./sheets-client.js";
import type { QaReadRow, QaTtsTargetRow } from "../types.js";

const SHEET_NAME = "10_QA";

/**
 * 指定 project_id の QA 行を全件取得する。
 * generation_status = "GENERATED" の行のみを返す。
 * 再実行時の record_id 引き継ぎ用。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns QaReadRow[]（シート行順・qa_no 昇順）
 */
export async function loadQaByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<QaReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: QaReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    result.push({
      project_id: row["project_id"] ?? "",
      record_id:  row["record_id"]  ?? "",
    });
  }

  return result;
}

/**
 * STEP_09B の処理対象 QA 行を取得する。
 *
 * - generation_status = "GENERATED" かつ question_tts_file = "" の行のみを返す
 * - 再実行時は未生成分のみが対象になる
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns QaTtsTargetRow[]（シート行順）
 */
export async function loadQaTtsTargetsByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<QaTtsTargetRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: QaTtsTargetRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    if ((row["question_tts_file"] ?? "").trim() !== "") continue;  // 既に生成済みはスキップ

    result.push({
      project_id:               (row["project_id"]              ?? "").trim(),
      record_id:                (row["record_id"]               ?? "").trim(),
      qa_no:                    parseInt((row["qa_no"]          ?? "0"), 10),
      question_tts:             (row["question_tts"]            ?? "").trim(),
      answer_announcement_tts:  (row["answer_announcement_tts"] ?? "").trim(),
    });
  }

  return result;
}

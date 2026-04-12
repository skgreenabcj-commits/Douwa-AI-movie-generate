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
import type { QaReadRow, QaVersion } from "../types.js";

const SHEET_NAME = "10_QA";

/**
 * 指定 project_id の QA 行を全件取得する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns QaReadRow[]（シート行順）
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

    const version = (row["related_version"] ?? "").trim();
    // related_version が "full" / "short" 以外の行はスキップ
    if (version !== "full" && version !== "short") continue;

    result.push({
      project_id:      row["project_id"] ?? "",
      record_id:       row["record_id"]  ?? "",
      related_version: version as QaVersion,
    });
  }

  return result;
}

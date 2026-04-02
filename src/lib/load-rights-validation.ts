/**
 * load-rights-validation.ts
 *
 * 00_Rights_Validation シートから対象 project_id の行を読み込む。
 * STEP_02 が rights_status チェックと AI 入力補完に使用する。
 */

import { readSheet } from "./sheets-client.js";
import type { RightsValidationReadRow } from "../types.js";

const SHEET_NAME = "00_Rights_Validation";

/**
 * 指定 project_id の Rights Validation 行を取得する。
 * 見つからない場合は null を返す。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns RightsValidationReadRow | null
 */
export async function loadRightsValidationByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<RightsValidationReadRow | null> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() === target) {
      return {
        project_id: row["project_id"] ?? "",
        record_id: row["record_id"] ?? "",
        rights_status: row["rights_status"] ?? "",
        original_author: row["original_author"] ?? "",
        translator: row["translator"] ?? "",
        rights_summary: row["rights_summary"] ?? "",
        public_domain_candidate: row["public_domain_candidate"] ?? "",
      };
    }
  }

  return null;
}

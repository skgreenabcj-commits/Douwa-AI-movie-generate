/**
 * load-source.ts
 *
 * 01_Source シートから対象 project_id の行を読み込む。
 * STEP_03 が approval_status チェックと AI 入力補完に使用する。
 */

import { readSheet } from "./sheets-client.js";
import type { SourceReadRow } from "../types.js";

const SHEET_NAME = "01_Source";

/**
 * 指定 project_id の Source 行を取得する。
 * 見つからない場合は null を返す。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 検索する project_id
 * @returns SourceReadRow | null
 */
export async function loadSourceByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<SourceReadRow | null> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() === target) {
      return {
        project_id: row["project_id"] ?? "",
        record_id: row["record_id"] ?? "",
        approval_status: row["approval_status"] ?? "",
        adaptation_policy: row["adaptation_policy"] ?? "",
        language_style: row["language_style"] ?? "",
        difficult_terms: row["difficult_terms"] ?? "",
        credit_text: row["credit_text"] ?? "",
        base_text_notes: row["base_text_notes"] ?? "",
      };
    }
  }

  return null;
}

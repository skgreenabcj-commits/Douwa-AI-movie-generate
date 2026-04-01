/**
 * update-project.ts
 *
 * 00_Project シートへの最小更新を担当する。
 *
 * 更新対象フィールド（指示書 §6 参照）:
 * - current_step     : STEP_01_RIGHTS_VALIDATION
 * - approval_status  : PENDING（成功） / UNKNOWN（失敗）
 * - created_at       : 既存値維持、空欄時のみ補完可
 * - updated_at       : 実行完了時刻
 * - updated_by       : github_actions
 *
 * 変更しないフィールド:
 * - project_id, record_id, その他人入力フィールドは一切触れない
 */

import { readSheet, updateRow, readSheetHeaders } from "./sheets-client.js";
import type { ProjectMinimalPatch } from "../types.js";

const SHEET_NAME = "00_Project";

/**
 * 00_Project の指定 project_id 行を最小更新する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectId     - 更新対象の project_id
 * @param patch         - 更新する最小フィールド
 */
export async function updateProjectMinimal(
  spreadsheetId: string,
  projectId: string,
  patch: ProjectMinimalPatch
): Promise<void> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  // ヘッダー取得（列インデックスを確認するため）
  let targetRowIndex: number | null = null;
  let existingRow: Record<string, string> | null = null;

  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]["project_id"] ?? "").trim() === target) {
      targetRowIndex = i + 2; // 1-indexed, ヘッダーが1行目
      existingRow = rows[i];
      break;
    }
  }

  if (targetRowIndex === null || existingRow === null) {
    throw new Error(
      `updateProjectMinimal: project_id "${projectId}" not found in ${SHEET_NAME}`
    );
  }

  // 既存行をベースに最小フィールドだけ上書き
  const updatedRow = { ...existingRow };

  updatedRow["current_step"] = patch.current_step;
  updatedRow["approval_status"] = patch.approval_status;
  updatedRow["updated_at"] = patch.updated_at;
  updatedRow["updated_by"] = patch.updated_by;

  // created_at: 既存値があれば維持、空欄時のみ補完
  if (patch.created_at) {
    const existingCreatedAt = (existingRow["created_at"] ?? "").trim();
    if (!existingCreatedAt) {
      updatedRow["created_at"] = patch.created_at;
    }
  }

  // ヘッダー順を取得して行全体を更新（列順を維持）
  const headers = await readSheetHeaders(spreadsheetId, SHEET_NAME);
  await updateRow(
    spreadsheetId,
    SHEET_NAME,
    targetRowIndex,
    headers,
    updatedRow
  );
}

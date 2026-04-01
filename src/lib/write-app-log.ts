/**
 * write-app-log.ts
 *
 * 100_App_Logs シートへのログ追記を担当する。
 * 成功時も失敗時も append する（指示書 §6 参照）。
 *
 * GSS 100_App_Logs の列定義（GSS_field_master.tsv 準拠）:
 *   project_id | record_id | current_step | timestamp | app_log
 *
 * log_level / error_type は app_log フィールドに "[LEVEL][TYPE] message" 形式で含める。
 */

import { appendRow } from "./sheets-client.js";
import type { AppLogRow } from "../types.js";

const SHEET_NAME = "100_App_Logs";

// GSS_field_master.tsv 定義に合わせた列順
const LOG_HEADERS: Array<keyof AppLogRow> = [
  "project_id",
  "record_id",
  "current_step",
  "timestamp",
  "app_log",
];

/**
 * 100_App_Logs に 1 行追記する。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param logRow        - 書き込むログ行
 */
export async function appendAppLog(
  spreadsheetId: string,
  logRow: AppLogRow
): Promise<void> {
  const rowData: Record<string, string> = {
    project_id: logRow.project_id,
    record_id: logRow.record_id,
    current_step: logRow.current_step,
    timestamp: logRow.timestamp,
    app_log: logRow.app_log,
  };

  await appendRow(spreadsheetId, SHEET_NAME, LOG_HEADERS, rowData);
}

/**
 * ログ行を組み立てるファクトリ関数（成功時）
 * log_level=INFO, error_type=success を app_log に埋め込む。
 */
export function buildSuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_01_RIGHTS_VALIDATION",
    timestamp: new Date().toISOString(),
    app_log: `[INFO][success] ${message}`,
  };
}

/**
 * ログ行を組み立てるファクトリ関数（失敗時）
 * log_level=ERROR, error_type を app_log に埋め込む。
 */
export function buildFailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_01_RIGHTS_VALIDATION",
    timestamp: new Date().toISOString(),
    app_log: `[ERROR][${errorType}] ${message}`,
  };
}

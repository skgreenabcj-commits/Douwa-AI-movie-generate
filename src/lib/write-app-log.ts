/**
 * write-app-log.ts
 *
 * 100_App_Logs シートへのログ追記を担当する。
 * 成功時も失敗時も append する（指示書 §6 参照）。
 *
 * 最低限の列（指示書 §6）:
 * - project_id
 * - record_id
 * - current_step
 * - timestamp
 * - app_log
 *
 * 追加列（運用上有用）:
 * - log_level   : INFO / WARN / ERROR
 * - error_type  : success / schema_validation_failure / runtime_failure / ai_failure / write_failure
 */

import { appendRow } from "./sheets-client.js";
import type { AppLogRow } from "../types.js";

const SHEET_NAME = "100_App_Logs";

// 書き込み列順（シートに存在しない列があっても appendRow は空文字を補う）
const LOG_HEADERS: Array<keyof AppLogRow> = [
  "project_id",
  "record_id",
  "current_step",
  "timestamp",
  "log_level",
  "error_type",
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
    log_level: logRow.log_level,
    error_type: logRow.error_type,
    app_log: logRow.app_log,
  };

  await appendRow(spreadsheetId, SHEET_NAME, LOG_HEADERS, rowData);
}

/**
 * ログ行を組み立てるファクトリ関数（成功時）
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
    log_level: "INFO",
    error_type: "success",
    app_log: message,
  };
}

/**
 * ログ行を組み立てるファクトリ関数（失敗時）
 */
export function buildFailureLog(
  projectId: string,
  recordId: string,
  errorType: AppLogRow["error_type"],
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_01_RIGHTS_VALIDATION",
    timestamp: new Date().toISOString(),
    log_level: "ERROR",
    error_type: errorType,
    app_log: message,
  };
}

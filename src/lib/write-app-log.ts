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

import { getNextEmptyRowIndex, updateRow } from "./sheets-client.js";
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

  // appendRow(INSERT_ROWS) は 999 行の空行がある場合に正常動作しないため
  // getNextEmptyRowIndex + updateRow 方式で末尾の次行に書き込む
  const nextRowIndex = await getNextEmptyRowIndex(spreadsheetId, SHEET_NAME);
  await updateRow(spreadsheetId, SHEET_NAME, nextRowIndex, LOG_HEADERS, rowData);
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

// ─── STEP_02 ログビルダー ─────────────────────────────────────────────────────

export function buildStep02SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_02_SOURCE_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[INFO][success] ${message}`,
  };
}

export function buildStep02FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_02_SOURCE_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_03 ログビルダー ─────────────────────────────────────────────────────

export function buildStep03SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_03_SCENES_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[INFO][success] ${message}`,
  };
}

export function buildStep03FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_03_SCENES_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_05 ログビルダー（Full Script Build）────────────────────────────────

export function buildStep05SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_05_FULL_SCRIPT_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[INFO][success] ${message}`,
  };
}

export function buildStep05FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_05_FULL_SCRIPT_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_04_05 COMBINED ログビルダー ─────────────────────────────────────────
//
// 前段エラー（video_format 不正・02_Scenes 0件・load 失敗等）は
// どちらのステップにも属さないため、combined step 用を使う。
// partial success / short_skipped も本ビルダーで一元管理する。

/**
 * STEP_04_05 前段エラー用（video_format 不正・scenes 0件など）
 * current_step は未更新のまま残る想定なので "STEP_04_05_COMBINED" を使用しない。
 * log の current_step には呼び出し側の current_step 現在値を渡すことを推奨するが、
 * 不明な場合は空文字を渡してよい。
 */
export function buildStep04_05PreflightFailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string,
  currentStep = "STEP_04_05_COMBINED"
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: currentStep,
    timestamp:    new Date().toISOString(),
    app_log:      `[ERROR][${errorType}] ${message}`,
  };
}

/**
 * partial success ログ（Full/Short の一方が失敗した場合）
 * current_step は成功したステップの値を渡す。
 */
export function buildStep04_05PartialSuccessLog(
  projectId: string,
  recordId: string,
  currentStep: string,
  fullResult: "success" | "fail" | "skipped",
  shortResult: "success" | "fail" | "skipped"
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: currentStep,
    timestamp:    new Date().toISOString(),
    app_log:      `[WARN][partial_success] Full=${fullResult}, Short=${shortResult}`,
  };
}

/**
 * short_use=Y が 0 件のため Short をスキップしたログ。
 * 失敗ではなく SKIPPED 扱い。
 */
export function buildStep04ShortSkippedLog(
  projectId: string,
  recordId: string,
  currentStep: string,
  reason: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: currentStep,
    timestamp:    new Date().toISOString(),
    app_log:      `[INFO][short_skipped] ${reason}`,
  };
}

/**
 * short+full モードで Full が失敗したため Short を依存関係スキップしたログ。
 */
export function buildStep04DependencySkippedLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_05_FULL_SCRIPT_BUILD",
    timestamp:    new Date().toISOString(),
    app_log:      `[WARN][dependency_failure] ${message}`,
  };
}

// ─── STEP_04 ログビルダー（Short Script Build）───────────────────────────────

export function buildStep04SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_04_SHORT_SCRIPT_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[INFO][success] ${message}`,
  };
}

// ─── STEP_06 ログビルダー（Visual Bible Build）───────────────────────────────

export function buildStep06SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_06_VISUAL_BIBLE",
    timestamp:    new Date().toISOString(),
    app_log:      `[INFO][success] ${message}`,
  };
}

export function buildStep06FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_06_VISUAL_BIBLE",
    timestamp:    new Date().toISOString(),
    app_log:      `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_04 ログビルダー（Short Script Build）────────���──────────────────────

export function buildStep04FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id: projectId,
    record_id: recordId,
    current_step: "STEP_04_SHORT_SCRIPT_BUILD",
    timestamp: new Date().toISOString(),
    app_log: `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_07 ログビルダー（Image Prompts Build）──────────────────────────────

export function buildStep07SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_07_IMAGE_PROMPTS",
    timestamp:    new Date().toISOString(),
    app_log:      `[INFO][success] ${message}`,
  };
}

export function buildStep07PartialSuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_07_IMAGE_PROMPTS",
    timestamp:    new Date().toISOString(),
    app_log:      `[WARN][partial_success] ${message}`,
  };
}

export function buildStep07FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_07_IMAGE_PROMPTS",
    timestamp:    new Date().toISOString(),
    app_log:      `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_07B ログビルダー（Image Generate）─────────────────────────────────

export function buildStep07bSuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_07B_IMAGE_GENERATE",
    timestamp:    new Date().toISOString(),
    app_log:      `[INFO][success] ${message}`,
  };
}

export function buildStep07bPartialSuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_07B_IMAGE_GENERATE",
    timestamp:    new Date().toISOString(),
    app_log:      `[WARN][partial_success] ${message}`,
  };
}

export function buildStep07bFailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_07B_IMAGE_GENERATE",
    timestamp:    new Date().toISOString(),
    app_log:      `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_08A ログビルダー（TTS Subtitle & Edit Plan Build）─────────────────

export function buildStep08aSuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_08A_TTS_SUBTITLE",
    timestamp:    new Date().toISOString(),
    app_log:      `[INFO][success] ${message}`,
  };
}

export function buildStep08aFailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_08A_TTS_SUBTITLE",
    timestamp:    new Date().toISOString(),
    app_log:      `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_08B ログビルダー（TTS Audio Generate）─────────────────────────────

export function buildStep08bSuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_08B_TTS_AUDIO",
    timestamp:    new Date().toISOString(),
    app_log:      `[INFO][success] ${message}`,
  };
}

export function buildStep08bFailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_08B_TTS_AUDIO",
    timestamp:    new Date().toISOString(),
    app_log:      `[ERROR][${errorType}] ${message}`,
  };
}

// ─── STEP_09 ログビルダー（Q&A Build）────────────────────────────────────────

export function buildStep09SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_09_QA_BUILD",
    timestamp:    new Date().toISOString(),
    app_log:      `[INFO][success] ${message}`,
  };
}

export function buildStep09FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow {
  return {
    project_id:   projectId,
    record_id:    recordId,
    current_step: "STEP_09_QA_BUILD",
    timestamp:    new Date().toISOString(),
    app_log:      `[ERROR][${errorType}] ${message}`,
  };
}

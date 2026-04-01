/**
 * load-project-input.ts
 *
 * 00_Project シートから、指定された project_ids に一致する行を返す。
 *
 * 制約:
 * - project_id は GitHub では採番しない（GAS 実行前にシート側で採番済み）
 * - AI 入力は title_jp, source_url のみ（初期実装）
 */

import { readSheet } from "./sheets-client.js";
import type { ProjectRow } from "../types.js";

const SHEET_NAME = "00_Project";

/**
 * 00_Project を読み込み、指定された project_ids に一致する行を返す。
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param projectIds    - 検索する project_id の配列（例: ["PJT-001"]）
 * @returns 一致した ProjectRow の配列（見つからない場合は空配列）
 */
export async function readProjectsByIds(
  spreadsheetId: string,
  projectIds: string[]
): Promise<ProjectRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);

  const targetSet = new Set(projectIds.map((id) => id.trim()));

  return rows
    .filter((row) => targetSet.has((row["project_id"] ?? "").trim()))
    .map(rowToProjectRow);
}

/**
 * 00_Project から 1 件取得する。
 * 複数ヒットした場合は最初の行のみ返す。
 * 見つからない場合は null を返す。
 */
export async function readProjectById(
  spreadsheetId: string,
  projectId: string
): Promise<{ row: ProjectRow; rowIndex: number } | null> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]["project_id"] ?? "").trim() === target) {
      // rowIndex: ヘッダー行が1行目なので、データは2行目から = i + 2
      return { row: rowToProjectRow(rows[i]), rowIndex: i + 2 };
    }
  }

  return null;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function rowToProjectRow(raw: Record<string, string>): ProjectRow {
  return {
    project_id: raw["project_id"] ?? "",
    record_id: raw["record_id"] ?? "",
    project_status: raw["project_status"],
    current_step: raw["current_step"],
    run_enabled: raw["run_enabled"],
    approval_status: raw["approval_status"],
    rights_status: raw["rights_status"],
    title_jp: raw["title_jp"],
    title_en: raw["title_en"],
    series_name: raw["series_name"],
    episode_no: raw["episode_no"],
    source_title: raw["source_title"],
    source_url: raw["source_url"],
    target_age: raw["target_age"],
    video_format: raw["video_format"],
    aspect_short: raw["aspect_short"],
    aspect_full: raw["aspect_full"],
    short_target_sec: raw["short_target_sec"],
    full_target_sec: raw["full_target_sec"],
    visual_style: raw["visual_style"],
    owner: raw["owner"],
    created_at: raw["created_at"],
    updated_at: raw["updated_at"],
    updated_by: raw["updated_by"],
    notes: raw["notes"],
  };
}

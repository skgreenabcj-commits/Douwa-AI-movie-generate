/**
 * load-edit-plan.ts
 *
 * 09_Edit_Plan シートから対象 project_id の行を読み込む。
 */

import { readSheet } from "./sheets-client.js";
import type { EditPlanReadRow, TtsSubtitleVersion } from "../types.js";

const SHEET_NAME = "09_Edit_Plan";

export async function loadEditPlanByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<EditPlanReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: EditPlanReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    const version = (row["related_version"] ?? "").trim();
    if (version !== "full" && version !== "short") continue;

    result.push({
      project_id:      row["project_id"]  ?? "",
      record_id:       row["record_id"]   ?? "",
      related_version: version as TtsSubtitleVersion,
      asset_audio:     row["asset_audio"] ?? "",
      scene_no:        row["scene_no"]    ?? "",
      duration_sec:    row["duration_sec"] ?? "",
    });
  }

  return result;
}

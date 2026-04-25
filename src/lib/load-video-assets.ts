/**
 * load-video-assets.ts
 *
 * STEP_10 Video Build で必要なアセット情報を
 * 09_Edit_Plan と 08_TTS_Subtitles から結合して返す。
 *
 * 返却仕様:
 * - generation_status = "GENERATED" の行のみ
 * - asset_image / asset_audio が両方揃っている行のみ
 * - scene_no を数値としてソートし昇順で返す
 */

import { readSheet } from "./sheets-client.js";
import type { SceneVideoInput, TtsSubtitleVersion } from "../types.js";

const EDIT_PLAN_SHEET  = "09_Edit_Plan";
const TTS_SUBTITLE_SHEET = "08_TTS_Subtitles";

/**
 * 指定 project_id + version の SceneVideoInput 配列を返す。
 */
export async function loadVideoAssetsByProjectId(
  spreadsheetId: string,
  projectId: string,
  version: TtsSubtitleVersion
): Promise<SceneVideoInput[]> {
  const [editRows, ttsRows] = await Promise.all([
    readSheet(spreadsheetId, EDIT_PLAN_SHEET),
    readSheet(spreadsheetId, TTS_SUBTITLE_SHEET),
  ]);
  return filterVideoAssets(editRows, ttsRows, projectId, version);
}

/**
 * 事前ロード済み行データから SceneVideoInput を構築する（batchGet 用）。
 */
export function filterVideoAssets(
  editPlanRows: Array<Record<string, string>>,
  ttsRows:      Array<Record<string, string>>,
  projectId:    string,
  version:      TtsSubtitleVersion
): SceneVideoInput[] {
  const target = projectId.trim();

  // subtitle_text を record_id でインデックス化（version 一致のみ）
  const subtitleMap = new Map<string, string>();
  for (const row of ttsRows) {
    if ((row["project_id"]      ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    if ((row["related_version"]  ?? "").trim() !== version) continue;
    const rid = (row["record_id"] ?? "").trim();
    if (rid) subtitleMap.set(rid, (row["subtitle_text"] ?? "").trim());
  }

  const result: SceneVideoInput[] = [];

  for (const row of editPlanRows) {
    if ((row["project_id"]        ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    if ((row["related_version"]   ?? "").trim() !== version) continue;

    const imageUrl = (row["asset_image"] ?? "").trim();
    const audioUrl = (row["asset_audio"] ?? "").trim();
    if (!imageUrl || !audioUrl) continue;   // 未生成アセットはスキップ

    const recordId   = (row["record_id"]    ?? "").trim();
    const sceneNo    = (row["scene_no"]     ?? "").trim();
    const durationSec = parseFloat(row["duration_sec"] ?? "0") || 0;

    result.push({
      recordId,
      sceneNo,
      imageUrl,
      audioUrl,
      durationSec,
      subtitleText: subtitleMap.get(recordId) ?? "",
    });
  }

  // scene_no を数値としてソート（昇順）
  result.sort((a, b) => {
    const na = parseInt(a.sceneNo, 10);
    const nb = parseInt(b.sceneNo, 10);
    return (isNaN(na) ? 0 : na) - (isNaN(nb) ? 0 : nb);
  });

  return result;
}

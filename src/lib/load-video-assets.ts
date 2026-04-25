/**
 * load-video-assets.ts
 *
 * STEP_10 Video Build で必要なアセット情報を構築する。
 *
 * データソース:
 * - 09_Edit_Plan  : scene_no / duration_sec / related_version（シーン一覧の主テーブル）
 * - 06_Image_Prompts : image_take_1（画像 Drive URL）
 *                      related_version = 02_Scenes.record_id でシーンと紐付け
 * - 08_TTS_Subtitles : audio_file（音声 Drive URL）・subtitle_text
 *                      STEP_08B が確実に書き込むフィールドを使用
 *
 * 09_Edit_Plan.asset_image / asset_audio は STEP_08A/B の書き戻し次第で空欄になるため
 * より確実なソースから直接取得する。
 *
 * 返却仕様:
 * - generation_status = "GENERATED" の行のみ
 * - 画像 URL・音声 URL の両方が取得できた行のみ
 * - scene_no を数値としてソートし昇順で返す
 */

import { readSheet } from "./sheets-client.js";
import type { SceneVideoInput, TtsSubtitleVersion } from "../types.js";

const EDIT_PLAN_SHEET    = "09_Edit_Plan";
const TTS_SUBTITLE_SHEET = "08_TTS_Subtitles";
const IMAGE_PROMPT_SHEET = "06_Image_Prompts";

/**
 * 指定 project_id + version の SceneVideoInput 配列を返す。
 */
export async function loadVideoAssetsByProjectId(
  spreadsheetId: string,
  projectId: string,
  version: TtsSubtitleVersion
): Promise<SceneVideoInput[]> {
  const [editRows, ttsRows, imgRows] = await Promise.all([
    readSheet(spreadsheetId, EDIT_PLAN_SHEET),
    readSheet(spreadsheetId, TTS_SUBTITLE_SHEET),
    readSheet(spreadsheetId, IMAGE_PROMPT_SHEET),
  ]);
  return filterVideoAssets(editRows, ttsRows, imgRows, projectId, version);
}

/**
 * 事前ロード済み行データから SceneVideoInput を構築する（batchGet 用）。
 */
export function filterVideoAssets(
  editPlanRows:    Array<Record<string, string>>,
  ttsRows:         Array<Record<string, string>>,
  imagePromptRows: Array<Record<string, string>>,
  projectId:       string,
  version:         TtsSubtitleVersion
): SceneVideoInput[] {
  const target = projectId.trim();

  // ── 1. 08_TTS_Subtitles から audio_file + subtitle_text を record_id でインデックス化 ──
  const ttsMap = new Map<string, { audioFile: string; subtitleText: string }>();
  for (const row of ttsRows) {
    if ((row["project_id"]        ?? "").trim() !== target)     continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    if ((row["related_version"]   ?? "").trim() !== version)    continue;
    const rid = (row["record_id"] ?? "").trim();
    if (!rid) continue;
    ttsMap.set(rid, {
      audioFile:    (row["audio_file"]    ?? "").trim(),
      subtitleText: (row["subtitle_text"] ?? "").trim(),
    });
  }

  // ── 2. 06_Image_Prompts から image_take_1 を「scene record_id」でインデックス化 ──
  // related_version = 02_Scenes.record_id（例: PJT-001-SCN-001）
  const imageMap = new Map<string, string>(); // scene_record_id → Drive URL
  for (const row of imagePromptRows) {
    if ((row["project_id"]        ?? "").trim() !== target)     continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    const sceneRecordId = (row["related_version"] ?? "").trim();
    const imageUrl      = (row["image_take_1"]    ?? "").trim();
    if (!sceneRecordId || !imageUrl) continue;
    if (!imageMap.has(sceneRecordId)) {
      imageMap.set(sceneRecordId, imageUrl);
    }
  }

  // ── 3. 09_Edit_Plan を主テーブルとして SceneVideoInput を組み立て ─────────────
  const result: SceneVideoInput[] = [];

  for (const row of editPlanRows) {
    if ((row["project_id"]        ?? "").trim() !== target)     continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    if ((row["related_version"]   ?? "").trim() !== version)    continue;

    const recordId    = (row["record_id"]   ?? "").trim();
    const sceneNo     = (row["scene_no"]    ?? "").trim();
    const durationSec = parseFloat(row["duration_sec"] ?? "0") || 0;

    // 画像 URL: 06_Image_Prompts.image_take_1（09_Edit_Plan.asset_image をフォールバック）
    const imageUrl =
      imageMap.get(recordId) ??
      (row["asset_image"] ?? "").trim();

    // 音声 URL: 08_TTS_Subtitles.audio_file（09_Edit_Plan.asset_audio をフォールバック）
    const ttsData  = ttsMap.get(recordId);
    const audioUrl =
      ttsData?.audioFile ??
      (row["asset_audio"] ?? "").trim();

    if (!imageUrl) {
      // 画像なし = スキップ（警告は呼び出し元でログ）
      continue;
    }
    if (!audioUrl) {
      // 音声なし = スキップ
      continue;
    }

    result.push({
      recordId,
      sceneNo,
      imageUrl,
      audioUrl,
      durationSec,
      subtitleText: ttsData?.subtitleText ?? "",
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

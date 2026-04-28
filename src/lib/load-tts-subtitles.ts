/**
 * load-tts-subtitles.ts
 *
 * 08_TTS_Subtitles シートから対象 project_id の行を読み込む。
 */

import { readSheet } from "./sheets-client.js";
import type { TtsSubtitleReadRow, TtsSubtitleRetakeRow, TtsSubtitleVersion } from "../types.js";

const SHEET_NAME = "08_TTS_Subtitles";

export async function loadTtsSubtitlesByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<TtsSubtitleReadRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: TtsSubtitleReadRow[] = [];
  for (const row of rows) {
    if ((row["project_id"] ?? "").trim() !== target) continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;

    const version = (row["related_version"] ?? "").trim();
    if (version !== "full" && version !== "short") continue;

    result.push({
      project_id:      row["project_id"]  ?? "",
      record_id:       row["record_id"]   ?? "",
      related_version: version as TtsSubtitleVersion,
      audio_file:      row["audio_file"]  ?? "",
      scene_no:        row["scene_no"]    ?? "",
      tts_text:        row["tts_text"]    ?? "",
      voice_style:     row["voice_style"] ?? "",
      speech_rate:     row["speech_rate"] ?? "",
    });
  }

  return result;
}

/**
 * 08_TTS_Subtitles から approval_status = "RETAKE" の行を読み込む。
 *
 * ユーザーが tts_text を手動編集した後に approval_status を "RETAKE" にセットした行が対象。
 * STEP_08B RETAKE モードでは、この関数が返す tts_text をそのまま TTS API へ渡す。
 */
export async function loadRetakeTtsSubtitlesByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<TtsSubtitleRetakeRow[]> {
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  const target = projectId.trim();

  const result: TtsSubtitleRetakeRow[] = [];
  for (const row of rows) {
    if ((row["project_id"]        ?? "").trim() !== target)      continue;
    if ((row["generation_status"] ?? "").trim() !== "GENERATED") continue;
    if ((row["approval_status"]   ?? "").trim() !== "RETAKE")    continue;

    const version = (row["related_version"] ?? "").trim();
    if (version !== "full" && version !== "short") continue;

    result.push({
      record_id:       (row["record_id"]   ?? "").trim(),
      related_version: version as TtsSubtitleVersion,
      tts_text:        (row["tts_text"]    ?? "").trim(),
      voice_style:     (row["voice_style"] ?? "").trim(),
      speech_rate:     (row["speech_rate"] ?? "").trim(),
      audio_file:      (row["audio_file"]  ?? "").trim(),
    });
  }

  return result;
}

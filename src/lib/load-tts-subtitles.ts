/**
 * load-tts-subtitles.ts
 *
 * 08_TTS_Subtitles シートから対象 project_id の行を読み込む。
 */

import { readSheet } from "./sheets-client.js";
import type { TtsSubtitleReadRow, TtsSubtitleVersion } from "../types.js";

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

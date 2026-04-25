/**
 * patch-tts-scn010-011.ts
 *
 * One-time patch script: fix tts_text for SCN-010 / SCN-011 (full version).
 *
 * SCN-010: Replace </sub>、 with </sub><break> (accent-assist sub, type A rule)
 * SCN-011: Wrap お供 with <sub alias="おとも"> (reading-fix sub, type B rule)
 *
 * Clears audio_file so STEP_08B picks up the row for re-generation.
 *
 * Usage:
 *   npx esbuild src/scripts/patch-tts-scn010-011.ts --bundle=false --format=esm \
 *     --platform=node --target=node20 --outdir=dist/scripts
 *   SPREADSHEET_ID=xxx GOOGLE_SERVICE_ACCOUNT_JSON='{...}' \
 *     node dist/scripts/patch-tts-scn010-011.js
 */

import { readSheet, updateRow, calcRowIndex } from "../lib/sheets-client.js";
import { logInfo, logError } from "../lib/logger.js";

// ─── 修正対象 ─────────────────────────────────────────────────────────────────

const PATCHES = [
  {
    record_id:       "PJT-001-SCN-010",
    related_version: "full",
    tts_text:
      '<speak><prosody rate="1.0" pitch="+1.0st">' +
      '次に山を歩いていると、木の上から、猿が' +
      '<sub alias="ひょっこり">ひょっこり</sub><break time="200ms"/>' +
      '顔を出しました。「桃太郎さん、ぼくも連れてって！」。' +
      '猿も、おいしいおだんごをもらい、仲間に、加わりました。' +
      '「<sub alias="キーキー">キーキー</sub>！」と、<break time="200ms"/>' +
      '猿は元気いっぱいです。' +
      '</prosody></speak>',
  },
  {
    record_id:       "PJT-001-SCN-011",
    related_version: "full",
    tts_text:
      '<speak><prosody rate="1.0" pitch="+0.5st">' +
      '最後に、<sub alias="バサバサ">バサバサ</sub>と、美しいキジが、飛んできました。' +
      '「空から見張りをします。ぼくも、<sub alias="おとも">お供</sub>させてください」。' +
      'キジも、おだんごをもらって、仲間に、なりました。<break time="400ms"/>' +
      'これで、陸と空の、頼もしい仲間が、そろいました。' +
      '</prosody></speak>',
  },
] as const;

const SHEET_NAME    = "08_TTS_Subtitles";
const TTS_HEADERS   = [
  "project_id", "record_id", "generation_status", "approval_status",
  "step_id", "scene_no", "line_no", "related_version",
  "tts_text", "voice_style", "speech_rate", "pitch_hint", "emotion_hint",
  "audio_file", "subtitle_text", "subtitle_text_alt",
  "tc_in", "tc_out", "subtitle_style", "reading_check",
  "lip_sync_note", "updated_at", "updated_by", "notes",
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const spreadsheetId = (process.env["SPREADSHEET_ID"] ?? "").trim();
  if (!spreadsheetId) {
    throw new Error("SPREADSHEET_ID is not set");
  }

  logInfo(`[PATCH] Loading ${SHEET_NAME}...`);
  const rows = await readSheet(spreadsheetId, SHEET_NAME);
  logInfo(`[PATCH] ${rows.length} rows loaded.`);

  for (const patch of PATCHES) {
    const idx = rows.findIndex(
      (r) =>
        (r["record_id"]       ?? "").trim() === patch.record_id &&
        (r["related_version"] ?? "").trim() === patch.related_version
    );

    if (idx < 0) {
      logError(`[PATCH] Row not found: ${patch.record_id} (${patch.related_version})`);
      continue;
    }

    // Merge: overwrite only tts_text + audio_file + updated_*; keep all other fields
    const merged: Record<string, string> = {};
    for (const key of TTS_HEADERS) {
      merged[key] = String(rows[idx][key] ?? "");
    }
    merged["tts_text"]   = patch.tts_text;
    merged["audio_file"] = "";                          // clear → STEP_08B will re-generate
    merged["updated_at"] = new Date().toISOString();
    merged["updated_by"] = "patch-script";

    await updateRow(spreadsheetId, SHEET_NAME, calcRowIndex(idx), TTS_HEADERS as unknown as Array<keyof typeof merged>, merged);
    logInfo(`[PATCH] ✅ Updated: ${patch.record_id} (${patch.related_version})`);
    logInfo(`         tts_text: ${patch.tts_text.slice(0, 80)}...`);
  }

  logInfo("[PATCH] Done.");
}

main().catch((err) => {
  logError(`[PATCH] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

/**
 * src/scripts/dry-run-step08b.ts
 *
 * STEP_08B TTS Audio Generate テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS への接続なしに、モック TTS 行データを使って STEP_08B の動作を確認する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : 処理対象の TTS 行一覧を表示。Cloud TTS API 呼び出しなし。
 *   DRY_RUN=false : 実際に Cloud TTS API を呼び出し MP3 を生成する。
 *                   Drive アップロード / GSS 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step08b
 *
 * 【環境変数】
 *   DRY_RUN                   : "true" (default) / "false"
 *   GOOGLE_SERVICE_ACCOUNT_JSON: Cloud TTS Auth 用（DRY_RUN=false のとき必須）
 *   TTS_DRIVE_FOLDER_ID       : Google Drive フォルダ ID（ドライランで確認のみ）
 */

import { generateTtsAudio, estimateMp3DurationSec, formatTcOut } from "../lib/generate-tts-audio.js";
import type { TtsSubtitleReadRow, RuntimeConfigMap } from "../types.js";

// ─── モック: TTS 字幕行（audio_file="" = 未生成） ────────────────────────────

const MOCK_TTS_ROWS: TtsSubtitleReadRow[] = [
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-001",
    related_version: "full",
    audio_file:      "",   // 未生成（STEP_08B の処理対象）
    scene_no:        "1",
    tts_text:        "<speak>むかしむかし、あるところに、おじいさんとおばあさんがいました。</speak>",
    voice_style:     "narrator",
    speech_rate:     "normal",
  },
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-002",
    related_version: "full",
    audio_file:      "",   // 未生成
    scene_no:        "2",
    tts_text:        "<speak>おばあさんが川で洗濯をしていると、大きな桃がどんぶらこと流れてきました。</speak>",
    voice_style:     "gentle",
    speech_rate:     "slow",
  },
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-001",
    related_version: "short",
    audio_file:      "",   // 未生成
    scene_no:        "1",
    tts_text:        "<speak>むかしむかし、おばあさんが川で桃を見つけました。</speak>",
    voice_style:     "cheerful",
    speech_rate:     "normal",
  },
];

// ─── CLI パース ───────────────────────────────────────────────────────────────
const isDryRun       = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const driveFolderId  = (process.env.TTS_DRIVE_FOLDER_ID ?? "").trim();

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_08B テスト実行 — TTS Audio Generate");
console.log("═".repeat(70));
console.log(`  DRY_RUN         : ${isDryRun}`);
console.log(`  Drive Folder ID : ${driveFolderId || "NOT SET (check TTS_DRIVE_FOLDER_ID)"}`);
console.log();

// 未生成行のフィルタリング（audio_file="" のみ）
const unprocessedRows = MOCK_TTS_ROWS.filter((r) => (r.audio_file ?? "").trim() === "");

console.log(`  処理対象 TTS 行: ${unprocessedRows.length} 件`);
console.log();

if (isDryRun) {
  console.log("[DRY_RUN] 以下の TTS 行が処理対象になります:");
  console.log("─".repeat(60));
  for (const row of unprocessedRows) {
    console.log(`  ${row.record_id} (${row.related_version})`);
    console.log(`    speech_rate: ${row.speech_rate}`);
    console.log(`    tts_text: ${row.tts_text.slice(0, 60)}...`);
  }
  console.log("─".repeat(60));
  console.log("[DRY_RUN] Cloud TTS API 呼び出しをスキップしました。");
  console.log();
} else {
  // 実際に Cloud TTS API を呼び出す（Drive アップロード・GSS 書き込みはなし）
  const mockConfigMap: RuntimeConfigMap = new Map([
    ["tts_speaking_rate_slow",   "0.75"],
    ["tts_speaking_rate_normal", "0.82"],
    ["tts_speaking_rate_fast",   "0.92"],
  ]);

  let successCount = 0;
  let failCount    = 0;

  for (const row of unprocessedRows) {
    console.log(`[TTS] Generating: ${row.record_id} (${row.related_version})`);
    try {
      const mp3Buffer  = await generateTtsAudio(row.tts_text, row.speech_rate, mockConfigMap);
      const durationSec = estimateMp3DurationSec(mp3Buffer);
      const tcOut       = formatTcOut(durationSec);
      console.log(`  OK: ${mp3Buffer.length} bytes, duration=${tcOut}`);
      console.log(`  [DRY_RUN skip] Would upload to Drive folder: ${driveFolderId || "NOT SET"}`);
      successCount++;
    } catch (e) {
      console.error(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
      failCount++;
    }
  }

  console.log();
  console.log(`  成功: ${successCount} 件 / 失敗: ${failCount} 件`);
}

console.log("═".repeat(70));
console.log("  完了");
console.log("═".repeat(70));

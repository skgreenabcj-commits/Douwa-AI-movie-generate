/**
 * src/scripts/dry-run-step08b.ts
 *
 * STEP_08B TTS Audio Generate テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS への接続なしに、モック TTS 行データを使って STEP_08B の動作を確認する。
 * 通常モード・RETAKE モードの両方を検証できる。
 *
 * 【実行モード】
 *   DRY_RUN=true  : 処理対象の TTS 行一覧を表示。Cloud TTS API 呼び出しなし。
 *   DRY_RUN=false : 実際に Cloud TTS API を呼び出し MP3 を生成する。
 *                   Drive アップロード / GSS 書き込みはなし。
 *
 * 【RETAKE モードの検証】
 *   RETAKE_MODE=true : MOCK_RETAKE_ROWS を対象に RETAKE フローを検証する。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step08b
 *   RETAKE_MODE=true npm run dry-run:step08b
 *
 * 【環境変数】
 *   DRY_RUN                    : "true" (default) / "false"
 *   RETAKE_MODE                : "true" / "false" (default)
 *   GOOGLE_SERVICE_ACCOUNT_JSON: Cloud TTS Auth 用（DRY_RUN=false のとき必須）
 *   TTS_DRIVE_FOLDER_ID        : Google Drive フォルダ ID（ドライランで確認のみ）
 */

import { generateTtsAudio, estimateMp3DurationSec, formatTcOut } from "../lib/generate-tts-audio.js";
import type { TtsSubtitleReadRow, TtsSubtitleRetakeRow, RuntimeConfigMap } from "../types.js";

// ─── モック: 通常モード用（audio_file="" = 未生成） ─────────────────────────

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

// ─── モック: RETAKE モード用（ユーザーが tts_text を手動編集後に approval_status="RETAKE" をセット） ───

const MOCK_RETAKE_ROWS: TtsSubtitleRetakeRow[] = [
  {
    record_id:       "PJT-001-SCN-010",
    related_version: "full",
    // ユーザーが修正済み tts_text（<break> を手動で追加した例）
    tts_text:
      '<speak><prosody rate="1.0" pitch="+1.0st">' +
      '次に山を歩いていると、木の上から、猿が' +
      '<sub alias="ひょっこり">ひょっこり</sub><break time="200ms"/>' +
      '顔を出しました。</prosody></speak>',
    voice_style:     "excited",
    speech_rate:     "fast",
    audio_file:      "https://drive.google.com/old-scn010.mp3",  // 上書き対象
  },
  {
    record_id:       "PJT-001-SCN-011",
    related_version: "full",
    // ユーザーが修正済み tts_text（お供 → <sub alias="おとも"> を追加した例）
    tts_text:
      '<speak><prosody rate="1.0" pitch="+0.5st">' +
      '最後に、<sub alias="バサバサ">バサバサ</sub>と、美しいキジが、飛んできました。' +
      'ぼくも、<sub alias="おとも">お供</sub>させてください。' +
      '</prosody></speak>',
    voice_style:     "cheerful",
    speech_rate:     "normal",
    audio_file:      "https://drive.google.com/old-scn011.mp3",  // 上書き対象
  },
];

// ─── CLI パース ───────────────────────────────────────────────────────────────
const isDryRun    = (process.env["DRY_RUN"]    ?? "true").toLowerCase() !== "false";
const isRetake    = (process.env["RETAKE_MODE"] ?? "false").toLowerCase() === "true";
const driveFolderId = (process.env["TTS_DRIVE_FOLDER_ID"] ?? "").trim();

// ─── 対象行の選択（オーケストレーターと同じロジック） ─────────────────────────
const unprocessedRows = MOCK_TTS_ROWS.filter((r) => (r.audio_file ?? "").trim() === "");
const targetRows: TtsSubtitleReadRow[] | TtsSubtitleRetakeRow[] =
  isRetake ? MOCK_RETAKE_ROWS : unprocessedRows;

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_08B テスト実行 — TTS Audio Generate");
console.log("═".repeat(70));
console.log(`  DRY_RUN         : ${isDryRun}`);
console.log(`  RETAKE_MODE     : ${isRetake}`);
console.log(`  Drive Folder ID : ${driveFolderId || "NOT SET (check TTS_DRIVE_FOLDER_ID)"}`);
console.log(`  対象 TTS 行     : ${targetRows.length} 件${isRetake ? " [RETAKE]" : ""}`);
console.log();

if (isDryRun) {
  console.log(`[DRY_RUN] 以下の TTS 行が処理対象になります${isRetake ? " [RETAKE モード]" : ""}:`);
  console.log("─".repeat(60));
  for (const row of targetRows) {
    console.log(`  ${row.record_id} (${row.related_version})`);
    console.log(`    speech_rate : ${row.speech_rate}`);
    console.log(`    tts_text    : ${row.tts_text.slice(0, 80)}...`);
    if (isRetake && (row as TtsSubtitleRetakeRow).audio_file) {
      console.log(`    old audio   : ${(row as TtsSubtitleRetakeRow).audio_file} → 上書き予定`);
    }
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

  for (const row of targetRows) {
    const label = `${row.record_id} (${row.related_version})${isRetake ? " [RETAKE]" : ""}`;
    console.log(`[TTS] Generating: ${label}`);
    try {
      const mp3Buffer   = await generateTtsAudio(row.tts_text, row.speech_rate, mockConfigMap);
      const durationSec = estimateMp3DurationSec(mp3Buffer);
      const tcOut       = formatTcOut(durationSec);
      console.log(`  OK: ${mp3Buffer.length} bytes, duration=${tcOut}`);
      console.log(`  [DRY_RUN skip] Would upload to Drive folder: ${driveFolderId || "NOT SET"}`);
      if (isRetake) {
        console.log(`  [RETAKE] approval_status would be reset: RETAKE → PENDING`);
      }
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

/**
 * src/scripts/dry-run-step09b.ts
 *
 * STEP_09B Q&A TTS Audio Generate テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS への接続なしに、モック QA 行データを使って STEP_09B の動作を確認する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : 処理対象の QA 行一覧を表示。Cloud TTS API 呼び出しなし。
 *   DRY_RUN=false : 実際に Cloud TTS API を呼び出し MP3 を生成する。
 *                   Drive アップロード / GSS 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step09b
 *   DRY_RUN=false node --env-file=.env dist/scripts/dry-run-step09b.js
 */

import { generateQaTtsAudio, estimateMp3DurationSec } from "../lib/generate-tts-audio.js";
import type { QaTtsTargetRow, RuntimeConfigMap } from "../types.js";

// ─── モック QA 行データ ───────────────────────────────────────────────────────

const MOCK_QA_ROWS: QaTtsTargetRow[] = [
  {
    project_id: "PJT-001",
    record_id:  "PJT-001-QA-001",
    qa_no:      1,
    question_tts:
      '<speak><prosody rate="1.0">問題だよ<break time="1500ms"/>桃の中から出てきたのは誰でしょう？' +
      'おじいさん、桃太郎、おばあさん。</prosody></speak>',
    answer_announcement_tts:
      '<speak><prosody rate="1.0">正解は<break time="1500ms"/>桃太郎でした！' +
      '桃の中から元気よく飛び出してきたのは桃太郎でしたね。<break time="1000ms"/>どうかな?できたかな?</prosody></speak>',
  },
  {
    project_id: "PJT-001",
    record_id:  "PJT-001-QA-002",
    qa_no:      2,
    question_tts:
      '<speak><prosody rate="1.0">問題だよ<break time="1500ms"/>桃太郎が鬼退治に連れて行かなかった動物はどれでしょう？' +
      '犬、猿、ウサギ。</prosody></speak>',
    answer_announcement_tts:
      '<speak><prosody rate="1.0">正解は<break time="1500ms"/>ウサギでした！' +
      '桃太郎のお供は犬・猿・キジの3匹で、ウサギは登場しませんでしたね。<break time="1000ms"/>どうかな?できたかな?</prosody></speak>',
  },
];

// ─── CLI パース ───────────────────────────────────────────────────────────────
const isDryRun = (process.env["DRY_RUN"] ?? "true").toLowerCase() !== "false";

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_09B テスト実行 — Q&A TTS Audio Generate");
console.log("═".repeat(70));
console.log(`  DRY_RUN   : ${isDryRun}`);
console.log(`  対象 QA 行 : ${MOCK_QA_ROWS.length} 件`);
console.log();

if (isDryRun) {
  console.log("[DRY_RUN] 以下の QA 行が処理対象になります:");
  console.log("─".repeat(60));
  for (const row of MOCK_QA_ROWS) {
    console.log(`  ${row.record_id} (qa_no=${row.qa_no})`);
    console.log(`    question_tts        : ${row.question_tts.slice(0, 80)}...`);
    console.log(`    answer_announcement : ${row.answer_announcement_tts.slice(0, 80)}...`);
    console.log(`    → Would generate: ${row.record_id}_q.mp3 / ${row.record_id}_a.mp3`);
  }
  console.log("─".repeat(60));
  console.log("[DRY_RUN] Cloud TTS API 呼び出しをスキップしました。");
  console.log();
} else {
  // 実際に Cloud TTS API を呼び出す（Drive アップロード・GSS 書き込みはなし）
  const mockConfigMap: RuntimeConfigMap = new Map([
    ["tts_qa_voice_name", "ja-JP-Chirp3-HD-Kore"],
    ["tts_qa_pitch_st",   "1"],  // → parsePitchSt が "+1st" に変換
  ]);

  let successCount = 0;
  let failCount    = 0;

  for (const row of MOCK_QA_ROWS) {
    console.log(`[TTS] Processing: ${row.record_id} (qa_no=${row.qa_no})`);

    // 問題音声
    try {
      process.stdout.write(`  question_tts → `);
      const mp3Q = await generateQaTtsAudio(row.question_tts, mockConfigMap);
      const durationQ = estimateMp3DurationSec(mp3Q);
      console.log(`OK  (${mp3Q.length.toLocaleString()} bytes, ${durationQ.toFixed(3)}s)`);
      console.log(`  [DRY_RUN skip] Would upload as: ${row.record_id}_q.mp3`);
    } catch (e) {
      console.log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      failCount++;
      continue;
    }

    // 正解音声
    try {
      process.stdout.write(`  answer_tts   → `);
      const mp3A = await generateQaTtsAudio(row.answer_announcement_tts, mockConfigMap);
      const durationA = estimateMp3DurationSec(mp3A);
      console.log(`OK  (${mp3A.length.toLocaleString()} bytes, ${durationA.toFixed(3)}s)`);
      console.log(`  [DRY_RUN skip] Would upload as: ${row.record_id}_a.mp3`);
      successCount++;
    } catch (e) {
      console.log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      failCount++;
    }

    console.log();
  }

  console.log("─".repeat(60));
  console.log(`  完了: ${successCount} 成功 / ${failCount} 失敗`);
}

console.log("═".repeat(70));
console.log("  完了");
console.log("═".repeat(70));

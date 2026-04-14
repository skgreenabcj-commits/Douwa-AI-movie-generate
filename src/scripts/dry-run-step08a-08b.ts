/**
 * src/scripts/dry-run-step08a-08b.ts
 *
 * STEP_08A_08B 連続実行テストスクリプト（GSS 不要）
 *
 * 【概要】
 * STEP_08A が全成功→STEP_08B 自動トリガーする連続実行モード（STEP_08A_08B）の
 * 動作フローを DRY_RUN=true で検証する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : プロンプト組み立てのみ。Gemini・TTS API 呼び出しなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step08a-08b
 */

import { loadStep08aAssets } from "../lib/load-assets.js";
import { buildStep08aFullPrompt, buildStep08aShortPrompt } from "../lib/build-prompt.js";
import type { ProjectRow, ScriptFullReadRow, ScriptShortReadRow, TtsSubtitleReadRow } from "../types.js";

// ─── モック: 00_Project ───────────────────────────────────────────────────────
const MOCK_PROJECT: ProjectRow = {
  project_id:       "PJT-001",
  record_id:        "PJT-001",
  title_jp:         "桃太郎",
  target_age:       "4-6",
  full_target_sec:  "480",
  short_target_sec: "240",
  video_format:     "short+full",
  visual_style:     "やわらかい水彩絵本風",
  approval_status:  "PENDING",
  current_step:     "STEP_07_IMAGE_PROMPTS",
  updated_at:       "2026-04-13T00:00:00.000Z",
  updated_by:       "github_actions",
};

// ─── モック: 04_Script_Full ───────────────────────────────────────────────────
const MOCK_FULL_SCRIPTS: ScriptFullReadRow[] = [
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-001",
    narration_draft: "むかしむかし、あるところに、おじいさんとおばあさんがいました。",
    narration_tts:   "むかしむかし、あるところに、おじいさんとおばあさんがいました。",
    pause_hint:      "文末に 500ms のポーズ",
    emotion:         "gentle",
    subtitle_short_1:"むかしむかし",
    subtitle_short_2:"おじいさんとおばあさんがいました。",
  },
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-002",
    narration_draft: "おばあさんが川で洗濯をしていると、大きな桃がどんぶらこと流れてきました。",
    narration_tts:   "おばあさんが川で洗濯をしていると、大きな<sub>桃</sub>がどんぶらこと流れてきました。",
    pause_hint:      "どんぶらこの前に 300ms",
    emotion:         "gentle",
    subtitle_short_1:"大きな桃がどんぶらこと",
    subtitle_short_2:"流れてきました。",
  },
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-003",
    narration_draft: "桃を割ってみると、中から元気な男の子が飛び出してきました。",
    narration_tts:   "桃を割ってみると、中から元気な男の子が飛び出してきました。",
    pause_hint:      "",
    emotion:         "excited",
    subtitle_short_1:"桃の中から",
    subtitle_short_2:"男の子が生まれました！",
  },
];

// ─── モック: 03_Script_Short ──────────────────────────────────────────────────
const MOCK_SHORT_SCRIPTS: ScriptShortReadRow[] = [
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-001",
    narration_tts:   "むかしむかし、おばあさんが川で桃を見つけました。",
    emotion:         "gentle",
    subtitle_short_1:"むかしむかし",
    subtitle_short_2:"川で桃を見つけました。",
  },
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-003",
    narration_tts:   "桃の中から元気な男の子が生まれました。桃太郎と名づけられました。",
    emotion:         "excited",
    subtitle_short_1:"桃の中から男の子が",
    subtitle_short_2:"桃太郎と名づけられました。",
  },
];

// ─── モック: 08_TTS_Subtitles（audio_file="" の未生成行）────────────────────
const MOCK_TTS_ROWS: TtsSubtitleReadRow[] = [
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-001",
    related_version: "full",
    audio_file:      "",
    scene_no:        "1",
    tts_text:        "<speak><prosody rate=\"0.82\">むかしむかし…</prosody></speak>",
    voice_style:     "narrator",
    speech_rate:     "normal",
  },
  {
    project_id:      "PJT-001",
    record_id:       "PJT-001-SCN-001",
    related_version: "short",
    audio_file:      "",
    scene_no:        "1",
    tts_text:        "<speak><prosody rate=\"0.82\">むかしむかし、おばあさんが…</prosody></speak>",
    voice_style:     "gentle",
    speech_rate:     "normal",
  },
];

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_08A_08B 連続実行テスト — DRY_RUN");
console.log("═".repeat(70));
console.log();

const step08aAssets = loadStep08aAssets();

// ── Phase 1: STEP_08A シミュレーション ────────────────────────────────────────
console.log("── Phase 1: STEP_08A (TTS Subtitle & Edit Plan Build) ──");
console.log();

console.log("[Full] プロンプト組み立て...");
const fullPrompt = buildStep08aFullPrompt(step08aAssets, MOCK_PROJECT, MOCK_FULL_SCRIPTS);
console.log(`  Full prompt length: ${fullPrompt.length} chars`);
console.log(`  Full prompt preview (first 300 chars):`);
console.log("  " + fullPrompt.slice(0, 300).replace(/\n/g, "\n  "));
console.log();

console.log("[Short] プロンプト組み立て...");
const shortPrompt = buildStep08aShortPrompt(step08aAssets, MOCK_PROJECT, MOCK_SHORT_SCRIPTS);
console.log(`  Short prompt length: ${shortPrompt.length} chars`);
console.log();

const step08aResults = [
  { projectId: "PJT-001", successCount: 3, failCount: 0 },
];
const allSucceeded = step08aResults.every((r) => r.failCount === 0 && r.successCount > 0);

console.log(`[STEP_08A 結果]`);
for (const r of step08aResults) {
  console.log(`  ${r.projectId}: success=${r.successCount}, fail=${r.failCount}`);
}
console.log();

// ── Phase 2: STEP_08B シミュレーション（08A 全成功の場合のみ）────────────────
if (allSucceeded) {
  console.log("── Phase 2: STEP_08B 自動トリガー (TTS Audio Generate) ──");
  console.log();

  const unprocessed = MOCK_TTS_ROWS.filter((r) => (r.audio_file ?? "") === "");
  console.log(`  処理対象 TTS 行: ${unprocessed.length} 件`);
  for (const row of unprocessed) {
    console.log(`  - ${row.record_id} (${row.related_version}): speech_rate=${row.speech_rate}`);
    console.log(`    tts_text: ${row.tts_text.slice(0, 60)}...`);
  }
  console.log();
  console.log("[DRY_RUN] Cloud TTS API 呼び出しをスキップしました。");
  console.log("[DRY_RUN] Google Drive アップロードをスキップしました。");
} else {
  const failed = step08aResults.filter((r) => r.failCount > 0 || r.successCount === 0);
  console.log(`[SKIP] STEP_08A に失敗があるため STEP_08B をスキップ:`);
  for (const r of failed) {
    console.log(`  ${r.projectId}: success=${r.successCount}, fail=${r.failCount}`);
  }
}

console.log();
console.log("═".repeat(70));
console.log("  完了");
console.log("═".repeat(70));

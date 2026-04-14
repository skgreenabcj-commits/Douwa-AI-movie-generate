/**
 * src/scripts/dry-run-step08a.ts
 *
 * STEP_08A TTS Subtitle & Edit Plan Build テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS への接続なしに、ローカルの assets + モック project / script データを使って
 * STEP_08A の動作を検証する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : プロンプトアセンブルのみ。Gemini 呼び出しなし。
 *   DRY_RUN=false : 実際に Gemini を呼び出し、schema 検証まで行う。GSS 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step08a
 *
 * 【環境変数】
 *   PROJECT_IDS    : カンマ区切りの project_id (例: "PJT-001")
 *   DRY_RUN        : "true" (default) / "false"
 *   VIDEO_FORMAT   : "full" / "short" / "short+full" (default: "short+full")
 *
 * 【モック登録済み project_id】
 *   PJT-001 : 桃太郎  (target_age=4-6, video_format=short+full)
 */

import { loadStep08aAssets } from "../lib/load-assets.js";
import { buildStep08aFullPrompt, buildStep08aShortPrompt } from "../lib/build-prompt.js";
import { callGemini } from "../lib/call-gemini.js";
import type { GeminiCallOptions } from "../lib/call-gemini.js";
import { validateTtsSubtitleAiResponse } from "../lib/validate-json.js";
import type { ProjectRow, ScriptFullReadRow, ScriptShortReadRow } from "../types.js";

// ─── モック: 00_Project 行 ─────────────────────────────────────────────────────
const MOCK_PROJECTS: Record<string, ProjectRow> = {
  "PJT-001": {
    project_id:       "PJT-001",
    record_id:        "PJT-001",
    project_status:   "ACTIVE",
    title_jp:         "桃太郎",
    title_en:         "Momotaro",
    source_title:     "桃太郎（青空文庫）",
    source_url:       "https://www.aozora.gr.jp/cards/001044/files/4782_14903.html",
    target_age:       "4-6",
    full_target_sec:  "480",
    short_target_sec: "240",
    video_format:     "short+full",
    visual_style:     "やわらかい水彩絵本風、明るい色調",
    approval_status:  "PENDING",
    current_step:     "STEP_07_IMAGE_PROMPTS",
    updated_at:       "2026-04-13T00:00:00.000Z",
    updated_by:       "github_actions",
    notes:            "",
  },
};

// ─── モック: Full Script 行 ────────────────────────────────────────────────────
const MOCK_FULL_SCRIPTS: Record<string, ScriptFullReadRow[]> = {
  "PJT-001": [
    {
      project_id:       "PJT-001",
      record_id:        "PJT-001-SCN-001",
      narration_draft:  "むかしむかし、あるところに、おじいさんとおばあさんがいました。",
      narration_tts:    "むかしむかし、あるところに、おじいさんとおばあさんがいました。",
      subtitle_short_1: "むかしむかし、あるところに",
      subtitle_short_2: "おじいさんとおばあさんがいました。",
      emotion:          "ふしぎ、わくわく",
      pause_hint:       "「おじいさんとおばあさんがいました」の前に0.4秒の間",
    },
    {
      project_id:       "PJT-001",
      record_id:        "PJT-001-SCN-002",
      narration_draft:  "おばあさんが川で洗濯をしていると、大きな桃がどんぶらこと流れてきました。",
      narration_tts:    "おばあさんが川で洗濯をしていると、大きな桃がどんぶらこと流れてきました。",
      subtitle_short_1: "大きな桃がどんぶらこと",
      subtitle_short_2: "流れてきました。",
      emotion:          "おどろき",
      pause_hint:       "「どんぶらこと」の後に0.3秒の間",
    },
    {
      project_id:       "PJT-001",
      record_id:        "PJT-001-SCN-003",
      narration_draft:  "桃を割ってみると、中から元気な男の子が飛び出してきました。",
      narration_tts:    "桃を割ってみると、中から元気な男の子が飛び出してきました。",
      subtitle_short_1: "桃の中から",
      subtitle_short_2: "元気な男の子が生まれました。",
      emotion:          "よろこび",
      pause_hint:       "",
    },
  ],
};

// ─── モック: Short Script 行 ───────────────────────────────────────────────────
const MOCK_SHORT_SCRIPTS: Record<string, ScriptShortReadRow[]> = {
  "PJT-001": [
    {
      project_id:       "PJT-001",
      record_id:        "PJT-001-SCN-001",
      narration_tts:    "むかしむかし、おばあさんが川で桃を見つけました。",
      subtitle_short_1: "むかしむかし",
      subtitle_short_2: "おばあさんが桃を見つけた",
      emotion:          "わくわく",
    },
    {
      project_id:       "PJT-001",
      record_id:        "PJT-001-SCN-003",
      narration_tts:    "桃の中から元気な男の子が生まれました。桃太郎と名づけられました。",
      subtitle_short_1: "桃から男の子が誕生！",
      subtitle_short_2: "名前は桃太郎",
      emotion:          "よろこび",
    },
  ],
};

// ─── CLI パース ───────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const rawProjectIds = (process.env.PROJECT_IDS ?? cliArgs.join(",") ?? "PJT-001").trim();
const projectIds = rawProjectIds
  ? rawProjectIds.split(",").map((id) => id.trim()).filter(Boolean)
  : ["PJT-001"];
const isDryRun           = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const videoFormatOverride = (process.env.VIDEO_FORMAT ?? "").trim();

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_08A テスト実行 — TTS Subtitle & Edit Plan Build");
console.log("═".repeat(70));
console.log(`  DRY_RUN    : ${isDryRun}`);
console.log(`  PROJECT_IDS: ${projectIds.join(", ")}`);
console.log(`  VIDEO_FORMAT: ${videoFormatOverride || "(project default)"}`);
console.log();

const step08aAssets = loadStep08aAssets();

let totalTests  = 0;
let totalPassed = 0;
let totalFailed = 0;

for (const projectId of projectIds) {
  const project = MOCK_PROJECTS[projectId];
  if (!project) {
    console.error(`[ERROR] Unknown mock project_id: "${projectId}"`);
    totalFailed++;
    continue;
  }

  const videoFormat = videoFormatOverride || (project.video_format ?? "short+full");
  project.video_format = videoFormat;

  const fullScripts  = MOCK_FULL_SCRIPTS[projectId]  ?? [];
  const shortScripts = MOCK_SHORT_SCRIPTS[projectId] ?? [];

  console.log("─".repeat(70));
  console.log(`  Project: ${projectId}  title: ${project.title_jp}`);
  console.log(`  video_format: ${videoFormat}`);
  console.log(`  Full scripts: ${fullScripts.length}`);
  console.log(`  Short scripts: ${shortScripts.length}`);
  console.log();

  // ─── Full TTS Build ─────────────────────────────────────────────────────────
  if (videoFormat === "full" || videoFormat === "short+full") {
    totalTests++;
    console.log("── [Full TTS Subtitle & Edit Plan Build] ──");
    for (const s of fullScripts) {
      console.log(`  ${s.record_id}: ${s.narration_tts.slice(0, 40)}...`);
    }
    console.log();

    try {
      const prompt = buildStep08aFullPrompt(step08aAssets, project, fullScripts);

      if (isDryRun) {
        console.log("[DRY_RUN] Full TTS Prompt Preview (first 2000 chars):");
        console.log("─".repeat(60));
        console.log(prompt.slice(0, 2000));
        console.log("─".repeat(60));
        console.log("[DRY_RUN] Gemini call skipped.");
        totalPassed++;
      } else {
        const options: GeminiCallOptions = {
          primaryModel:   "gemini-2.5-flash",
          secondaryModel: "gemini-2.5-flash",
          maxOutputTokens: 16384,
        };
        console.log("[GEMINI] Calling Gemini for Full TTS...");
        const result = await callGemini(prompt, options);
        console.log(
          `[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`
        );

        const validation = validateTtsSubtitleAiResponse(result.text, step08aAssets.aiSchema);
        if (validation.success) {
          console.log(`[VALID] tts_subtitles: ${validation.ttsSubtitles.length} items`);
          console.log(`[VALID] edit_plan: ${validation.editPlan.length} items`);
          for (const item of validation.ttsSubtitles) {
            console.log(`  ${item.scene_record_id}: voice=${item.voice_style}, rate=${item.speech_rate}`);
          }
          totalPassed++;
        } else {
          console.error(`[INVALID] Full TTS: ${validation.errors}`);
          console.error(`[RAW] ${result.text.slice(0, 300)}`);
          totalFailed++;
        }
      }
    } catch (e) {
      console.error(`[ERROR] Full TTS: ${e instanceof Error ? e.message : String(e)}`);
      totalFailed++;
    }
  }

  // ─── Short TTS Build ────────────────────────────────────────────────────────
  if (videoFormat === "short" || videoFormat === "short+full") {
    totalTests++;
    console.log("── [Short TTS Subtitle & Edit Plan Build] ──");
    for (const s of shortScripts) {
      console.log(`  ${s.record_id}: ${s.narration_tts.slice(0, 40)}...`);
    }
    console.log();

    try {
      const prompt = buildStep08aShortPrompt(step08aAssets, project, shortScripts);

      if (isDryRun) {
        console.log("[DRY_RUN] Short TTS Prompt Preview (first 2000 chars):");
        console.log("─".repeat(60));
        console.log(prompt.slice(0, 2000));
        console.log("─".repeat(60));
        console.log("[DRY_RUN] Gemini call skipped.");
        totalPassed++;
      } else {
        const options: GeminiCallOptions = {
          primaryModel:    "gemini-2.5-flash",
          secondaryModel:  "gemini-2.5-flash",
          maxOutputTokens: 16384,
        };
        console.log("[GEMINI] Calling Gemini for Short TTS...");
        const result = await callGemini(prompt, options);
        console.log(
          `[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`
        );

        const validation = validateTtsSubtitleAiResponse(result.text, step08aAssets.aiSchema);
        if (validation.success) {
          console.log(`[VALID] tts_subtitles: ${validation.ttsSubtitles.length} items`);
          console.log(`[VALID] edit_plan: ${validation.editPlan.length} items`);
          for (const item of validation.ttsSubtitles) {
            console.log(`  ${item.scene_record_id}: voice=${item.voice_style}, rate=${item.speech_rate}`);
          }
          totalPassed++;
        } else {
          console.error(`[INVALID] Short TTS: ${validation.errors}`);
          console.error(`[RAW] ${result.text.slice(0, 300)}`);
          totalFailed++;
        }
      }
    } catch (e) {
      console.error(`[ERROR] Short TTS: ${e instanceof Error ? e.message : String(e)}`);
      totalFailed++;
    }
  }

  console.log();
}

// ─── サマリー ─────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  SUMMARY");
console.log("═".repeat(70));
console.log(`  Total  : ${totalTests}`);
console.log(`  Passed : ${totalPassed}`);
console.log(`  Failed : ${totalFailed}`);
console.log();

if (totalFailed > 0) {
  process.exit(1);
}

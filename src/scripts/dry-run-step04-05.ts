/**
 * src/scripts/dry-run-step04-05.ts
 *
 * STEP_04_05_COMBINED テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS（Google Sheets）への接続なしに、ローカルのリポジトリ assets +
 * モック project / scene データを使って STEP_04_05 の動作を検証する。
 *
 * 【実行モード】
 *   dry_run=true  : プロンプトアセンブルのみ。Gemini 呼び出しなし。
 *   dry_run=false : 実際に Gemini を呼び出し、schema 検証まで行う。GSS 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   node dist/scripts/dry-run-step04-05.js [options]
 *
 * 【環境変数】
 *   PROJECT_IDS      : カンマ区切りの project_id (例: "PJT-001")
 *   DRY_RUN          : "true" (default) / "false"
 *   VIDEO_FORMAT     : "full" / "short" / "short+full" (default: "short+full")
 *   GEMINI_API_KEY   : Gemini API Key（DRY_RUN=false のとき必須）
 *   OUTPUT_DIR       : Gemini 結果を JSON ファイルに保存するディレクトリ（省略可）
 *
 * 【モック登録済み project_id】
 *   PJT-001 : 桃太郎  (target_age=4-6, full=480s, short=240s)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadStep04Assets, loadStep05Assets } from "../lib/load-assets.js";
import { buildStep04Prompt, buildStep05Prompt } from "../lib/build-prompt.js";
import { callGemini } from "../lib/call-gemini.js";
import type { GeminiCallOptions } from "../lib/call-gemini.js";
import { validateScriptFullAiResponse, validateScriptShortAiResponse } from "../lib/validate-json.js";
import type { ProjectRow, SceneReadRow } from "../types.js";

// ─── パス解決 ─────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

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
    current_step:     "STEP_03_SCENES_BUILD",
    created_at:       "2026-04-04T00:00:00.000Z",
    updated_at:       "2026-04-04T00:00:00.000Z",
    updated_by:       "github_actions",
    notes:            "",
  },
};

// ─── モック: 02_Scenes 行（short_use と full_use を含む）──────────────────────
const MOCK_SCENES: Record<string, SceneReadRow[]> = {
  "PJT-001": [
    {
      project_id:         "PJT-001",
      record_id:          "PJT-001-SCN-001",
      scene_no:           "1",
      chapter:            "導入",
      scene_title:        "大きな桃が川から流れてくる",
      scene_summary:      "おじいさんが山へ、おばあさんが川へ洗濯に行く。川に大きな桃がどんぶらこと流れてくる。",
      scene_goal:         "非日常的な出来事で視聴者の興味を引きつける。",
      visual_focus:       "大きな桃と驚くおばあさん",
      emotion:            "ふしぎ、わくわく",
      short_use:          "Y",
      full_use:           "Y",
      est_duration_short: "18",
      est_duration_full:  "35",
      difficult_words:    "どんぶらこ",
      easy_rewrite:       "ぷかぷか流れてくる",
      qa_seed:            "おばあさんは何を見つけたの？",
      continuity_note:    "桃のサイズの大きさを強調する。次の場面へ繋ぐ驚きを残す。",
    },
    {
      project_id:         "PJT-001",
      record_id:          "PJT-001-SCN-002",
      scene_no:           "2",
      chapter:            "導入",
      scene_title:        "桃から男の子が生まれる",
      scene_summary:      "おばあさんが桃を切ると、中から元気な男の子が飛び出してくる。",
      scene_goal:         "主人公・桃太郎の登場と基本設定を伝える。",
      visual_focus:       "割れた桃と笑顔の赤ちゃん",
      emotion:            "おどろき、よろこび",
      short_use:          "Y",
      full_use:           "Y",
      est_duration_short: "20",
      est_duration_full:  "40",
      difficult_words:    "誕生",
      easy_rewrite:       "生まれる",
      qa_seed:            "桃の中から何が出てきたの？",
      continuity_note:    "男の子の衣装・笑顔を次の場面と一致させること。",
    },
    {
      project_id:         "PJT-001",
      record_id:          "PJT-001-SCN-003",
      scene_no:           "3",
      chapter:            "動機形成",
      scene_title:        "鬼のうわさを聞く",
      scene_summary:      "村人から鬼が島の鬼がひどいことをしていると聞いた桃太郎が退治を決意する。",
      scene_goal:         "主人公の動機・目標を明確にする。",
      visual_focus:       "村人と決意した桃太郎",
      emotion:            "まじめ、やる気",
      short_use:          "Y",
      full_use:           "Y",
      est_duration_short: "18",
      est_duration_full:  "35",
      difficult_words:    "退治",
      easy_rewrite:       "やっつける",
      qa_seed:            "桃太郎はなぜ旅に出るの？",
      continuity_note:    "村の雰囲気（心配・暗さ）を次の旅立ち場面へ繋ぐ。",
    },
  ],
};

// ─── CLI パース ───────────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const rawProjectIds = (process.env.PROJECT_IDS ?? cliArgs.join(",") ?? "PJT-001").trim();
const projectIds = rawProjectIds
  ? rawProjectIds.split(",").map((id) => id.trim()).filter(Boolean)
  : ["PJT-001"];
const isDryRun = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const videoFormatOverride = (process.env.VIDEO_FORMAT ?? "").trim();
const outputDir = (process.env.OUTPUT_DIR ?? "").trim();

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_04_05 テスト実行 — DRY-RUN（プロンプトプレビューのみ）");
console.log("═".repeat(70));
console.log(`  DRY_RUN    : ${isDryRun}`);
console.log(`  PROJECT_IDS: ${projectIds.join(", ")}`);
console.log(`  VIDEO_FORMAT: ${videoFormatOverride || "(project default)"}`);
console.log();

const step04Assets = loadStep04Assets();
const step05Assets = loadStep05Assets();

let totalTests = 0;
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
  project.video_format = videoFormat; // override

  const allScenes = MOCK_SCENES[projectId] ?? [];
  const fullScenes = allScenes.filter((s) => s.full_use === "Y");
  const shortScenes = allScenes.filter((s) => s.short_use === "Y");

  console.log("─".repeat(70));
  console.log(`  Project: ${projectId}  title: ${project.title_jp}`);
  console.log(`  video_format: ${videoFormat}`);
  console.log(`  scene count: total=${allScenes.length}, full_use_Y=${fullScenes.length}, short_use_Y=${shortScenes.length}`);
  console.log();

  // ── STEP_05 Full ──────────────────────────────────────────────────────────
  if (videoFormat === "full" || videoFormat === "short+full") {
    totalTests++;
    console.log("── [STEP_05 Full Script Build] ──");
    console.log(`  full_use_Y scenes:`);
    for (const s of fullScenes) {
      console.log(
        `    S${String(s.scene_no).padStart(3, "0")} [${s.short_use}/${s.full_use}] ` +
          `${s.chapter} / ${s.scene_title} (est_full=${s.est_duration_full}s)`
      );
    }
    console.log();

    try {
      const prompt05 = buildStep05Prompt(step05Assets, project, fullScenes);

      if (isDryRun) {
        console.log("[DRY_RUN] Full Script Prompt Preview (first 1500 chars):");
        console.log("─".repeat(60));
        console.log(prompt05.slice(0, 1500));
        console.log("─".repeat(60));
        console.log("[DRY_RUN] Gemini call skipped.");
        totalPassed++;
      } else {
        // Gemini 呼び出し
        const options: GeminiCallOptions = {
          primaryModel: "gemini-2.5-pro",
          secondaryModel: "gemini-2.5-pro",
          maxOutputTokens: 32768,
        };
        console.log("[GEMINI] Calling Gemini for Full Script...");
        const result = await callGemini(prompt05, options);
        console.log(`[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`);

        const validation = validateScriptFullAiResponse(result.text, step05Assets.aiSchema);
        if (validation.success) {
          console.log(`[VALID] scripts count: ${validation.scripts.length}`);
          for (const s of validation.scripts) {
            console.log(`  record_id=${s.record_id}, narration_tts_len=${s.narration_tts.length}`);
          }
          if (outputDir) {
            if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
            const outFile = resolve(outputDir, `${projectId}_full_script.json`);
            writeFileSync(outFile, JSON.stringify({ scripts: validation.scripts }, null, 2));
            console.log(`[OUTPUT] Saved to ${outFile}`);
          }
          totalPassed++;
        } else {
          console.error(`[INVALID] ${validation.errors}`);
          console.error(`[RAW] ${result.text.slice(0, 300)}`);
          totalFailed++;
        }
      }
    } catch (e) {
      console.error(`[ERROR] STEP_05: ${e instanceof Error ? e.message : String(e)}`);
      totalFailed++;
    }

    console.log();
  }

  // ── STEP_04 Short ─────────────────────────────────────────────────────────
  if (videoFormat === "short" || videoFormat === "short+full") {
    totalTests++;
    console.log("── [STEP_04 Short Script Build] ──");
    console.log(`  short_use_Y scenes:`);
    for (const s of shortScenes) {
      console.log(
        `    S${String(s.scene_no).padStart(3, "0")} [${s.short_use}/${s.full_use}] ` +
          `${s.chapter} / ${s.scene_title} (est_short=${s.est_duration_short}s)`
      );
    }

    // モックでは Full Script はなし（dry_run 時は full reference なし）
    const mockFullScripts: import("../types.js").ScriptFullReadRow[] = [];
    console.log(`  has_full_script: false (dry_run mock)`);
    console.log();

    try {
      const prompt04 = buildStep04Prompt(step04Assets, project, shortScenes, mockFullScripts);

      if (isDryRun) {
        console.log("[DRY_RUN] Short Script Prompt Preview (first 1500 chars):");
        console.log("─".repeat(60));
        console.log(prompt04.slice(0, 1500));
        console.log("─".repeat(60));
        console.log("[DRY_RUN] Gemini call skipped.");
        totalPassed++;
      } else {
        const options: GeminiCallOptions = {
          primaryModel: "gemini-2.5-pro",
          secondaryModel: "gemini-2.5-pro",
          maxOutputTokens: 32768,
        };
        console.log("[GEMINI] Calling Gemini for Short Script...");
        const result = await callGemini(prompt04, options);
        console.log(`[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`);

        const validation = validateScriptShortAiResponse(result.text, step04Assets.aiSchema);
        if (validation.success) {
          console.log(`[VALID] scripts count: ${validation.scripts.length}`);
          for (const s of validation.scripts) {
            console.log(`  record_id=${s.record_id}, narration_tts_len=${s.narration_tts.length}`);
          }
          if (outputDir) {
            if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
            const outFile = resolve(outputDir, `${projectId}_short_script.json`);
            writeFileSync(outFile, JSON.stringify({ scripts: validation.scripts }, null, 2));
            console.log(`[OUTPUT] Saved to ${outFile}`);
          }
          totalPassed++;
        } else {
          console.error(`[INVALID] ${validation.errors}`);
          console.error(`[RAW] ${result.text.slice(0, 300)}`);
          totalFailed++;
        }
      }
    } catch (e) {
      console.error(`[ERROR] STEP_04: ${e instanceof Error ? e.message : String(e)}`);
      totalFailed++;
    }

    console.log();
  }
}

// ─── サマリー ─────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log(`  テスト実行完了: total=${totalTests}, passed=${totalPassed}, failed=${totalFailed}`);
console.log("═".repeat(70));

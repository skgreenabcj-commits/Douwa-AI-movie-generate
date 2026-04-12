/**
 * src/scripts/dry-run-step06.ts
 *
 * STEP_06 Visual Bible Build テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS（Google Sheets）への接続なしに、ローカルのリポジトリ assets +
 * モック project / scene データを使って STEP_06 の動作を検証する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : プロンプトアセンブルのみ。Gemini 呼び出しなし。
 *   DRY_RUN=false : 実際に Gemini を呼び出し、schema 検証まで行う。GSS 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   node dist/scripts/dry-run-step06.js
 *
 * 【環境変数】
 *   PROJECT_IDS    : カンマ区切りの project_id (例: "PJT-001")
 *   DRY_RUN        : "true" (default) / "false"
 *   VIDEO_FORMAT   : "full" / "short" / "short+full" (default: "short+full")
 *   GEMINI_API_KEY : Gemini API Key（DRY_RUN=false のとき必須）
 *   OUTPUT_DIR     : Gemini 結果を JSON ファイルに保存するディレクトリ（省略可）
 *
 * 【モック登録済み project_id】
 *   PJT-001 : 桃太郎  (target_age=4-6, video_format=short+full)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadStep06Assets } from "../lib/load-assets.js";
import { buildStep06Prompt } from "../lib/build-prompt.js";
import { callGemini } from "../lib/call-gemini.js";
import type { GeminiCallOptions } from "../lib/call-gemini.js";
import { validateVisualBibleAiResponse } from "../lib/validate-json.js";
import type { ProjectRow, SceneReadRow } from "../types.js";

// ─── パス解決 ─────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
void REPO_ROOT; // suppress unused warning

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
    current_step:     "STEP_05_FULL_SCRIPT_BUILD",
    created_at:       "2026-04-04T00:00:00.000Z",
    updated_at:       "2026-04-04T00:00:00.000Z",
    updated_by:       "github_actions",
    notes:            "",
  },
};

// ─── モック: 02_Scenes 行 ─────────────────────────────────────────────────────
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
console.log("  STEP_06 テスト実行 — Visual Bible Build");
console.log("═".repeat(70));
console.log(`  DRY_RUN    : ${isDryRun}`);
console.log(`  PROJECT_IDS: ${projectIds.join(", ")}`);
console.log(`  VIDEO_FORMAT: ${videoFormatOverride || "(project default)"}`);
console.log();

const step06Assets = loadStep06Assets();

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
  project.video_format = videoFormat;

  const allScenes = MOCK_SCENES[projectId] ?? [];

  // video_format に応じてシーンをフィルタ（オーケストレーターと同じロジック）
  let targetScenes: SceneReadRow[];
  if (videoFormat === "full") {
    targetScenes = allScenes.filter((s) => s.full_use === "Y");
  } else if (videoFormat === "short") {
    targetScenes = allScenes.filter((s) => s.short_use === "Y");
  } else {
    targetScenes = allScenes.filter((s) => s.full_use === "Y");
  }

  console.log("─".repeat(70));
  console.log(`  Project: ${projectId}  title: ${project.title_jp}`);
  console.log(`  video_format: ${videoFormat}`);
  console.log(`  target scenes: ${targetScenes.length} (filter: ${videoFormat === "short" ? "short_use=Y" : "full_use=Y"})`);
  console.log();

  totalTests++;
  console.log("── [STEP_06 Visual Bible Build] ──");
  for (const s of targetScenes) {
    console.log(
      `  S${String(s.scene_no).padStart(3, "0")} ${s.chapter} / ${s.scene_title}`
    );
  }
  console.log();

  try {
    const prompt = buildStep06Prompt(step06Assets, project, targetScenes);

    if (isDryRun) {
      console.log("[DRY_RUN] Visual Bible Prompt Preview (first 1500 chars):");
      console.log("─".repeat(60));
      console.log(prompt.slice(0, 1500));
      console.log("─".repeat(60));
      console.log("[DRY_RUN] Gemini call skipped.");
      totalPassed++;
    } else {
      const options: GeminiCallOptions = {
        primaryModel: "gemini-2.5-pro",
        secondaryModel: "gemini-2.5-pro",
        maxOutputTokens: 32768,
      };
      console.log("[GEMINI] Calling Gemini for Visual Bible...");
      const result = await callGemini(prompt, options);
      console.log(
        `[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`
      );

      const validation = validateVisualBibleAiResponse(result.text, step06Assets.aiSchema);
      if (validation.success) {
        console.log(`[VALID] visual_bible items: ${validation.items.length}`);
        for (const item of validation.items) {
          console.log(`  category=${item.category}, key_name=${item.key_name}`);
        }
        if (outputDir) {
          if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
          const outFile = resolve(outputDir, `${projectId}_visual_bible.json`);
          writeFileSync(outFile, JSON.stringify({ visual_bible: validation.items }, null, 2));
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
    console.error(`[ERROR] STEP_06: ${e instanceof Error ? e.message : String(e)}`);
    totalFailed++;
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

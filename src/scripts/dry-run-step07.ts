/**
 * src/scripts/dry-run-step07.ts
 *
 * STEP_07 Image Prompts Build テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS・Google Drive・画像生成 API への接続なしに、ローカルのリポジトリ assets +
 * モック project / scene / Visual Bible データを使って STEP_07 の動作を検証する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : プロンプトアセンブルのみ。Gemini 呼び出しなし。
 *   DRY_RUN=false : 実際に Gemini テキスト生成を呼び出し、schema 検証まで行う。
 *                   GSS / Drive 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   node dist/scripts/dry-run-step07.js
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
import { loadStep07Assets } from "../lib/load-assets.js";
import { buildStep07Prompt } from "../lib/build-prompt.js";
import { callGemini } from "../lib/call-gemini.js";
import type { GeminiCallOptions } from "../lib/call-gemini.js";
import { validateImagePromptAiResponse } from "../lib/validate-json.js";
import type { ProjectRow, SceneReadRow, VisualBibleReadRow } from "../types.js";

// ─── パス解決 ─────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
void REPO_ROOT;

// ─── モック: 00_Project ────────────────────────────────────────────────────────
const MOCK_PROJECTS: Record<string, ProjectRow> = {
  "PJT-001": {
    project_id:       "PJT-001",
    record_id:        "PJT-001",
    project_status:   "ACTIVE",
    title_jp:         "桃太郎",
    title_en:         "Momotaro",
    target_age:       "4-6",
    full_target_sec:  "480",
    short_target_sec: "240",
    video_format:     "short+full",
    visual_style:     "やわらかい水彩絵本風、明るい色調",
    approval_status:  "PENDING",
    current_step:     "STEP_06_VISUAL_BIBLE",
    updated_at:       "2026-04-12T00:00:00.000Z",
    updated_by:       "github_actions",
    notes:            "",
  },
};

// ─── モック: 02_Scenes ────────────────────────────────────────────────────────
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
      continuity_note:    "桃のサイズの大きさを強調する。",
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
  ],
};

// ─── モック: 05_Visual_Bible ──────────────────────────────────────────────────
const MOCK_VISUAL_BIBLE: Record<string, VisualBibleReadRow[]> = {
  "PJT-001": [
    {
      project_id: "PJT-001",
      record_id:  "PJT-001-VB-001",
      category:   "character",
      key_name:   "おばあさん",
    } as VisualBibleReadRow & Record<string, string>,
    {
      project_id: "PJT-001",
      record_id:  "PJT-001-VB-002",
      category:   "color_theme",
      key_name:   "全体配色",
    } as VisualBibleReadRow & Record<string, string>,
    {
      project_id: "PJT-001",
      record_id:  "PJT-001-VB-003",
      category:   "style_global",
      key_name:   "全体画風",
    } as VisualBibleReadRow & Record<string, string>,
    {
      project_id: "PJT-001",
      record_id:  "PJT-001-VB-004",
      category:   "avoid",
      key_name:   "全体禁止事項",
    } as VisualBibleReadRow & Record<string, string>,
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
console.log("  STEP_07 テスト実行 — Image Prompts Build");
console.log("═".repeat(70));
console.log(`  DRY_RUN    : ${isDryRun}`);
console.log(`  PROJECT_IDS: ${projectIds.join(", ")}`);
console.log(`  VIDEO_FORMAT: ${videoFormatOverride || "(project default)"}`);
console.log();

const step07Assets = loadStep07Assets();

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
  let targetScenes: SceneReadRow[];
  if (videoFormat === "full") {
    targetScenes = allScenes.filter((s) => s.full_use === "Y");
  } else if (videoFormat === "short") {
    targetScenes = allScenes.filter((s) => s.short_use === "Y");
  } else {
    targetScenes = allScenes.filter((s) => s.full_use === "Y");
  }

  const visualBible = MOCK_VISUAL_BIBLE[projectId] ?? [];

  console.log("─".repeat(70));
  console.log(`  Project: ${projectId}  title: ${project.title_jp}`);
  console.log(`  video_format: ${videoFormat}`);
  console.log(`  target scenes: ${targetScenes.length}`);
  console.log(`  visual_bible rows: ${visualBible.length}`);
  console.log();

  for (const scene of targetScenes) {
    totalTests++;
    console.log(`── Scene ${scene.scene_no}: ${scene.scene_title}`);

    try {
      const prompt = buildStep07Prompt(step07Assets, project, scene, visualBible);

      if (isDryRun) {
        console.log("[DRY_RUN] Prompt Preview (first 1500 chars):");
        console.log("─".repeat(60));
        console.log(prompt.slice(0, 1500));
        console.log("─".repeat(60));
        console.log("[DRY_RUN] Gemini call skipped.");
        totalPassed++;
      } else {
        const options: GeminiCallOptions = {
          primaryModel: "gemini-2.5-pro",
          secondaryModel: "gemini-2.5-pro",
          maxOutputTokens: 8192,
        };
        console.log("[GEMINI] Calling Gemini for text prompt parts...");
        const result = await callGemini(prompt, options);
        console.log(
          `[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`
        );

        const validation = validateImagePromptAiResponse(result.text, step07Assets.aiSchema);
        if (validation.success) {
          const ai = validation.item;
          const promptFull = [
            ai.prompt_base,
            ai.prompt_character,
            ai.prompt_scene,
            ai.prompt_composition,
          ].filter(Boolean).join(", ");

          console.log(`[VALID] scene_record_id=${ai.scene_record_id}`);
          console.log(`  prompt_full (preview): ${promptFull.slice(0, 200)}`);
          console.log(`  negative_prompt: ${ai.negative_prompt.slice(0, 100)}`);

          if (outputDir) {
            if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
            const outFile = resolve(
              outputDir,
              `${projectId}_${scene.record_id}_image_prompt.json`
            );
            writeFileSync(
              outFile,
              JSON.stringify({ image_prompts: [{ ...ai, prompt_full: promptFull }] }, null, 2)
            );
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
      console.error(`[ERROR] STEP_07 scene ${scene.scene_no}: ${e instanceof Error ? e.message : String(e)}`);
      totalFailed++;
    }

    console.log();
  }
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

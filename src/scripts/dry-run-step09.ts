/**
 * src/scripts/dry-run-step09.ts
 *
 * STEP_09 Q&A Build テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS（Google Sheets）への接続なしに、ローカルのリポジトリ assets +
 * モック project / scene データを使って STEP_09 の動作を検証する。
 *
 * 【実行モード】
 *   DRY_RUN=true  : プロンプトアセンブルのみ。Gemini 呼び出しなし。
 *   DRY_RUN=false : 実際に Gemini を呼び出し、schema 検証まで行う。GSS 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   npm run dry-run:step09
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
import { loadStep09Assets } from "../lib/load-assets.js";
import { buildStep09FullPrompt, buildStep09ShortPrompt } from "../lib/build-prompt.js";
import { callGemini } from "../lib/call-gemini.js";
import type { GeminiCallOptions } from "../lib/call-gemini.js";
import { validateQaAiResponse } from "../lib/validate-json.js";
import type { ProjectRow, SceneReadRow, QaAiRow } from "../types.js";

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
    current_step:     "STEP_06_VISUAL_BIBLE",
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
    {
      project_id:         "PJT-001",
      record_id:          "PJT-001-SCN-004",
      scene_no:           "4",
      chapter:            "旅・仲間集め",
      scene_title:        "きびだんごで仲間を集める",
      scene_summary:      "桃太郎はきびだんごを作り、道中で犬・サル・キジを仲間にしていく。",
      scene_goal:         "協力・仲間の大切さを示す。",
      visual_focus:       "きびだんごを差し出す桃太郎と3匹の動物",
      emotion:            "たのしい、なかよし",
      short_use:          "N",
      full_use:           "Y",
      est_duration_short: "0",
      est_duration_full:  "60",
      difficult_words:    "きびだんご",
      easy_rewrite:       "おだんご",
      qa_seed:            "桃太郎の仲間は誰かな？",
      continuity_note:    "仲間が増えるたびに賑やかさが増す演出。",
    },
    {
      project_id:         "PJT-001",
      record_id:          "PJT-001-SCN-005",
      scene_no:           "5",
      chapter:            "対決",
      scene_title:        "鬼ヶ島で鬼を退治する",
      scene_summary:      "鬼ヶ島に乗り込んだ桃太郎と仲間たちが鬼と戦い、鬼は降参する。",
      scene_goal:         "クライマックス。勇気・協力の成果を見せる。",
      visual_focus:       "戦う桃太郎と降参する鬼",
      emotion:            "どきどき、かちかち",
      short_use:          "Y",
      full_use:           "Y",
      est_duration_short: "35",
      est_duration_full:  "70",
      difficult_words:    "降参",
      easy_rewrite:       "まけました",
      qa_seed:            "鬼はどうなったの？",
      continuity_note:    "勝利後の達成感を次の帰還場面に繋げる。",
    },
    {
      project_id:         "PJT-001",
      record_id:          "PJT-001-SCN-006",
      scene_no:           "6",
      chapter:            "結末",
      scene_title:        "宝を持って村に帰る",
      scene_summary:      "鬼から宝を取り戻した桃太郎が仲間と村に凱旋し、おじいさん・おばあさんと再会する。",
      scene_goal:         "ハッピーエンドと家族愛を伝える。",
      visual_focus:       "宝箱と笑顔で迎える老夫婦",
      emotion:            "うれしい、あたたかい",
      short_use:          "Y",
      full_use:           "Y",
      est_duration_short: "25",
      est_duration_full:  "50",
      difficult_words:    "凱旋",
      easy_rewrite:       "勝って帰ってくる",
      qa_seed:            "村に帰った桃太郎はどんな気持ちだったの？",
      continuity_note:    "最終シーンは家族全員の笑顔で締める。",
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
const geminiApiKey = (process.env.GEMINI_API_KEY ?? "").trim();

// ─── メイン ───────────────────────────────────────────────────────────────────
console.log("═".repeat(70));
console.log("  STEP_09 テスト実行 — Q&A Build");
console.log("═".repeat(70));
console.log(`  DRY_RUN    : ${isDryRun}`);
console.log(`  PROJECT_IDS: ${projectIds.join(", ")}`);
console.log(`  VIDEO_FORMAT: ${videoFormatOverride || "(project default)"}`);
console.log();

const step09Assets = loadStep09Assets();

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
  const fullScenes = allScenes.filter((s) => s.full_use === "Y");
  const shortScenes = allScenes.filter((s) => s.short_use === "Y");

  console.log("─".repeat(70));
  console.log(`  Project: ${projectId}  title: ${project.title_jp}`);
  console.log(`  video_format: ${videoFormat}`);
  console.log(`  full_use=Y scenes: ${fullScenes.length}`);
  console.log(`  short_use=Y scenes: ${shortScenes.length}`);
  console.log();

  // Full QA 生成済み行（Short プロンプトへの参照コンテキスト用）
  let fullQaAiRows: QaAiRow[] = [];
  let fullWrittenCount = 0;

  // ─── Full QA ─────────────────────────────────────────────────────────────────
  if (videoFormat === "full" || videoFormat === "short+full") {
    totalTests++;
    console.log("── [Full QA Build] ──");
    for (const s of fullScenes) {
      console.log(`  S${String(s.scene_no).padStart(3, "0")} ${s.chapter} / ${s.scene_title}`);
    }
    console.log();

    try {
      const prompt = buildStep09FullPrompt(step09Assets, project, fullScenes);

      if (isDryRun) {
        console.log("[DRY_RUN] Full QA Prompt Preview (first 2000 chars):");
        console.log("─".repeat(60));
        console.log(prompt.slice(0, 2000));
        console.log("─".repeat(60));
        console.log("[DRY_RUN] Gemini call skipped.");
        totalPassed++;
      } else {
        if (!geminiApiKey) {
          throw new Error("GEMINI_API_KEY is required for DRY_RUN=false");
        }
        const options: GeminiCallOptions = {
          apiKey: geminiApiKey,
          primaryModel: "gemini-2.5-flash",
          secondaryModel: "gemini-2.5-flash",
          maxOutputTokens: 8192,
        };
        console.log("[GEMINI] Calling Gemini for Full QA...");
        const result = await callGemini(prompt, options);
        console.log(
          `[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`
        );

        const validation = validateQaAiResponse(result.text, step09Assets.aiSchema, 1);
        if (validation.success) {
          console.log(`[VALID] Full QA items: ${validation.items.length}`);
          for (const item of validation.items) {
            console.log(`  qa_type=${item.qa_type} | Q: ${item.question}`);
          }
          fullQaAiRows = validation.items;
          fullWrittenCount = validation.items.length;

          if (outputDir) {
            if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
            const outFile = resolve(outputDir, `${projectId}_qa_full.json`);
            writeFileSync(outFile, JSON.stringify({ qa: validation.items }, null, 2));
            console.log(`[OUTPUT] Saved to ${outFile}`);
          }
          totalPassed++;
        } else {
          console.error(`[INVALID] Full QA: ${validation.errors}`);
          console.error(`[RAW] ${result.text.slice(0, 300)}`);
          totalFailed++;
          // short+full の場合は Short もスキップ
          if (videoFormat === "short+full") {
            console.warn("[SKIP] Short QA skipped due to Full QA failure.");
            totalTests++; // Short のカウントを加算
            totalFailed++;
            continue;
          }
        }
      }
    } catch (e) {
      console.error(`[ERROR] Full QA: ${e instanceof Error ? e.message : String(e)}`);
      totalFailed++;
    }
  }

  // ─── Short QA ────────────────────────────────────────────────────────────────
  if (videoFormat === "short" || videoFormat === "short+full") {
    totalTests++;
    console.log("── [Short QA Build] ──");
    for (const s of shortScenes) {
      console.log(`  S${String(s.scene_no).padStart(3, "0")} ${s.chapter} / ${s.scene_title}`);
    }
    if (fullQaAiRows.length > 0) {
      console.log(`  (reference_full_qa: ${fullQaAiRows.length} items)`);
    }
    console.log();

    try {
      const prompt = buildStep09ShortPrompt(
        step09Assets, project, shortScenes, fullQaAiRows
      );

      if (isDryRun) {
        console.log("[DRY_RUN] Short QA Prompt Preview (first 2000 chars):");
        console.log("─".repeat(60));
        console.log(prompt.slice(0, 2000));
        console.log("─".repeat(60));
        console.log("[DRY_RUN] Gemini call skipped.");
        totalPassed++;
      } else {
        if (!geminiApiKey) {
          throw new Error("GEMINI_API_KEY is required for DRY_RUN=false");
        }
        const options: GeminiCallOptions = {
          apiKey: geminiApiKey,
          primaryModel: "gemini-2.5-flash",
          secondaryModel: "gemini-2.5-flash",
          maxOutputTokens: 8192,
        };
        console.log("[GEMINI] Calling Gemini for Short QA...");
        const result = await callGemini(prompt, options);
        console.log(
          `[GEMINI] Response. model=${result.modelUsed}, usedFallback=${result.usedFallback}, len=${result.text.length}`
        );

        // Short: minItems=3
        const validation = validateQaAiResponse(result.text, step09Assets.aiSchema, 3);
        if (validation.success) {
          console.log(`[VALID] Short QA items: ${validation.items.length}`);
          for (const item of validation.items) {
            console.log(`  qa_type=${item.qa_type} | Q: ${item.question}`);
          }

          // record_id 採番確認（実際の upsert はしない）
          console.log("\n  [record_id 採番プレビュー]");
          validation.items.forEach((item, i) => {
            const seqNo = fullWrittenCount + i + 1;
            const recordId = `${projectId}-QA-${String(seqNo).padStart(3, "0")}`;
            console.log(`  ${recordId} | qa_no=${i + 1} | related_version=short`);
          });

          if (outputDir) {
            if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
            const outFile = resolve(outputDir, `${projectId}_qa_short.json`);
            writeFileSync(outFile, JSON.stringify({ qa: validation.items }, null, 2));
            console.log(`\n[OUTPUT] Saved to ${outFile}`);
          }
          totalPassed++;
        } else {
          console.error(`[INVALID] Short QA: ${validation.errors}`);
          console.error(`[RAW] ${result.text.slice(0, 300)}`);
          totalFailed++;
        }
      }
    } catch (e) {
      console.error(`[ERROR] Short QA: ${e instanceof Error ? e.message : String(e)}`);
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

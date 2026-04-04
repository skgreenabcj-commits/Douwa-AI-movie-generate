/**
 * src/scripts/dry-run-step03.ts
 *
 * STEP_03 テスト実行スクリプト（GSS 不要）
 *
 * 【概要】
 * GSS（Google Sheets）への接続なしに、ローカルのリポジトリ assets +
 * モック project/source データを使って STEP_03 の動作を検証する。
 *
 * 【実行モード】
 *   dry_run=true  : プロンプトアセンブルのみ。Gemini 呼び出しなし。
 *   dry_run=false : 実際に Gemini を呼び出し、schema 検証まで行う。GSS 書き込みはなし。
 *
 * 【ビルド & 実行】
 *   npm run build
 *   node dist/scripts/dry-run-step03.js [options]
 *
 * 【環境変数】
 *   PROJECT_IDS      : カンマ区切りの project_id (例: "PJT-001,PJT-002")
 *   DRY_RUN          : "true" (default) / "false" — false にすると Gemini を呼び出す
 *   GEMINI_API_KEY   : Gemini API Key（DRY_RUN=false のとき必須）
 *   OUTPUT_DIR       : Gemini 結果を JSON ファイルに保存するディレクトリ（省略可）
 *
 * 【CLI 引数（環境変数より優先）】
 *   node dist/scripts/dry-run-step03.js PJT-001
 *   node dist/scripts/dry-run-step03.js PJT-001 PJT-002
 *
 * 【npm script 経由】
 *   npm run dry-run:step03
 *   PROJECT_IDS=PJT-001,PJT-002 npm run dry-run:step03
 *   DRY_RUN=false GEMINI_API_KEY=xxx PROJECT_IDS=PJT-001 npm run dry-run:step03
 *
 * 【モック登録済み project_id】
 *   PJT-001 : 桃太郎        (target_age=4-6, full=480s, short=240s)
 *   PJT-002 : 浦島太郎      (target_age=6-8, full=360s, short=180s)
 *   PJT-003 : 金太郎        (target_age=2-3, full=180s, short=90s)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadStep03Assets } from "../lib/load-assets.js";
import { buildStep03Prompt } from "../lib/build-prompt.js";
import { callGemini } from "../lib/call-gemini.js";
import type { GeminiCallOptions } from "../lib/call-gemini.js";
import { validateSceneAiResponse } from "../lib/validate-json.js";
import { generateSceneId } from "../lib/write-scenes.js";
import type { ProjectRow, SourceReadRow } from "../types.js";

// ─── パス解決 ─────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// dist/scripts/ から 2 段上がりリポジトリルートへ
const REPO_ROOT = resolve(__dirname, "..", "..");

// ─── scene_max_sec デフォルト値 ───────────────────────────────────────────────
const DEFAULT_SCENE_MAX_SEC: Record<string, number> = {
  "2-3": 15,
  "4-6": 25,
  "6-8": 40,
};
const DEFAULT_SCENE_MAX_SEC_FALLBACK = 25;

// ─── モック: 00_Project 行 レジストリ ─────────────────────────────────────────
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
    visual_style:     "やわらかい水彩絵本風、明るい色調",
    approval_status:  "PENDING",
    current_step:     "STEP_02_SOURCE_BUILD",
    created_at:       "2026-04-04T00:00:00.000Z",
    updated_at:       "2026-04-04T00:00:00.000Z",
    updated_by:       "dry_run",
    notes:            "",
  },
  "PJT-002": {
    project_id:       "PJT-002",
    record_id:        "PJT-002",
    project_status:   "ACTIVE",
    title_jp:         "浦島太郎",
    title_en:         "Urashima Taro",
    source_title:     "浦島太郎（青空文庫）",
    source_url:       "https://www.aozora.gr.jp/cards/001044/files/4779_14901.html",
    target_age:       "6-8",
    full_target_sec:  "360",
    short_target_sec: "180",
    visual_style:     "海をテーマにした幻想的な水彩風、青・緑の色調",
    approval_status:  "PENDING",
    current_step:     "STEP_02_SOURCE_BUILD",
    created_at:       "2026-04-04T00:00:00.000Z",
    updated_at:       "2026-04-04T00:00:00.000Z",
    updated_by:       "dry_run",
    notes:            "",
  },
  "PJT-003": {
    project_id:       "PJT-003",
    record_id:        "PJT-003",
    project_status:   "ACTIVE",
    title_jp:         "金太郎",
    title_en:         "Kintaro",
    source_title:     "金太郎（青空文庫）",
    source_url:       "https://www.aozora.gr.jp/cards/001044/files/4781_14902.html",
    target_age:       "2-3",
    full_target_sec:  "180",
    short_target_sec: "90",
    visual_style:     "明るい原色系、太い線のかわいい絵本風",
    approval_status:  "PENDING",
    current_step:     "STEP_02_SOURCE_BUILD",
    created_at:       "2026-04-04T00:00:00.000Z",
    updated_at:       "2026-04-04T00:00:00.000Z",
    updated_by:       "dry_run",
    notes:            "",
  },
};

// ─── モック: 01_Source 行 レジストリ ──────────────────────────────────────────
const MOCK_SOURCES: Record<string, SourceReadRow> = {
  "PJT-001": {
    project_id:        "PJT-001",
    record_id:         "PJT-001-SRC-001",
    approval_status:   "APPROVED",
    language_style:    "4〜6歳向け。短文・ひらがな中心。オノマトペを積極活用。",
    adaptation_policy:
      "現代語訳でやさしく語り直す。" +
      "「どんぶらこ」などオノマトペを残す。" +
      "暴力描写は最小限にし、協力と勇気のテーマを前面に出す。" +
      "仲間（犬・猿・きじ）それぞれの個性を活かした場面を設ける。" +
      "結末は全員が笑顔で帰るハッピーエンドにする。",
    difficult_terms:   "どんぶらこ、家来、退治、覚悟、宝物、鬼ヶ島",
    credit_text:       "原作: 楠山正雄 編（青空文庫）",
    base_text_notes:   "青空文庫版を底本とする。楠山正雄の編集版。",
  },
  "PJT-002": {
    project_id:        "PJT-002",
    record_id:         "PJT-002-SRC-001",
    approval_status:   "APPROVED",
    language_style:    "6〜8歳向け。やさしい現代語。因果関係・感情変化を含む。",
    adaptation_policy:
      "現代語訳でわかりやすく語り直す。" +
      "竜宮城の豪華で幻想的な描写を活かす。" +
      "玉手箱の結末は老いることの意味をやさしく伝える。" +
      "亀を助けることの優しさ・誠実さをテーマにする。" +
      "子どもが共感できるよう、浦島の不安と喜びの感情変化を丁寧に描く。",
    difficult_terms:   "竜宮城、玉手箱、乙姫、恩返し、老人",
    credit_text:       "原作: 楠山正雄 編（青空文庫）",
    base_text_notes:   "青空文庫版を底本とする。",
  },
  "PJT-003": {
    project_id:        "PJT-003",
    record_id:         "PJT-003-SRC-001",
    approval_status:   "APPROVED",
    language_style:    "2〜3歳向け。極めて短い文。繰り返し表現・リズム重視。",
    adaptation_policy:
      "2〜3歳向けに最大限シンプルに語り直す。" +
      "金太郎の力強さと自然との仲良しを中心に描く。" +
      "動物たちとの交流を繰り返しパターンで表現する。" +
      "難しい言葉は使わず、リズミカルで覚えやすい表現にする。" +
      "毎場面で「大きな声」「力持ち」「なかよし」を印象づける。",
    difficult_terms:   "熊退治、腰に斧、足柄山",
    credit_text:       "原作: 楠山正雄 編（青空文庫）",
    base_text_notes:   "青空文庫版を底本とする。",
  },
};

// ─── CLI / 環境変数パース ─────────────────────────────────────────────────────
function parseArgs(): {
  projectIds: string[];
  dryRun: boolean;
  geminiApiKey: string;
  outputDir: string;
} {
  // CLI 引数で project_id が渡されたら優先
  const cliArgs = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const envIds = (process.env.PROJECT_IDS ?? "").trim();

  let projectIds: string[] = [];
  if (cliArgs.length > 0) {
    projectIds = cliArgs;
  } else if (envIds) {
    projectIds = envIds.split(",").map(s => s.trim()).filter(Boolean);
  } else {
    projectIds = ["PJT-001"]; // デフォルト
  }

  const dryRun = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
  const geminiApiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  const outputDir = (process.env.OUTPUT_DIR ?? "").trim();

  return { projectIds, dryRun, geminiApiKey, outputDir };
}

// ─── scene_max_sec / required_scene_count_base の算出 ─────────────────────────
function computeSceneParams(targetAge: string, fullTargetSec: number): {
  sceneMaxSec: number;
  requiredSceneCountBase: number;
  allowedMin: number;
  allowedMax: number;
} {
  const sceneMaxSec = DEFAULT_SCENE_MAX_SEC[targetAge] ?? DEFAULT_SCENE_MAX_SEC_FALLBACK;
  const requiredSceneCountBase = Math.ceil(fullTargetSec / sceneMaxSec);
  const allowedMin = Math.floor(requiredSceneCountBase * 0.85);
  const allowedMax = Math.ceil(requiredSceneCountBase * 1.15);
  return { sceneMaxSec, requiredSceneCountBase, allowedMin, allowedMax };
}

// ─── 出力ファイル保存 ─────────────────────────────────────────────────────────
function saveOutput(outputDir: string, projectId: string, content: string): void {
  const dir = resolve(REPO_ROOT, outputDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `step03_${projectId}_${ts}.json`;
  const filepath = resolve(dir, filename);
  writeFileSync(filepath, content, "utf-8");
  console.log(`  💾 Output saved: ${filepath}`);
}

// ─── 区切り線 ─────────────────────────────────────────────────────────────────
const LINE = "=".repeat(80);
const LINE_THIN = "-".repeat(80);

// ─── メイン ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { projectIds, dryRun, geminiApiKey, outputDir } = parseArgs();

  console.log(LINE);
  console.log(`  STEP_03 テスト実行 — ${dryRun ? "DRY-RUN（プロンプトプレビューのみ）" : "GEMINI 呼び出しあり（GSS 書き込みなし）"}`);
  console.log(LINE);
  console.log(`  対象 project_ids : ${projectIds.join(", ")}`);
  console.log(`  DRY_RUN          : ${dryRun}`);
  if (!dryRun) {
    console.log(`  GEMINI_API_KEY   : ${geminiApiKey ? "***設定済み***" : "⚠️  未設定（GEMINI_API_KEY が必要です）"}`);
    if (outputDir) console.log(`  OUTPUT_DIR       : ${outputDir}`);
  }
  console.log(LINE);

  if (!dryRun && !geminiApiKey) {
    console.error("\n[ERROR] DRY_RUN=false の場合は GEMINI_API_KEY 環境変数が必要です。");
    console.error("  例: GEMINI_API_KEY=your_key DRY_RUN=false PROJECT_IDS=PJT-001 npm run dry-run:step03\n");
    process.exit(1);
  }

  // アセットを一度だけ読み込む
  const assets = loadStep03Assets();

  let totalSuccess = 0;
  let totalFail = 0;

  for (const projectId of projectIds) {
    console.log(`\n${LINE_THIN}`);
    console.log(`  Processing: ${projectId}`);
    console.log(LINE_THIN);

    // モックデータ取得
    const project = MOCK_PROJECTS[projectId];
    const source = MOCK_SOURCES[projectId];

    if (!project) {
      console.error(`  [SKIP] project_id "${projectId}" のモックデータが登録されていません。`);
      console.error(`         登録済み: ${Object.keys(MOCK_PROJECTS).join(", ")}`);
      totalFail++;
      continue;
    }
    if (!source) {
      console.error(`  [SKIP] project_id "${projectId}" のソースモックデータが登録されていません。`);
      totalFail++;
      continue;
    }

    const targetAge = project.target_age ?? "4-6";
    const fullTargetSec = parseInt(project.full_target_sec ?? "480", 10);
    const shortTargetSec = parseInt(project.short_target_sec ?? "240", 10);
    const { sceneMaxSec, requiredSceneCountBase, allowedMin, allowedMax } =
      computeSceneParams(targetAge, fullTargetSec);

    // パラメータ出力
    console.log(`\n  【実行パラメータ】`);
    console.log(`    project_id               : ${projectId}`);
    console.log(`    title_jp                 : ${project.title_jp}`);
    console.log(`    target_age               : ${targetAge}`);
    console.log(`    full_target_sec          : ${fullTargetSec}s`);
    console.log(`    short_target_sec         : ${shortTargetSec}s`);
    console.log(`    visual_style             : ${project.visual_style}`);
    console.log(`    approval_status (source) : ${source.approval_status}`);
    console.log(`\n  【scene 設計パラメータ】`);
    console.log(`    scene_max_sec            : ${sceneMaxSec}s  (target_age="${targetAge}")`);
    console.log(`    required_scene_count_base: ${requiredSceneCountBase}`);
    console.log(`    allowed range            : ${allowedMin} 〜 ${allowedMax} scenes (±15%)`);

    // プロンプトアセンブル
    const prompt = buildStep03Prompt(
      assets, project, source, sceneMaxSec, requiredSceneCountBase
    );
    console.log(`\n  プロンプト文字数: ${prompt.length.toLocaleString()} chars`);

    if (dryRun) {
      // ── dry_run: プロンプト全文表示 ─────────────────────────────────────
      console.log(`\n  ${LINE}`);
      console.log(`  ASSEMBLED PROMPT — ${projectId}`);
      console.log(`  ${LINE}`);
      console.log();
      console.log(prompt);
      console.log();
      console.log(`  [DRY_RUN] Gemini 呼び出しスキップ。GSS 書き込みなし。`);
      totalSuccess++;

    } else {
      // ── Gemini 呼び出し ──────────────────────────────────────────────────
      console.log(`\n  Gemini を呼び出しています... (${projectId})`);

      const geminiOptions: GeminiCallOptions = {
        apiKey:         geminiApiKey,
        primaryModel:   "gemini-2.5-pro",
        secondaryModel: "gemini-2.0-pro",
        tertiaryModel:  "gemini-2.0-flash",
      };

      let geminiText: string;
      let modelUsed: string;
      let usedFallback: boolean;

      try {
        const result = await callGemini(prompt, geminiOptions);
        geminiText   = result.text;
        modelUsed    = result.modelUsed;
        usedFallback = result.usedFallback;
      } catch (err) {
        console.error(`  [ERROR] Gemini 呼び出し失敗 (${projectId}): ${err instanceof Error ? err.message : String(err)}`);
        totalFail++;
        continue;
      }

      console.log(`  Gemini 応答受信 (${projectId})`);
      console.log(`    modelUsed   : ${modelUsed}`);
      console.log(`    usedFallback: ${usedFallback}`);
      console.log(`    responseLen : ${geminiText.length.toLocaleString()} chars`);

      // schema 検証
      const validation = validateSceneAiResponse(geminiText, assets.aiSchema);

      if (!validation.success) {
        console.error(`  [ERROR] Schema validation 失敗 (${projectId}): ${validation.errors}`);
        console.error(`  --- raw response (first 500 chars) ---`);
        console.error(geminiText.slice(0, 500));
        totalFail++;
        continue;
      }

      const aiScenes = validation.scenes;
      const estFullTotal = aiScenes.reduce((s, sc) => s + (sc.est_duration_full ?? 0), 0);
      const estShortTotal = aiScenes.reduce((s, sc) => s + (sc.est_duration_short ?? 0), 0);
      const shortUseCount = aiScenes.filter(sc => sc.short_use === "Y").length;

      console.log(`\n  ✅ schema 検証: OK`);
      console.log(`    scene 数           : ${aiScenes.length} (allowed: ${allowedMin}〜${allowedMax})`);
      console.log(`    est_duration_full  合計: ${estFullTotal}s (目標: ${fullTargetSec}s ±15% = ${Math.floor(fullTargetSec*0.85)}〜${Math.ceil(fullTargetSec*1.15)}s)`);
      console.log(`    est_duration_short 合計: ${estShortTotal}s (目標: ${shortTargetSec}s ±15% = ${Math.floor(shortTargetSec*0.85)}〜${Math.ceil(shortTargetSec*1.15)}s)`);
      console.log(`    short_use=Y        件数: ${shortUseCount} / ${aiScenes.length}`);

      // scene_no / scene_order をシステム側で付与して表示
      // scene_no = GSS の scene_no カラムに書き込む値（SC-001-01 形式）
      console.log(`\n  【scene 一覧 (system-assigned scene_no)】`);
      for (let i = 0; i < aiScenes.length; i++) {
        const sc = aiScenes[i];
        const sceneOrder = i + 1;
        const sceneNo = generateSceneId(projectId, sceneOrder);
        console.log(
          `    ${sceneNo}  [${sc.short_use === "Y" ? "S✓" : "S✗"}/${sc.full_use === "Y" ? "F✓" : "F✗"}]` +
          `  short=${String(sc.est_duration_short).padStart(3)}s  full=${String(sc.est_duration_full).padStart(3)}s` +
          `  ${sc.chapter} / ${sc.scene_title}`
        );
      }

      // JSON 出力（オプション）
      const outputPayload = {
        meta: {
          project_id:               projectId,
          title_jp:                 project.title_jp,
          target_age:               targetAge,
          full_target_sec:          fullTargetSec,
          short_target_sec:         shortTargetSec,
          scene_max_sec:            sceneMaxSec,
          required_scene_count_base: requiredSceneCountBase,
          model_used:               modelUsed,
          used_fallback:            usedFallback,
          scene_count:              aiScenes.length,
          est_duration_full_total:  estFullTotal,
          est_duration_short_total: estShortTotal,
          generated_at:             new Date().toISOString(),
        },
        scenes: aiScenes.map((sc, i) => ({
          scene_no:    generateSceneId(projectId, i + 1),  // GSS scene_no カラム用
          scene_order: i + 1,                               // 内部連番
          ...sc,
        })),
      };

      const outputJson = JSON.stringify(outputPayload, null, 2);

      if (outputDir) {
        saveOutput(outputDir, projectId, outputJson);
      } else {
        console.log(`\n  【Gemini 出力 JSON（全文）— ${projectId}】`);
        console.log(outputJson);
      }

      totalSuccess++;
    }
  }

  // ─── 最終サマリー ────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  テスト実行完了`);
  console.log(`  成功: ${totalSuccess} / ${projectIds.length}   失敗: ${totalFail} / ${projectIds.length}`);
  if (!dryRun) {
    console.log(`  ※ Gemini API を呼び出しました。GSS への書き込みはありません。`);
  } else {
    console.log(`  ※ Gemini 呼び出しなし。GSS への書き込みなし。`);
  }
  console.log(LINE);

  if (totalFail > 0) process.exit(1);
}

main().catch(err => {
  console.error("[FATAL]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

/**
 * src/scripts/gemini-run-step03.ts
 *
 * STEP_03 LLM 実行テスト（GSS 書き込みなし）
 *
 * 【概要】
 * LLM 呼び出し → schema 検証 → scene_id 付与 までのパイプライン全体を検証する。
 * GSS への書き込みは行わない。
 *
 * 【実行モード】
 *   DRY_RUN=true  (デフォルト) : プロンプトアセンブルのみ表示
 *   DRY_RUN=false              : LLM を呼び出してパイプラインを全検証
 *   USE_MOCK=true              : LLM の代わりに事前定義モック応答を使用（API key 不要）
 *
 * 【環境変数】
 *   PROJECT_IDS     : カンマ区切りの project_id (例: "PJT-001,PJT-002")
 *   DRY_RUN         : "false" で LLM を呼び出す（デフォルト: "true"）
 *   USE_MOCK        : "true" でモック応答を使用（DRY_RUN=false 時のみ有効）
 *   OPENAI_API_KEY  : LLM API Key（USE_MOCK=false かつ DRY_RUN=false のとき必須）
 *   OPENAI_BASE_URL : LLM Base URL
 *   OUTPUT_DIR      : 結果 JSON を保存するディレクトリ（省略可）
 *
 * 【CLI 引数（環境変数より優先）】
 *   node dist/scripts/gemini-run-step03.js PJT-001
 *   node dist/scripts/gemini-run-step03.js PJT-001 PJT-002
 *
 * 【npm script 経由】
 *   npm run gemini-run:step03                          # PJT-001, mock LLM
 *   npm run gemini-run:step03:multi                    # PJT-001+PJT-002, mock LLM
 *   DRY_RUN=false USE_MOCK=false npm run gemini-run:step03  # real API
 *
 * 【モック登録済み project_id】
 *   PJT-001 : 桃太郎        (target_age=4-6, full=480s, short=240s)
 *   PJT-002 : 浦島太郎      (target_age=6-8, full=360s, short=180s)
 *   PJT-003 : 金太郎        (target_age=2-3, full=180s, short=90s)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadStep03Assets } from "../lib/load-assets.js";
import { buildStep03Prompt } from "../lib/build-prompt.js";
import { validateSceneAiResponse } from "../lib/validate-json.js";
import { generateSceneId } from "../lib/write-scenes.js";
import type { ProjectRow, SourceReadRow } from "../types.js";

// ─── パス解決 ─────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
    updated_by:       "gemini_run",
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
    updated_by:       "gemini_run",
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
    updated_by:       "gemini_run",
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

// ─── モック LLM 応答 (schema 準拠の事前定義 JSON 文字列) ──────────────────────
// PJT-001 用: examples/scene_build_ai_response_example_v1.json の内容を流用
function getMockLlmResponse(projectId: string): string {
  if (projectId === "PJT-001") {
    // 事前定義 example JSON を直接文字列として返す（schema 準拠検証済み）
    const examplePath = resolve(REPO_ROOT, "examples", "scene_build_ai_response_example_v1.json");
    try {
      return readFileSync(examplePath, "utf-8");
    } catch {
      // フォールバック: インライン定義
      return JSON.stringify({
        scenes: [
          {
            chapter: "導入", scene_title: "大きな桃が川から流れてくる",
            scene_summary: "おばあさんが川で洗濯していると大きな桃がどんぶらこと流れてくる。",
            scene_goal: "物語の導入をつくる。", visual_focus: "川を流れる大きな桃",
            emotion: "ふしぎ、わくわく", short_use: "Y", full_use: "Y",
            est_duration_short: 18, est_duration_full: 35,
            difficult_words: "どんぶらこ", easy_rewrite: "ぷかぷか流れてくる",
            qa_seed: "おばあさんは何を見つけたの？", continuity_note: "桃の大きさを次sceneへ引き継ぐ。"
          },
          {
            chapter: "動機形成", scene_title: "鬼退治を決意する",
            scene_summary: "桃太郎は鬼に困る村人たちを助けるため旅立ちを決意する。",
            scene_goal: "主人公の目的を明確にする。", visual_focus: "決意する桃太郎の表情",
            emotion: "まじめ、やる気", short_use: "Y", full_use: "Y",
            est_duration_short: 20, est_duration_full: 40,
            difficult_words: "退治", easy_rewrite: "やっつける",
            qa_seed: "桃太郎はなぜ旅に出るの？", continuity_note: "決意の気持ちを旅立ちsceneへつなぐ。"
          },
        ]
      });
    }
  }

  if (projectId === "PJT-002") {
    // 浦島太郎用モック応答 (target_age=6-8, full=360s, scene_max_sec=40s → base=9 scenes)
    return JSON.stringify({
      scenes: [
        {
          chapter: "導入", scene_title: "浦島太郎が亀を助ける",
          scene_summary: "海辺で子どもたちにいじめられている亀を見つけた浦島太郎は、優しく助けてあげる。亀はありがとうと感謝する。",
          scene_goal: "主人公の優しさを示し、物語の発端をつくる。",
          visual_focus: "子どもに囲まれた亀と助ける浦島太郎",
          emotion: "優しさ、思いやり",
          short_use: "Y", full_use: "Y",
          est_duration_short: 25, est_duration_full: 40,
          difficult_words: "恩返し", easy_rewrite: "お礼をする",
          qa_seed: "浦島太郎は最初に何をしたの？", continuity_note: "亀の感謝の気持ちを次sceneへつなぐ。"
        },
        {
          chapter: "導入", scene_title: "亀が竜宮城へ招待する",
          scene_summary: "助けてもらった亀は、お礼として浦島太郎を竜宮城へ案内すると言う。浦島太郎は半信半疑ながら亀の背中に乗る。",
          scene_goal: "竜宮城への旅立ちを示す転換点をつくる。",
          visual_focus: "亀の背中に乗る浦島太郎、青い海",
          emotion: "ふしぎ、期待",
          short_use: "Y", full_use: "Y",
          est_duration_short: 20, est_duration_full: 35,
          difficult_words: "竜宮城", easy_rewrite: "海の中のお城",
          qa_seed: "亀はなぜ浦島太郎を招待したの？", continuity_note: "海中への移動を次sceneへつなぐ。"
        },
        {
          chapter: "竜宮城", scene_title: "竜宮城に到着する",
          scene_summary: "海の底の竜宮城はとても美しく、色とりどりの魚たちが泳いでいる。乙姫様が笑顔で出迎えてくれる。",
          scene_goal: "幻想的な竜宮城の世界観を印象づける。",
          visual_focus: "美しい竜宮城と乙姫様",
          emotion: "おどろき、よろこび",
          short_use: "Y", full_use: "Y",
          est_duration_short: 25, est_duration_full: 40,
          difficult_words: "乙姫", easy_rewrite: "お姫様",
          qa_seed: "竜宮城はどんなところ？", continuity_note: "竜宮城の外観を以降のsceneで統一する。"
        },
        {
          chapter: "竜宮城", scene_title: "楽しいごちそうとお祝い",
          scene_summary: "浦島太郎は竜宮城でたくさんのごちそうを食べ、踊りを楽しむ。とても幸せな時間が過ぎていく。",
          scene_goal: "竜宮城での幸せな日々を表現する。",
          visual_focus: "ごちそうと踊る魚たちと笑顔の浦島太郎",
          emotion: "楽しい、幸せ",
          short_use: "N", full_use: "Y",
          est_duration_short: 0, est_duration_full: 35,
          difficult_words: "", easy_rewrite: "",
          qa_seed: "竜宮城で何を楽しんだの？", continuity_note: "幸せな雰囲気を帰郷の寂しさと対比するために残す。"
        },
        {
          chapter: "帰郷", scene_title: "故郷が恋しくなる",
          scene_summary: "楽しい日々が続く中、浦島太郎はふと故郷のおじいさんおばあさんのことを思い出す。会いたい気持ちが強くなる。",
          scene_goal: "帰郷への動機を示す。",
          visual_focus: "窓から海を見つめる浦島太郎の後ろ姿",
          emotion: "郷愁、悲しみ",
          short_use: "Y", full_use: "Y",
          est_duration_short: 20, est_duration_full: 35,
          difficult_words: "", easy_rewrite: "",
          qa_seed: "浦島太郎はなぜ帰ることにしたの？", continuity_note: "別れの場面への感情的な準備をする。"
        },
        {
          chapter: "帰郷", scene_title: "乙姫から玉手箱をもらう",
          scene_summary: "帰ることを告げると乙姫様は悲しむが、玉手箱をお土産に渡してくれる。決して開けてはいけないと言う。",
          scene_goal: "玉手箱という重要な伏線を置く。",
          visual_focus: "玉手箱を受け取る浦島太郎と涙の乙姫",
          emotion: "別れ、不思議",
          short_use: "Y", full_use: "Y",
          est_duration_short: 25, est_duration_full: 40,
          difficult_words: "玉手箱", easy_rewrite: "大切な宝箱",
          qa_seed: "乙姫様は浦島太郎に何を渡したの？", continuity_note: "玉手箱を開けてはいけない約束を次sceneへ引き継ぐ。"
        },
        {
          chapter: "帰郷", scene_title: "知らない故郷に帰り着く",
          scene_summary: "亀に乗って陸に戻ると、浦島太郎の知っていた村はなく、誰も浦島太郎を知らない。実は長い年月が経っていた。",
          scene_goal: "時間の経過という衝撃の事実を提示する。",
          visual_focus: "見知らぬ変わった村と戸惑う浦島太郎",
          emotion: "戸惑い、悲しみ",
          short_use: "Y", full_use: "Y",
          est_duration_short: 25, est_duration_full: 40,
          difficult_words: "老人", easy_rewrite: "おじいさん",
          qa_seed: "浦島太郎が帰ると何が変わっていたの？", continuity_note: "玉手箱を開ける場面への感情的な流れをつくる。"
        },
        {
          chapter: "結末", scene_title: "玉手箱を開けてしまう",
          scene_summary: "悲しみと驚きで混乱した浦島太郎は、ついに玉手箱を開けてしまう。白い煙が出て、浦島太郎はたちまちおじいさんになってしまう。",
          scene_goal: "物語のクライマックスと教訓を示す。",
          visual_focus: "白い煙と老いた浦島太郎",
          emotion: "驚き、後悔",
          short_use: "Y", full_use: "Y",
          est_duration_short: 25, est_duration_full: 40,
          difficult_words: "玉手箱", easy_rewrite: "大切な宝箱",
          qa_seed: "玉手箱を開けたらどうなったの？", continuity_note: "物語の教訓（約束を守ることの大切さ）をエンディングへつなぐ。"
        },
        {
          chapter: "結末", scene_title: "物語の教訓",
          scene_summary: "浦島太郎の物語は、約束を守ることの大切さと、故郷への愛情を教えてくれる。",
          scene_goal: "物語の教訓を優しく伝えて終わらせる。",
          visual_focus: "海と夕日、穏やかな風景",
          emotion: "しみじみ、あたたかい",
          short_use: "Y", full_use: "Y",
          est_duration_short: 20, est_duration_full: 35,
          difficult_words: "", easy_rewrite: "",
          qa_seed: "この物語はどんなことを教えてくれているの？", continuity_note: "エンディングは穏やかな余韻で統一する。"
        }
      ]
    });
  }

  // フォールバック: PJT-001 と同じものを返す
  return getMockLlmResponse("PJT-001");
}

// ─── CLI / 環境変数パース ─────────────────────────────────────────────────────
function parseArgs(): {
  projectIds: string[];
  dryRun: boolean;
  useMock: boolean;
  outputDir: string;
} {
  const cliArgs = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const envIds = (process.env.PROJECT_IDS ?? "").trim();

  let projectIds: string[] = [];
  if (cliArgs.length > 0) {
    projectIds = cliArgs;
  } else if (envIds) {
    projectIds = envIds.split(",").map(s => s.trim()).filter(Boolean);
  } else {
    projectIds = ["PJT-001"];
  }

  const dryRun = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
  const useMock = (process.env.USE_MOCK ?? "true").toLowerCase() !== "false";
  const outputDir = (process.env.OUTPUT_DIR ?? "").trim();

  return { projectIds, dryRun, useMock, outputDir };
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

// ─── OpenAI 互換プロキシ経由 LLM 呼び出し ────────────────────────────────────
async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 環境変数が設定されていません。");
  }

  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "あなたは児童向け動画制作プロジェクトの scene 設計 AI です。" +
          "指示に従い、純粋な JSON のみを返してください。" +
          "コードフェンス、前置き、説明文は一切含めないでください。",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 8192,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "(no body)");
    throw new Error(`LLM API returned HTTP ${response.status}: ${errBody}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("LLM API returned empty content.");
  return text;
}

// ─── 出力ファイル保存 ─────────────────────────────────────────────────────────
function saveOutput(outputDir: string, projectId: string, content: string): void {
  const dir = resolve(REPO_ROOT, outputDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `step03_gemini_run_${projectId}_${ts}.json`;
  const filepath = resolve(dir, filename);
  writeFileSync(filepath, content, "utf-8");
  console.log(`  💾 出力保存: ${filepath}`);
}

// ─── 区切り線 ─────────────────────────────────────────────────────────────────
const LINE = "=".repeat(80);
const LINE_THIN = "-".repeat(80);

// ─── メイン ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { projectIds, dryRun, useMock, outputDir } = parseArgs();

  const modeLabel = dryRun
    ? "DRY-RUN（プロンプトプレビューのみ）"
    : useMock
      ? "MOCK LLM（schema 検証・scene_id 付与を全検証）"
      : "LIVE LLM（OpenAI 互換プロキシ使用）";

  console.log(LINE);
  console.log(`  STEP_03 LLM 実行テスト — ${modeLabel}`);
  console.log(LINE);
  console.log(`  対象 project_ids : ${projectIds.join(", ")}`);
  console.log(`  DRY_RUN          : ${dryRun}`);
  if (!dryRun) {
    console.log(`  USE_MOCK         : ${useMock}`);
    if (!useMock) {
      const apiKey = process.env.OPENAI_API_KEY ?? "";
      const baseUrl = process.env.OPENAI_BASE_URL ?? "(default)";
      console.log(`  LLM API Key      : ${apiKey ? "***設定済み***" : "⚠️  未設定"}`);
      console.log(`  LLM Base URL     : ${baseUrl}`);
    }
    if (outputDir) console.log(`  OUTPUT_DIR       : ${outputDir}`);
  }
  console.log(LINE);

  // アセットを一度だけ読み込む
  const assets = loadStep03Assets();

  let totalSuccess = 0;
  let totalFail = 0;
  const results: Array<{
    projectId: string;
    status: "OK" | "FAIL";
    sceneCount?: number;
    estFullTotal?: number;
    estShortTotal?: number;
    shortUseCount?: number;
    error?: string;
  }> = [];

  for (const projectId of projectIds) {
    console.log(`\n${LINE_THIN}`);
    console.log(`  Processing: ${projectId}`);
    console.log(LINE_THIN);

    const project = MOCK_PROJECTS[projectId];
    const source = MOCK_SOURCES[projectId];

    if (!project) {
      console.error(`  [SKIP] project_id "${projectId}" のモックデータが登録されていません。`);
      console.error(`         登録済み: ${Object.keys(MOCK_PROJECTS).join(", ")}`);
      results.push({ projectId, status: "FAIL", error: "mock not found" });
      totalFail++;
      continue;
    }
    if (!source) {
      console.error(`  [SKIP] project_id "${projectId}" のソースモックがありません。`);
      results.push({ projectId, status: "FAIL", error: "source mock not found" });
      totalFail++;
      continue;
    }

    const targetAge = project.target_age ?? "4-6";
    const fullTargetSec = parseInt(project.full_target_sec ?? "480", 10);
    const shortTargetSec = parseInt(project.short_target_sec ?? "240", 10);
    const { sceneMaxSec, requiredSceneCountBase, allowedMin, allowedMax } =
      computeSceneParams(targetAge, fullTargetSec);

    // パラメータ表示
    console.log(`\n  【実行パラメータ】`);
    console.log(`    project_id               : ${projectId}`);
    console.log(`    title_jp                 : ${project.title_jp}`);
    console.log(`    target_age               : ${targetAge}`);
    console.log(`    full_target_sec          : ${fullTargetSec}s`);
    console.log(`    short_target_sec         : ${shortTargetSec}s`);
    console.log(`    visual_style             : ${project.visual_style}`);
    console.log(`\n  【scene 設計パラメータ】`);
    console.log(`    scene_max_sec            : ${sceneMaxSec}s`);
    console.log(`    required_scene_count_base: ${requiredSceneCountBase}`);
    console.log(`    allowed range            : ${allowedMin} 〜 ${allowedMax} scenes (±15%)`);

    const prompt = buildStep03Prompt(assets, project, source, sceneMaxSec, requiredSceneCountBase);
    console.log(`\n  プロンプト文字数: ${prompt.length.toLocaleString()} chars`);

    if (dryRun) {
      console.log(`\n  ${LINE}`);
      console.log(`  ASSEMBLED PROMPT (先頭1000字) — ${projectId}`);
      console.log(`  ${LINE}`);
      console.log(prompt.slice(0, 1000) + "\n  ...(以下省略)...");
      console.log(`\n  [DRY_RUN] LLM 呼び出しスキップ。GSS 書き込みなし。`);
      results.push({ projectId, status: "OK" });
      totalSuccess++;
      continue;
    }

    // ── LLM テキスト取得 ──────────────────────────────────────────────────────
    let llmText: string;

    if (useMock) {
      // Mock mode: 事前定義応答を使用
      llmText = getMockLlmResponse(projectId);
      console.log(`\n  [MOCK] モック LLM 応答を使用 (${projectId})`);
      console.log(`    mockResponseLen: ${llmText.length.toLocaleString()} chars`);
    } else {
      // Live mode: 実際の LLM API を呼び出す
      console.log(`\n  LLM を呼び出しています... (${projectId})`);
      try {
        llmText = await callLLM(prompt);
        console.log(`  LLM 応答受信 (${projectId})`);
        console.log(`    responseLen: ${llmText.length.toLocaleString()} chars`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [ERROR] LLM 呼び出し失敗 (${projectId}): ${msg}`);
        results.push({ projectId, status: "FAIL", error: msg });
        totalFail++;
        continue;
      }
    }

    // ── Schema 検証 ───────────────────────────────────────────────────────────
    const validation = validateSceneAiResponse(llmText, assets.aiSchema);

    if (!validation.success) {
      console.error(`  [ERROR] Schema validation 失敗 (${projectId}): ${validation.errors}`);
      console.error(`  --- raw response (先頭500字) ---`);
      console.error(llmText.slice(0, 500));
      results.push({ projectId, status: "FAIL", error: `schema: ${validation.errors}` });
      totalFail++;
      continue;
    }

    const aiScenes = validation.scenes;
    const estFullTotal  = aiScenes.reduce((s, sc) => s + (sc.est_duration_full  ?? 0), 0);
    const estShortTotal = aiScenes.reduce((s, sc) => s + (sc.est_duration_short ?? 0), 0);
    const shortUseCount = aiScenes.filter(sc => sc.short_use === "Y").length;

    const fullLow  = Math.floor(fullTargetSec  * 0.85);
    const fullHigh = Math.ceil(fullTargetSec   * 1.15);
    const shortLow  = Math.floor(shortTargetSec * 0.85);
    const shortHigh = Math.ceil(shortTargetSec  * 1.15);

    console.log(`\n  ✅ schema 検証: OK`);
    console.log(`    scene 数                : ${aiScenes.length} (許容: ${allowedMin}〜${allowedMax})  ${aiScenes.length >= allowedMin && aiScenes.length <= allowedMax ? "✅" : "⚠️"}`);
    console.log(`    est_duration_full  合計 : ${estFullTotal}s  (目標: ${fullTargetSec}s ±15% = ${fullLow}〜${fullHigh}s)  ${estFullTotal >= fullLow && estFullTotal <= fullHigh ? "✅" : "⚠️"}`);
    console.log(`    est_duration_short 合計 : ${estShortTotal}s (目標: ${shortTargetSec}s ±15% = ${shortLow}〜${shortHigh}s)  ${estShortTotal >= shortLow && estShortTotal <= shortHigh ? "✅" : "⚠️"}`);
    console.log(`    short_use=Y 件数        : ${shortUseCount} / ${aiScenes.length}`);

    // ── short_use / est_duration_short 整合性チェック ─────────────────────────
    const inconsistencies = aiScenes.filter(
      sc => sc.short_use === "Y" && sc.est_duration_short === 0
    );
    if (inconsistencies.length > 0) {
      console.warn(`  ⚠️  short_use=Y かつ est_duration_short=0 の scene が ${inconsistencies.length} 件:`);
      for (const sc of inconsistencies) {
        console.warn(`       - ${sc.scene_title}`);
      }
    } else {
      console.log(`    short_use / duration 整合 : ✅ 問題なし`);
    }

    // ── difficult_words / easy_rewrite チェック ───────────────────────────────
    let wordsMismatch = 0;
    for (const sc of aiScenes) {
      const dw = sc.difficult_words.split("、").filter(Boolean);
      const er = sc.easy_rewrite.split("、").filter(Boolean);
      if (dw.length > 0 && dw.length !== er.length) {
        wordsMismatch++;
      }
    }
    if (wordsMismatch > 0) {
      console.warn(`  ⚠️  difficult_words と easy_rewrite の件数不一致: ${wordsMismatch} scene`);
    } else {
      console.log(`    difficult_words/easy_rewrite 整合: ✅`);
    }

    // ── est_duration_full が scene_max_sec を超えていないかチェック ─────────────
    const overMaxSec = aiScenes.filter(sc => sc.est_duration_full > sceneMaxSec);
    if (overMaxSec.length > 0) {
      console.warn(`  ⚠️  scene_max_sec(${sceneMaxSec}s) を超える scene: ${overMaxSec.length} 件`);
      for (const sc of overMaxSec) {
        console.warn(`       - ${sc.scene_title}: ${sc.est_duration_full}s`);
      }
    } else {
      console.log(`    scene_max_sec 制約 (≤${sceneMaxSec}s): ✅`);
    }

    // ── scene_id / scene_order 付与後の一覧 ───────────────────────────────────
    console.log(`\n  【scene 一覧 (system-assigned IDs)】`);
    for (let i = 0; i < aiScenes.length; i++) {
      const sc = aiScenes[i];
      const sceneOrder = i + 1;
      const sceneId = generateSceneId(projectId, sceneOrder);
      console.log(
        `    ${sceneId}  [${sc.short_use === "Y" ? "S✓" : "S✗"}/${sc.full_use === "Y" ? "F✓" : "F✗"}]` +
        `  short=${String(sc.est_duration_short).padStart(3)}s  full=${String(sc.est_duration_full).padStart(3)}s` +
        `  ${sc.chapter} / ${sc.scene_title}`
      );
    }

    // ── JSON 出力 ─────────────────────────────────────────────────────────────
    const outputPayload = {
      meta: {
        project_id:                projectId,
        title_jp:                  project.title_jp,
        target_age:                targetAge,
        full_target_sec:           fullTargetSec,
        short_target_sec:          shortTargetSec,
        scene_max_sec:             sceneMaxSec,
        required_scene_count_base: requiredSceneCountBase,
        llm_backend:               useMock ? "mock (pre-built JSON)" : "openai-compatible-proxy (gpt-5)",
        scene_count:               aiScenes.length,
        est_duration_full_total:   estFullTotal,
        est_duration_short_total:  estShortTotal,
        short_use_count:           shortUseCount,
        full_range_ok:             estFullTotal >= fullLow && estFullTotal <= fullHigh,
        short_range_ok:            estShortTotal >= shortLow && estShortTotal <= shortHigh,
        generated_at:              new Date().toISOString(),
      },
      scenes: aiScenes.map((sc, i) => ({
        scene_id:    generateSceneId(projectId, i + 1),
        scene_order: i + 1,
        ...sc,
      })),
    };

    const outputJson = JSON.stringify(outputPayload, null, 2);

    if (outputDir) {
      saveOutput(outputDir, projectId, outputJson);
    } else {
      console.log(`\n  【LLM 出力 JSON（全文）— ${projectId}】`);
      console.log(outputJson);
    }

    results.push({
      projectId,
      status: "OK",
      sceneCount:    aiScenes.length,
      estFullTotal,
      estShortTotal,
      shortUseCount,
    });
    totalSuccess++;
  }

  // ─── 最終サマリー ─────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log(`  STEP_03 LLM テスト実行 — 最終サマリー`);
  console.log(LINE);
  console.log(`  総処理件数 : ${projectIds.length}`);
  console.log(`  成功       : ${totalSuccess}`);
  console.log(`  失敗       : ${totalFail}`);
  console.log();

  for (const r of results) {
    if (r.status === "OK") {
      if (!dryRun && r.sceneCount !== undefined) {
        console.log(
          `  ✅ ${r.projectId}  scenes=${r.sceneCount}  full=${r.estFullTotal}s  short=${r.estShortTotal}s  S-count=${r.shortUseCount}`
        );
      } else {
        console.log(`  ✅ ${r.projectId}  [DRY_RUN]`);
      }
    } else {
      console.log(`  ❌ ${r.projectId}  error: ${r.error}`);
    }
  }

  if (dryRun) {
    console.log(`\n  ※ DRY_RUN=true: LLM 呼び出しなし。GSS 書き込みなし。`);
  } else if (useMock) {
    console.log(`\n  ※ MOCK LLM 使用: 事前定義 JSON で schema 検証・scene_id 付与まで全パイプライン検証済み。`);
    console.log(`  ※ GSS への書き込みはありません。`);
  } else {
    console.log(`\n  ※ LIVE LLM API を呼び出しました。GSS への書き込みはありません。`);
  }
  console.log(LINE);

  if (totalFail > 0) process.exit(1);
}

main().catch(err => {
  console.error("[FATAL]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

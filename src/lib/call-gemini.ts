/**
 * call-gemini.ts
 *
 * Gemini API クライアント。
 * - 94_Runtime_Config から取得した API key / model 名を使用
 * - primary model で失敗した場合のみ secondary model に fallback
 * - タイムアウト / 最小リトライを実装
 *
 * 制約（指示書 §3, §7）:
 * - gemini_api_key: 94_Runtime_Config の "gemini_api_key" から取得
 * - primary model : "step_01_model_role" key の value（フォールバック: "gemini-2.5-pro"）
 * - secondary model: "model_role_text_pro" key の value（フォールバック: "gemini-2.0-pro"）
 *
 * 指示書 §7 のモデル方針:
 *   primary   = gemini-2.5-pro
 *   secondary = gemini-2.0-pro  ← flash ではなく pro
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_PRIMARY_MODEL = "gemini-2.5-pro";
const DEFAULT_SECONDARY_MODEL = "gemini-2.0-pro"; // 指示書 §7 に従い pro を使用
const REQUEST_TIMEOUT_MS = 120_000; // 2 分
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 10_000; // 429 レート制限対策: リトライ前に 10 秒待機

export interface GeminiCallOptions {
  apiKey: string;
  primaryModel: string;
  secondaryModel: string;
}

export interface GeminiResult {
  text: string;
  modelUsed: string;
  usedFallback: boolean;
}

/**
 * Gemini API を呼び出す。
 * primary model 失敗時のみ secondary model に fallback する。
 *
 * @param prompt  - アセンブル済みのプロンプト文字列
 * @param options - API key / model 設定
 * @returns Gemini の応答テキストと使用モデル情報
 */
export async function callGemini(
  prompt: string,
  options: GeminiCallOptions
): Promise<GeminiResult> {
  // Primary model を試みる
  try {
    const text = await callGeminiModel(
      prompt,
      options.primaryModel,
      options.apiKey,
      MAX_RETRIES
    );
    return { text, modelUsed: options.primaryModel, usedFallback: false };
  } catch (primaryError) {
    // Spending Cap は全モデル共通のブロックなのでフォールバック不要
    if (primaryError instanceof GeminiSpendingCapError) {
      console.error(
        `[ERROR] Spending Cap exceeded — skipping fallback. ` +
        `Action required: raise the cap in Google Cloud Console > Billing > Budgets & alerts.`
      );
      throw primaryError;
    }
    console.warn(
      `[WARN] Primary model (${options.primaryModel}) failed. Falling back to secondary (${options.secondaryModel}).`,
      primaryError instanceof Error ? primaryError.message : String(primaryError)
    );
  }

  // Secondary model (fallback) — RPM/RPD 超過時のみここへ到達
  const text = await callGeminiModel(
    prompt,
    options.secondaryModel,
    options.apiKey,
    MAX_RETRIES
  );
  return { text, modelUsed: options.secondaryModel, usedFallback: true };
}

/**
 * 指定モデルで Gemini API を呼び出す。
 * retries 回数だけリトライする（最初の試みを含む）。
 */
async function callGeminiModel(
  prompt: string,
  model: string,
  apiKey: string,
  retries: number
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callGeminiOnce(prompt, model, apiKey);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        // 簡易バックオフ（RETRY_BACKOFF_MS 待機: 429 レート制限対策）
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }

  throw lastError;
}

/**
 * Gemini API を 1 回呼び出す。
 * タイムアウト付き fetch を使用する。
 */
async function callGeminiOnce(
  prompt: string,
  model: string,
  apiKey: string
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  // モデル名をログに出力（Secret マスクを避けるため URL ではなく model 変数を直接出力）
  console.log(`[DEBUG] callGeminiOnce: model="${model}", endpoint="${GEMINI_API_BASE}/${model}:generateContent"`);

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 4096,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "(no body)");

    // Spending Cap 超過を個別に識別して明確なメッセージを出す
    if (
      response.status === 429 &&
      errorBody.includes("spending cap")
    ) {
      throw new GeminiSpendingCapError(
        `Gemini API: Spending Cap exceeded (HTTP 429). ` +
        `Please raise the cap in Google Cloud Console. ` +
        `Raw: ${errorBody}`
      );
    }

    throw new Error(
      `Gemini API returned HTTP ${response.status}: ${errorBody}`
    );
  }

  const json = (await response.json()) as GeminiApiResponse;
  const text = extractTextFromGeminiResponse(json);

  if (!text) {
    throw new Error("Gemini API returned empty text in response.");
  }

  return text;
}

// ─── Custom Errors ────────────────────────────────────────────────────────────

/**
 * Google Cloud プロジェクトの Spending Cap（支出上限）超過エラー。
 * RPM/RPD 制限とは異なり、上限引き上げまで全モデルで発生するため
 * フォールバックを行わず即座に上位へ伝播させる。
 */
export class GeminiSpendingCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiSpendingCapError";
  }
}

// ─── Type / Helpers ───────────────────────────────────────────────────────────

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

function extractTextFromGeminiResponse(json: GeminiApiResponse): string {
  // promptFeedback でブロックされた場合
  if (json.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini response was blocked: ${json.promptFeedback.blockReason}`
    );
  }

  const parts = json.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) return "";

  return parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Model key resolver ───────────────────────────────────────────────────────

import type { RuntimeConfigMap } from "../types.js";
import { getConfigValue } from "./load-runtime-config.js";

/**
 * STEP_01 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 */
export function buildGeminiOptions(configMap: RuntimeConfigMap): GeminiCallOptions {
  const apiKey = getConfigValue(configMap, "gemini_api_key");
  const primaryModel = getConfigValue(
    configMap,
    "step_01_model_role",
    DEFAULT_PRIMARY_MODEL
  );
  const secondaryModel = getConfigValue(
    configMap,
    "model_role_text_pro",
    DEFAULT_SECONDARY_MODEL
  );

  return { apiKey, primaryModel, secondaryModel };
}

/**
 * STEP_02 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 * primary model キー  : step_02_model_role   (デフォルト: gemini-2.5-pro)
 * secondary model キー: model_role_text_flash_seconday (デフォルト: gemini-2.0-flash)
 *   ※ pro 系が RPM 429 になった場合に flash 系へフォールバックする。
 */
export function buildGeminiOptionsStep02(configMap: RuntimeConfigMap): GeminiCallOptions {
  const apiKey = getConfigValue(configMap, "gemini_api_key");
  const primaryModel = getConfigValue(
    configMap,
    "step_02_model_role",
    DEFAULT_PRIMARY_MODEL
  );
  // フォールバックは flash 系（軽量・独立したレート制限枠）
  const secondaryModel = getConfigValue(
    configMap,
    "model_role_text_flash_seconday",
    "gemini-2.0-flash"
  );

  console.info(`[INFO] Gemini options resolved (STEP_02) ***`);
  console.info(`  primaryModel: '${primaryModel}',`);
  console.info(`  secondaryModel: '${secondaryModel}'`);

  return { apiKey, primaryModel, secondaryModel };
}

/**
 * call-gemini.ts
 *
 * Gemini API クライアント（Vertex AI エンドポイント）。
 * - 認証: GOOGLE_SERVICE_ACCOUNT_JSON によるサービスアカウント Bearer トークン
 * - エンドポイント: {LOCATION}-aiplatform.googleapis.com
 * - primary model で失敗した場合のみ secondary / tertiary model に fallback
 * - タイムアウト / 最小リトライを実装
 *
 * 環境変数:
 *   GOOGLE_CLOUD_PROJECT  - GCP プロジェクト ID
 *   GOOGLE_CLOUD_LOCATION - Vertex AI リージョン（デフォルト: asia-northeast1）
 *   GOOGLE_SERVICE_ACCOUNT_JSON - サービスアカウント認証情報 JSON
 */

import { google } from "googleapis";
import type { RuntimeConfigMap } from "../types.js";
import { getConfigValue } from "./load-runtime-config.js";

// ─── Vertex AI 設定 ───────────────────────────────────────────────────────────

const VERTEX_AI_LOCATION = process.env["GOOGLE_CLOUD_LOCATION"] ?? "asia-northeast1";
const VERTEX_AI_PROJECT  = process.env["GOOGLE_CLOUD_PROJECT"]  ?? "";

function buildVertexAiUrl(model: string): string {
  if (!VERTEX_AI_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT environment variable is not set.");
  }
  // "global" location uses the base hostname without location prefix.
  // Regional locations (e.g. us-central1) use "{location}-aiplatform.googleapis.com".
  const host =
    VERTEX_AI_LOCATION === "global"
      ? "aiplatform.googleapis.com"
      : `${VERTEX_AI_LOCATION}-aiplatform.googleapis.com`;
  return (
    `https://${host}/v1` +
    `/projects/${VERTEX_AI_PROJECT}` +
    `/locations/${VERTEX_AI_LOCATION}` +
    `/publishers/google/models/${model}:generateContent`
  );
}

// ─── アクセストークンキャッシュ ───────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * GOOGLE_SERVICE_ACCOUNT_JSON からサービスアカウントの Bearer トークンを取得する。
 * 有効期限の 1 分前までキャッシュを使い回す。
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && now < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.");
  }

  const credentials = JSON.parse(raw) as object;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error("Failed to obtain Vertex AI access token from service account.");
  }

  // アクセストークンの有効期間は通常 1 時間（3600 秒）
  _tokenCache = { token, expiresAt: now + 3_600_000 };
  return token;
}

// ─── 定数 ─────────────────────────────────────────────────────────────────────

const DEFAULT_PRIMARY_MODEL   = "gemini-2.5-pro";
const DEFAULT_SECONDARY_MODEL = "gemini-2.0-pro";
const REQUEST_TIMEOUT_MS      = 120_000; // 2 分
const MAX_RETRIES              = 1;
const RETRY_BACKOFF_MS         = 10_000; // 429 レート制限対策: リトライ前に 10 秒待機

// ─── 公開インターフェース ─────────────────────────────────────────────────────

export interface GeminiCallOptions {
  primaryModel: string;
  secondaryModel: string;
  /** STEP_03 専用: 2nd fallback モデル（省略時は secondaryModel で止まる） */
  tertiaryModel?: string;
  /** 最大出力トークン数。未指定時は callGeminiOnce のデフォルト (16384) を使用。 */
  maxOutputTokens?: number;
}

export interface GeminiResult {
  text: string;
  modelUsed: string;
  usedFallback: boolean;
}

/**
 * Gemini API（Vertex AI）を呼び出す。
 * primary model 失敗時のみ secondary / tertiary model に fallback する。
 */
export async function callGemini(
  prompt: string,
  options: GeminiCallOptions
): Promise<GeminiResult> {
  const maxOutputTokens = options.maxOutputTokens ?? 16384;

  // Primary model を試みる
  try {
    const text = await callGeminiModel(
      prompt,
      options.primaryModel,
      MAX_RETRIES,
      maxOutputTokens
    );
    return { text, modelUsed: options.primaryModel, usedFallback: false };
  } catch (primaryError) {
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

  // Secondary model (1st fallback)
  try {
    const text = await callGeminiModel(
      prompt,
      options.secondaryModel,
      MAX_RETRIES,
      maxOutputTokens
    );
    return { text, modelUsed: options.secondaryModel, usedFallback: true };
  } catch (secondaryError) {
    if (secondaryError instanceof GeminiSpendingCapError) {
      throw secondaryError;
    }
    if (!options.tertiaryModel) {
      throw secondaryError;
    }
    console.warn(
      `[WARN] Secondary model (${options.secondaryModel}) failed. Falling back to tertiary (${options.tertiaryModel}).`,
      secondaryError instanceof Error ? secondaryError.message : String(secondaryError)
    );
  }

  // Tertiary model (2nd fallback) — STEP_03 専用
  const text = await callGeminiModel(
    prompt,
    options.tertiaryModel!,
    MAX_RETRIES,
    maxOutputTokens
  );
  return { text, modelUsed: options.tertiaryModel!, usedFallback: true };
}

/**
 * 指定モデルで Gemini API を呼び出す。retries 回数だけリトライする。
 */
async function callGeminiModel(
  prompt: string,
  model: string,
  retries: number,
  maxOutputTokens = 16384
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callGeminiOnce(prompt, model, maxOutputTokens);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }

  throw lastError;
}

/**
 * Gemini API（Vertex AI）を 1 回呼び出す。タイムアウト付き fetch を使用する。
 */
async function callGeminiOnce(
  prompt: string,
  model: string,
  maxOutputTokens = 16384
): Promise<string> {
  const url = buildVertexAiUrl(model);
  const token = await getAccessToken();

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens,
      response_mime_type: "application/json",
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "(no body)");

    if (response.status === 429 && errorBody.includes("spending cap")) {
      throw new GeminiSpendingCapError(
        `Gemini API: Spending Cap exceeded (HTTP 429). ` +
        `Please raise the cap in Google Cloud Console. ` +
        `Raw: ${errorBody}`
      );
    }

    throw new Error(
      `Gemini API (Vertex AI) returned HTTP ${response.status}: ${errorBody}`
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

/**
 * STEP_01 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 */
export function buildGeminiOptions(configMap: RuntimeConfigMap): GeminiCallOptions {
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

  return { primaryModel, secondaryModel };
}

/**
 * STEP_02 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 */
export function buildGeminiOptionsStep02(configMap: RuntimeConfigMap): GeminiCallOptions {
  const primaryModel = getConfigValue(
    configMap,
    "step_02_model_role",
    DEFAULT_PRIMARY_MODEL
  );
  const secondaryModel = getConfigValue(
    configMap,
    "model_role_text_flash_seconday",
    "gemini-2.0-flash"
  );

  console.info(`[INFO] Gemini options resolved (STEP_02) ***`);
  console.info(`  primaryModel: '${primaryModel}',`);
  console.info(`  secondaryModel: '${secondaryModel}'`);

  return { primaryModel, secondaryModel };
}

/**
 * STEP_03 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 *
 * fallback 構成（仕様書 §8 準拠）:
 *   primary      : step_03_model_role
 *   1st fallback : model_role_text_pro
 *   2nd fallback : model_role_text_flash_seconday
 */
export function buildGeminiOptionsStep03(configMap: RuntimeConfigMap): GeminiCallOptions {
  const primaryModel = getConfigValue(
    configMap,
    "step_03_model_role",
    DEFAULT_PRIMARY_MODEL
  );
  const secondaryModel = getConfigValue(
    configMap,
    "model_role_text_pro",
    "gemini-3.1-pro-preview"
  );
  const tertiaryModel = getConfigValue(
    configMap,
    "model_role_text_flash_seconday",
    "gemini-2.0-flash"
  );

  console.info(`[INFO] Gemini options resolved (STEP_03)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);
  console.info(`  tertiaryModel:  '${tertiaryModel}' (2nd fallback)`);

  return { primaryModel, secondaryModel, tertiaryModel };
}

/**
 * STEP_05 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 *
 * Full Script は全 scene を 1 呼び出しで一括生成するため、
 * maxOutputTokens は STEP_03 の 2 倍（32768）に設定する。
 */
export function buildGeminiOptionsStep05(configMap: RuntimeConfigMap): GeminiCallOptions {
  const primaryModel = getConfigValue(
    configMap,
    "step_05_model_role",
    DEFAULT_PRIMARY_MODEL
  );
  const secondaryModel = getConfigValue(
    configMap,
    "model_role_text_pro",
    "gemini-2.0-pro"
  );
  const tertiaryModel = getConfigValue(
    configMap,
    "model_role_text_flash_seconday",
    "gemini-2.0-flash"
  );

  console.info(`[INFO] Gemini options resolved (STEP_05)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);
  console.info(`  tertiaryModel:  '${tertiaryModel}' (2nd fallback)`);

  return { primaryModel, secondaryModel, tertiaryModel };
}

/**
 * STEP_04 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 */
export function buildGeminiOptionsStep04(configMap: RuntimeConfigMap): GeminiCallOptions {
  const primaryModel = getConfigValue(
    configMap,
    "step_04_model_role",
    DEFAULT_PRIMARY_MODEL
  );
  const secondaryModel = getConfigValue(
    configMap,
    "model_role_text_pro",
    "gemini-2.0-pro"
  );
  const tertiaryModel = getConfigValue(
    configMap,
    "model_role_text_flash_seconday",
    "gemini-2.0-flash"
  );

  console.info(`[INFO] Gemini options resolved (STEP_04)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);
  console.info(`  tertiaryModel:  '${tertiaryModel}' (2nd fallback)`);

  return { primaryModel, secondaryModel, tertiaryModel };
}

/**
 * STEP_06 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 */
export function buildGeminiOptionsStep06(configMap: RuntimeConfigMap): GeminiCallOptions {
  const fallbackPrimary = getConfigValue(configMap, "model_role_text_pro", DEFAULT_PRIMARY_MODEL);
  const primaryModel = getConfigValue(configMap, "step_06_model_role", fallbackPrimary);
  const secondaryModel = getConfigValue(configMap, "model_role_text_pro", "gemini-2.0-pro");

  console.info(`[INFO] Gemini options resolved (STEP_06)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);

  return { primaryModel, secondaryModel };
}

/**
 * STEP_07 用: RuntimeConfigMap から Gemini テキスト生成オプションを組み立てる。
 *
 * Image Prompts のプロンプトパーツ生成（テキスト）に使用する。
 * 画像生成自体は generateImageStep07() で別途呼び出す。
 */
export function buildGeminiOptionsStep07(configMap: RuntimeConfigMap): GeminiCallOptions {
  const fallbackPrimary = getConfigValue(configMap, "model_role_text_pro", DEFAULT_PRIMARY_MODEL);
  const primaryModel = getConfigValue(configMap, "step_07_model_role", fallbackPrimary);
  const secondaryModel = getConfigValue(configMap, "model_role_text_pro", "gemini-2.0-pro");

  console.info(`[INFO] Gemini options resolved (STEP_07 text)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);

  return { primaryModel, secondaryModel };
}

// ─── Image Generation ─────────────────────────────────────────────────────────

const DEFAULT_IMAGE_PRIMARY_MODEL   = "gemini-3.1-flash-image";
const DEFAULT_IMAGE_SECONDARY_MODEL = "gemini-2.5-flash-image";
const IMAGE_GEN_TIMEOUT_MS = 120_000; // 2 分

/**
 * Build Gemini image generation model options from RuntimeConfigMap.
 * Primary  : step_07_image_model_role (fallback: DEFAULT_IMAGE_PRIMARY_MODEL)
 * Secondary: model_role_picture_seconday (fallback: DEFAULT_IMAGE_SECONDARY_MODEL)
 */
export function buildImageGenOptions(configMap: RuntimeConfigMap): { primaryModel: string; secondaryModel: string } {
  const primaryModel   = getConfigValue(configMap, "step_07_image_model_role",   DEFAULT_IMAGE_PRIMARY_MODEL);
  const secondaryModel = getConfigValue(configMap, "model_role_picture_seconday", DEFAULT_IMAGE_SECONDARY_MODEL);

  console.info(`[INFO] Image generation options resolved (STEP_07)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);

  return { primaryModel, secondaryModel };
}

/**
 * Call the Vertex AI image generation endpoint for a single model.
 * Returns PNG Buffer on success, throws on failure.
 */
async function callImageGenOnce(
  model: string,
  promptText: string,
): Promise<Buffer> {
  const url = buildVertexAiUrl(model);
  const token = await getAccessToken();

  const requestBody = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "(no body)");
    if (response.status === 429 && errorBody.includes("spending cap")) {
      throw new GeminiSpendingCapError(
        `Gemini Image API: Spending Cap exceeded (HTTP 429). Raw: ${errorBody}`
      );
    }
    throw new Error(
      `Gemini Image API (Vertex AI) returned HTTP ${response.status}: ${errorBody}`
    );
  }

  const json = (await response.json()) as GeminiApiResponse;
  const parts = json.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error("Gemini Image API returned no parts in response.");
  }

  for (const part of parts) {
    const inlineData = (part as Record<string, unknown>)["inlineData"] as
      | { mimeType: string; data: string }
      | undefined;
    if (inlineData?.data) {
      return Buffer.from(inlineData.data, "base64");
    }
  }

  throw new Error("Gemini Image API returned no inlineData (image) in response.");
}

/**
 * Gemini Image Generation API（Vertex AI）を呼び出し PNG バッファを返す。
 * primary model 失敗時は secondary model に fallback する。
 *
 * @param promptFull     - 画像生成プロンプト（prompt_full）
 * @param negativePrompt - 禁止要素（negative_prompt）
 * @param primaryModel   - 使用する primary モデル名
 * @param secondaryModel - fallback モデル名
 * @returns PNG バイナリ Buffer
 */
export async function generateImageStep07(
  promptFull: string,
  negativePrompt: string,
  primaryModel: string,
  secondaryModel: string,
): Promise<Buffer> {
  const fullPromptText = negativePrompt
    ? `${promptFull}\nAvoid: ${negativePrompt}`
    : promptFull;

  // Try primary model
  try {
    return await callImageGenOnce(primaryModel, fullPromptText);
  } catch (primaryErr) {
    if (primaryErr instanceof GeminiSpendingCapError) throw primaryErr;
    console.warn(
      `[WARN] Primary image model (${primaryModel}) failed. Falling back to secondary (${secondaryModel}).`,
      primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
    );
  }

  // Fallback to secondary model
  return await callImageGenOnce(secondaryModel, fullPromptText);
}

/**
 * STEP_09 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 *
 * ※ 94_Runtime_Config のキー名は "model_role_text_flash_seconday"（typo のまま使用）
 */
/**
 * STEP_08A 用: RuntimeConfigMap から Gemini 呼び出し用オプションを組み立てる。
 */
export function buildGeminiOptionsStep08a(configMap: RuntimeConfigMap): GeminiCallOptions {
  const fallbackPrimary = getConfigValue(configMap, "model_role_text_pro", DEFAULT_PRIMARY_MODEL);
  const primaryModel    = getConfigValue(configMap, "step_08a_model_role", fallbackPrimary);
  const secondaryModel  = getConfigValue(configMap, "model_role_text_pro", "gemini-2.0-pro");

  console.info(`[INFO] Gemini options resolved (STEP_08A)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);

  return { primaryModel, secondaryModel };
}

export function buildGeminiOptionsStep09(configMap: RuntimeConfigMap): GeminiCallOptions {
  const fallbackPrimary = getConfigValue(configMap, "model_role_text_flash_seconday", "gemini-2.5-flash");
  const primaryModel = getConfigValue(configMap, "step_09_model_role", fallbackPrimary);
  const secondaryModel = getConfigValue(configMap, "model_role_text_flash_seconday", "gemini-2.5-flash");

  console.info(`[INFO] Gemini options resolved (STEP_09)`);
  console.info(`  primaryModel:   '${primaryModel}'`);
  console.info(`  secondaryModel: '${secondaryModel}' (1st fallback)`);

  return { primaryModel, secondaryModel };
}

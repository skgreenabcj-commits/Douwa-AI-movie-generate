/**
 * generate-tts-audio.ts
 *
 * Google Cloud Text-to-Speech API（REST）を呼び出し MP3 バッファを返す。
 *
 * 仕様書 §8 準拠:
 * - narrator: ja-JP-Neural2-B（女性・固定）
 * - languageCode: ja-JP
 * - audioEncoding: MP3
 * - input: ssml（tts_text は Gemini 生成 SSML 文字列）
 * - speakingRate: RuntimeConfig から取得（slow=0.75 / normal=0.82 / fast=0.92）
 * - pitch: 0.0（デフォルト）
 * - MP3 duration 推定: (bytes * 8) / (64 * 1000) 秒（CBR 64kbps）
 *
 * 認証: GOOGLE_SERVICE_ACCOUNT_JSON（Gemini と同一サービスアカウント）
 */

import { google } from "googleapis";
import type { RuntimeConfigMap } from "../types.js";
import { getConfigValue } from "./load-runtime-config.js";

// ─── 定数 ─────────────────────────────────────────────────────────────────────

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const VOICE_NAME  = "ja-JP-Neural2-B";   // 女性ナレーター固定
const TTS_REQUEST_TIMEOUT_MS = 60_000;   // 1 分

// speakingRate のデフォルト値（RuntimeConfig になければこちらを使用）
const DEFAULT_SPEAKING_RATE: Record<string, number> = {
  slow:   0.75,
  normal: 0.82,
  fast:   0.92,
};

// ─── アクセストークンキャッシュ ───────────────────────────────────────────────

let _ttsTokenCache: { token: string; expiresAt: number } | null = null;

async function getTtsAccessToken(): Promise<string> {
  const now = Date.now();
  if (_ttsTokenCache && now < _ttsTokenCache.expiresAt - 60_000) {
    return _ttsTokenCache.token;
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
    throw new Error("Failed to obtain TTS access token from service account.");
  }

  _ttsTokenCache = { token, expiresAt: now + 3_600_000 };
  return token;
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/**
 * Google Cloud TTS を呼び出し MP3 Buffer を返す。
 *
 * @param ssmlText    - <speak>〜</speak> 形式の SSML 文字列
 * @param speechRate  - "slow" | "normal" | "fast"
 * @param configMap   - RuntimeConfigMap（speakingRate のカスタム値参照）
 * @returns MP3 バイナリ Buffer
 */
export async function generateTtsAudio(
  ssmlText: string,
  speechRate: string,
  configMap: RuntimeConfigMap
): Promise<Buffer> {
  const speakingRate = resolveSpeakingRate(speechRate, configMap);
  const token = await getTtsAccessToken();

  const requestBody = {
    input: { ssml: ssmlText },
    voice: {
      languageCode: "ja-JP",
      name: VOICE_NAME,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate,
      pitch: 0.0,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(TTS_API_URL, {
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
    throw new Error(
      `Google Cloud TTS API returned HTTP ${response.status}: ${errorBody}`
    );
  }

  const json = (await response.json()) as { audioContent?: string };
  const audioContent = json.audioContent;
  if (!audioContent) {
    throw new Error("Google Cloud TTS API returned no audioContent in response.");
  }

  return Buffer.from(audioContent, "base64");
}

/**
 * MP3 バッファから再生時間（秒）を推定する（CBR 64kbps）。
 * (bytes * 8) / (64 * 1000)
 */
export function estimateMp3DurationSec(mp3Buffer: Buffer): number {
  return parseFloat(((mp3Buffer.byteLength * 8) / (64 * 1000)).toFixed(3));
}

/**
 * 再生時間（秒）を "M:SS.mmm" 形式のタイムコード文字列に変換する。
 * 例: 4.5 → "0:04.500"
 */
export function formatTcOut(durationSec: number): string {
  const totalMs = Math.round(durationSec * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms      = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * speech_rate 文字列から実際の speakingRate 数値を解決する。
 * RuntimeConfig のキー `tts_speaking_rate_{slow|normal|fast}` を優先参照する。
 */
function resolveSpeakingRate(speechRate: string, configMap: RuntimeConfigMap): number {
  const rate = speechRate.trim().toLowerCase();
  const configKey = `tts_speaking_rate_${rate}`;
  const configVal = getConfigValue(configMap, configKey, "");

  if (configVal) {
    const parsed = parseFloat(configVal);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  return DEFAULT_SPEAKING_RATE[rate] ?? DEFAULT_SPEAKING_RATE["normal"]!;
}

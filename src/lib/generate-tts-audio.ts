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
/** デフォルト音声モデル。94_Runtime_Config の tts_voice_name キーで上書き可能。 */
const DEFAULT_VOICE_NAME      = "ja-JP-Neural2-B";
/**
 * STEP_09B (QA TTS) 用の設定キー（94_Runtime_Config に手動登録が必要）:
 *   tts_qa_voice_name : ja-JP-Chirp3-HD-Kore  (確定: 2026-05-13)
 *   tts_qa_pitch      : +1st
 * STEP_09B 実装時は getConfigValue(configMap, "tts_qa_voice_name", QA_DEFAULT_VOICE_NAME) で参照する。
 */
const QA_DEFAULT_VOICE_NAME   = "ja-JP-Chirp3-HD-Kore";
const QA_DEFAULT_PITCH        = "+1st";
const TTS_REQUEST_TIMEOUT_MS  = 60_000;   // 1 分

// speakingRate のデフォルト値（RuntimeConfig になければこちらを使用）
const DEFAULT_SPEAKING_RATE: Record<string, number> = {
  slow:   0.75,
  normal: 0.82,
  fast:   0.92,
};

// ─── MP3 フレームヘッダー解析用テーブル ──────────────────────────────────────

/**
 * MPEG version index → sample rates [srIdx=0, 1, 2]
 * mpegVerIdx: 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
 */
const MP3_SAMPLE_RATES: Record<number, [number, number, number]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000,  8000], // MPEG2.5
};

/** Bitrate table for MPEG1 Layer3 (kbps, index 0–15) */
const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
/** Bitrate table for MPEG2/2.5 Layer3 (kbps, index 0–15) */
const BITRATES_MPEG2_L3 = [0,  8, 16, 24, 32, 40, 48, 56,  64,  80,  96, 112, 128, 144, 160, 0];

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
  const voiceName    = getConfigValue(configMap, "tts_voice_name", DEFAULT_VOICE_NAME);
  const token = await getTtsAccessToken();

  const requestBody = {
    input: { ssml: ssmlText },
    voice: {
      languageCode: "ja-JP",
      name: voiceName,
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate,
      // pitch is intentionally omitted: Chirp3-HD does not support audioConfig.pitch
      // (causes HTTP 400 INVALID_ARGUMENT). Neural2 default (0.0) is identical to omitting.
      // Pitch control is handled via SSML <prosody pitch="..."> instead.
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
 * MP3 バッファから正確な再生時間（秒）を取得する。
 *
 * MPEG フレームヘッダーを逐次解析し、各フレームのサンプル数 / サンプルレートを
 * 累積することで算出する。外部ライブラリ不使用。
 *
 * フレームが 1 つも検出できなかった場合のみ CBR 64kbps 推定へフォールバックする。
 */
export function estimateMp3DurationSec(mp3Buffer: Buffer): number {
  const len = mp3Buffer.length;
  let offset = 0;

  // Skip ID3v2 tag if present ("ID3" = 0x49 0x44 0x33)
  if (
    len > 10 &&
    mp3Buffer[0] === 0x49 &&
    mp3Buffer[1] === 0x44 &&
    mp3Buffer[2] === 0x33
  ) {
    // ID3v2 size is encoded as 4 × 7-bit syncsafe integers (big-endian)
    const id3Size =
      ((mp3Buffer[6]! & 0x7f) << 21) |
      ((mp3Buffer[7]! & 0x7f) << 14) |
      ((mp3Buffer[8]! & 0x7f) <<  7) |
       (mp3Buffer[9]! & 0x7f);
    offset = 10 + id3Size;
  }

  let totalFrames = 0;
  let durationSec = 0;

  while (offset + 4 <= len) {
    // Sync word: 0xFF followed by 0xE0 or higher (upper 11 bits all 1)
    if (mp3Buffer[offset] !== 0xff || (mp3Buffer[offset + 1]! & 0xe0) !== 0xe0) {
      offset++;
      continue;
    }

    const b1 = mp3Buffer[offset + 1]!;
    const b2 = mp3Buffer[offset + 2]!;

    const mpegVerIdx = (b1 >> 3) & 0x3; // bits 20-19: 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
    const layerIdx   = (b1 >> 1) & 0x3; // bits 18-17: 3=L1, 2=L2, 1=L3, 0=reserved
    const bitrateIdx = (b2 >> 4) & 0xf; // bits 15-12
    const srIdx      = (b2 >> 2) & 0x3; // bits 11-10
    const padding    = (b2 >> 1) & 0x1; // bit 9

    // Skip reserved/invalid values
    if (
      mpegVerIdx === 1 ||
      layerIdx   === 0 ||
      srIdx      === 3 ||
      bitrateIdx === 0 ||
      bitrateIdx === 15
    ) {
      offset++;
      continue;
    }

    const sampleRates = MP3_SAMPLE_RATES[mpegVerIdx];
    if (!sampleRates) { offset++; continue; }
    const sampleRate = sampleRates[srIdx]!;

    const layer = 4 - layerIdx; // layerIdx 3→L1, 2→L2, 1→L3

    const bitrateTable = mpegVerIdx === 3 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3;
    const bitrateBps   = (bitrateTable[bitrateIdx] ?? 0) * 1000; // kbps → bps
    if (bitrateBps === 0) { offset++; continue; }

    // Frame size in bytes
    let frameLen: number;
    if (layer === 1) {
      frameLen = Math.floor(12 * bitrateBps / sampleRate + padding) * 4;
    } else {
      frameLen = Math.floor(144 * bitrateBps / sampleRate + padding);
    }
    if (frameLen < 4) { offset++; continue; }

    // Samples per frame: L1=384, L2=1152, L3 MPEG1=1152, L3 MPEG2/2.5=576
    const spf =
      layer === 1 ? 384
      : layer === 2 ? 1152
      : mpegVerIdx === 3 ? 1152  // MPEG1 Layer3
      : 576;                      // MPEG2/2.5 Layer3

    durationSec += spf / sampleRate;
    totalFrames++;
    offset += frameLen;
  }

  if (totalFrames === 0) {
    // Fallback: CBR 64kbps size estimate (should not normally reach here)
    return parseFloat(((mp3Buffer.byteLength * 8) / 64_000).toFixed(3));
  }

  return parseFloat(durationSec.toFixed(3));
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

/**
 * src/scripts/voice-sampler.ts
 *
 * Chirp3-HD 音声サンプラー
 *
 * ja-JP Chirp3-HD 女性音声 12種 × 指定テキストで MP3 を一括生成し
 * OUTPUT_DIR に保存する。音声選定・pitch 調整前の試聴用。
 *
 * 【実行方法】
 *   npm run build
 *   OUTPUT_DIR=C:/tmp/voice-samples node dist/scripts/voice-sampler.js
 *
 * 【環境変数】
 *   GOOGLE_SERVICE_ACCOUNT_JSON  : サービスアカウント JSON（必須）
 *   OUTPUT_DIR                   : MP3 保存先ディレクトリ（デフォルト: ./voice-samples）
 *   PITCH_ST                     : prosody pitch セミトーン値（例: "+2st", デフォルト: ""= 指定なし）
 *   VOICES                       : カンマ区切りで絞り込み（例: "Aoede,Kore,Zephyr"）
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { google } from "googleapis";

// ─── 設定 ─────────────────────────────────────────────────────────────────────

/** ja-JP Chirp3-HD 女性音声 12種（可愛らしさ期待順に並べた主観的候補順） */
const FEMALE_VOICES = [
  "Aoede",        // 明るく自然 — 最も広く試される標準候補
  "Kore",         // クリア・ハキハキ — 子ども向け向き
  "Zephyr",       // 軽やか・エネルギッシュ
  "Despina",      // 若め・高め — キャラクター向き
  "Erinome",      // 軽い・エアリー
  "Callirrhoe",   // やわらか・落ち着き
  "Gacrux",       // 温かみ
  "Leda",         // ナチュラル
  "Pulcherrima",  // 豊か・落ち着き
  "Autonoe",      // ナチュラル・中間
  "Sulafat",      // やわらか
  "Achernar",     // クリア
  "Laomedeia",    // おだやか
  "Vindemiatrix", // ナチュラル
] as const;

/** サンプルテキスト — 童話 QA ナレーターとしての声質が出やすい文 */
const SAMPLE_SSML = `<speak><prosody rate="1.0">問題だよ<break time="1500ms"/>桃の中から出てきたのは誰でしょう？おじいさん、桃太郎、犬。</prosody></speak>`;

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const OUTPUT_DIR  = (process.env["OUTPUT_DIR"] ?? "./voice-samples").trim();
const PITCH_ST    = (process.env["PITCH_ST"]   ?? "").trim();  // 例: "+2st"
const VOICES_FILTER = (process.env["VOICES"] ?? "").trim()
  .split(",").map(v => v.trim()).filter(Boolean);

// ─── 認証 ─────────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const raw = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw) as object,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Failed to get access token.");
  return token;
}

// ─── TTS 呼び出し ─────────────────────────────────────────────────────────────

async function synthesize(
  voiceName: string,
  ssml: string,
  token: string,
  pitchSt: string,
): Promise<Buffer> {
  // Chirp3-HD は audioConfig.pitch 非対応 → <prosody pitch> で制御
  const ssmlWithPitch = pitchSt
    ? ssml.replace(
        /<prosody rate="([^"]+)">/,
        `<prosody rate="$1" pitch="${pitchSt}">`,
      )
    : ssml;

  const body = {
    input: { ssml: ssmlWithPitch },
    voice: {
      languageCode: "ja-JP",
      name: `ja-JP-Chirp3-HD-${voiceName}`,
    },
    audioConfig: { audioEncoding: "MP3" },
  };

  const res = await fetch(TTS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "(no body)");
    throw new Error(`TTS API error ${res.status}: ${err}`);
  }

  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error("No audioContent in response.");
  return Buffer.from(json.audioContent, "base64");
}

// ─── メイン ───────────────────────────────────────────────────────────────────

const targets = VOICES_FILTER.length > 0
  ? FEMALE_VOICES.filter(v => VOICES_FILTER.includes(v))
  : FEMALE_VOICES;

console.log("═".repeat(60));
console.log("  Chirp3-HD 音声サンプラー");
console.log("═".repeat(60));
console.log(`  対象音声  : ${targets.length} 種`);
console.log(`  PITCH_ST  : ${PITCH_ST || "(なし)"}`);
console.log(`  OUTPUT_DIR: ${resolve(OUTPUT_DIR)}`);
console.log();

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const token = await getAccessToken();

let ok = 0, ng = 0;
for (const voice of targets) {
  const label = `ja-JP-Chirp3-HD-${voice}`;
  const suffix = PITCH_ST ? `_pitch${PITCH_ST.replace(/[+\s]/g, "").replace("st", "st")}` : "";
  const outFile = resolve(OUTPUT_DIR, `${voice}${suffix}.mp3`);

  try {
    process.stdout.write(`  ${label.padEnd(38)} → `);
    const mp3 = await synthesize(voice, SAMPLE_SSML, token, PITCH_ST);
    writeFileSync(outFile, mp3);
    console.log(`OK  (${mp3.length.toLocaleString()} bytes)`);
    ok++;
  } catch (e) {
    console.log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    ng++;
  }
}

console.log();
console.log("─".repeat(60));
console.log(`  完了: ${ok} 成功 / ${ng} 失敗`);
console.log(`  保存先: ${resolve(OUTPUT_DIR)}`);
console.log("─".repeat(60));

if (ng > 0) process.exit(1);

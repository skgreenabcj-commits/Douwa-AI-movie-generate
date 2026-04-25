/**
 * build-video.ts
 *
 * ffmpeg を使った動画生成ユーティリティ。
 * ffmpeg-static に同梱のバイナリを使用するため、別途インストール不要。
 *
 * 主な責務:
 * 1. buildSceneClip     : 静止画 + 音声 → シーン mp4
 * 2. buildBlackClip     : 指定秒数の黒画面 mp4
 * 3. mergeScenes        : シーン群を wipe_left xfade で結合
 * 4. concatClips        : クリップ群を単純結合（イントロ/アウトロ/ブラック合成用）
 * 5. burnSubtitles      : ASS 字幕を動画に焼き込む
 * 6. generateAssFile    : 字幕テキスト + タイムコードから ASS ファイルを生成
 * 7. probeVideoDuration : ffprobe で動画の尺を取得
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
// ffmpeg-static は ESM でも動作する。パスを文字列として取得。
import type { SceneVideoInput } from "../types.js";
import ffmpegStaticPkg from "ffmpeg-static";

const FFMPEG_PATH = (ffmpegStaticPkg as unknown as string | { default: string });
// ffmpeg-static のエクスポート形式に対応（文字列 or { default: 文字列 }）
function getFfmpegBin(): string {
  if (typeof FFMPEG_PATH === "string") return FFMPEG_PATH;
  if (typeof (FFMPEG_PATH as { default: string }).default === "string") {
    return (FFMPEG_PATH as { default: string }).default;
  }
  throw new Error("ffmpeg-static: could not resolve binary path");
}

// デフォルトの xfade トランジション秒数
export const DEFAULT_XFADE_DURATION = 0.8;
// イントロ後ブラック尺
export const INTRO_BLACK_DURATION = 0.8;
// アウトロ前ブラック尺
export const OUTRO_BLACK_DURATION = 1.0;

// アスペクト比 → 解像度マッピング
const ASPECT_TO_RESOLUTION: Record<string, string> = {
  "16:9": "1920x1080",
  "9:16": "1080x1920",
  "1:1":  "1080x1080",
  "4:3":  "1440x1080",
};
export const DEFAULT_RESOLUTION = "1920x1080";

export function resolveResolution(aspect: string | undefined): string {
  if (!aspect) return DEFAULT_RESOLUTION;
  return ASPECT_TO_RESOLUTION[aspect.trim()] ?? DEFAULT_RESOLUTION;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

// 64 MB — enough for verbose ffmpeg output on long videos
const FFMPEG_MAX_BUFFER = 64 * 1024 * 1024;

function runFfmpeg(args: string[]): void {
  const bin = getFfmpegBin();
  execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: FFMPEG_MAX_BUFFER });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 静止画（PNG）+ 音声（MP3）からシーン mp4 を生成する。
 *
 * @param imagePath  - 入力 PNG ファイルパス
 * @param audioPath  - 入力 MP3 ファイルパス
 * @param outputPath - 出力 MP4 ファイルパス
 * @param durationSec - シーンの尺（秒）
 * @param resolution  - 出力解像度（例: "1920x1080"）
 */
export function buildSceneClip(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  durationSec: number,
  resolution: string
): void {
  const [w, h] = resolution.split("x");
  runFfmpeg([
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-vf",
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    "-t", String(durationSec),
    "-shortest",
    outputPath,
  ]);
}

/**
 * 指定秒数の黒画面 mp4 を生成する（無音）。
 */
export function buildBlackClip(
  outputPath: string,
  durationSec: number,
  resolution: string
): void {
  runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=black:s=${resolution}:r=30`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-t", String(durationSec),
    outputPath,
  ]);
}

/**
 * 複数シーンクリップを wipe_left xfade で結合する。
 *
 * @param clipPaths    - シーン mp4 ファイルパス（scene_no 昇順）
 * @param durations    - 各クリップの尺（秒）
 * @param outputPath   - 出力 MP4 ファイルパス
 * @param xfadeDuration - トランジション秒数
 * @returns 結合後の総尺（秒）
 */
export function mergeScenes(
  clipPaths: string[],
  durations: number[],
  outputPath: string,
  xfadeDuration = DEFAULT_XFADE_DURATION
): number {
  if (clipPaths.length === 0) throw new Error("mergeScenes: no clips provided");
  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], outputPath);
    return durations[0];
  }

  const N = clipPaths.length;

  // xfade filter_complex を組み立てる
  // offset[k] = sum(durations[0..k-1]) - k * xfadeDuration  (k は 0-indexed xfade index)
  let filterComplex = "";
  let cumulativeDur = 0;

  for (let k = 0; k < N - 1; k++) {
    const inV1 = k === 0 ? `[${k}:v]` : `[xfv${k - 1}]`;
    const inV2 = `[${k + 1}:v]`;
    const outV  = k === N - 2 ? "[v]" : `[xfv${k}]`;
    cumulativeDur += durations[k];
    const offset = cumulativeDur - (k + 1) * xfadeDuration;
    filterComplex +=
      `${inV1}${inV2}xfade=transition=wipeleft:duration=${xfadeDuration}:offset=${offset.toFixed(3)}${outV};`;
  }

  // Audio: シンプル concat（シーン間の音声クロスフェードなし）
  const audioInputs = Array.from({ length: N }, (_, i) => `[${i}:a]`).join("");
  filterComplex += `${audioInputs}concat=n=${N}:v=0:a=1[a]`;

  const inputs: string[] = [];
  for (const p of clipPaths) inputs.push("-i", p);

  runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    outputPath,
  ]);

  // 結合後の総尺
  const total = durations.reduce((s, d) => s + d, 0) - (N - 1) * xfadeDuration;
  return total;
}

/**
 * クリップ群を単純な cut で結合する（コーデックコピー）。
 * イントロ / ブラック / merged_scenes / ブラック / アウトロ を繋げる用途。
 *
 * @param clipPaths  - 結合するクリップのパス配列（順番どおりに結合）
 * @param outputPath - 出力 MP4 ファイルパス
 */
export function concatClips(clipPaths: string[], outputPath: string): void {
  if (clipPaths.length === 0) throw new Error("concatClips: no clips provided");

  // concat demuxer 用リストファイルを一時生成
  const listContent = clipPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  const listPath = outputPath + ".concat.txt";
  fs.writeFileSync(listPath, listContent, "utf8");

  try {
    runFfmpeg([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "128k",
      "-pix_fmt", "yuv420p",
      outputPath,
    ]);
  } finally {
    fs.unlinkSync(listPath);
  }
}

/**
 * ASS 字幕を動画に焼き込む。
 *
 * @param inputPath  - 入力 MP4 パス
 * @param assPath    - ASS 字幕ファイルパス
 * @param outputPath - 出力 MP4 パス
 */
export function burnSubtitles(
  inputPath: string,
  assPath: string,
  outputPath: string
): void {
  // Windows パスのバックスラッシュを ffmpeg フィルタ用にエスケープ
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  runFfmpeg([
    "-y",
    "-i", inputPath,
    "-vf", `ass=${escapedAss}`,
    "-c:a", "copy",
    outputPath,
  ]);
}

/**
 * ffprobe で動画の尺（秒）を取得する。
 * ffmpeg-static には ffprobe が含まれていないため、
 * ffmpeg -i で stderr からを durationを読み取るフォールバックを使用。
 */
export function probeVideoDuration(videoPath: string): number {
  const bin = getFfmpegBin();
  try {
    // ffprobe がある場合はそちらを優先
    const ffprobePath = bin.replace("ffmpeg", "ffprobe");
    if (fs.existsSync(ffprobePath)) {
      const out = execFileSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ], { maxBuffer: FFMPEG_MAX_BUFFER }).toString().trim();
      return parseFloat(out) || 0;
    }
  } catch {
    // ffprobe 不可の場合はフォールバック
  }

  // ffmpeg -i でヘッダー情報を読み取る（stderr に出力される）
  try {
    execFileSync(bin, ["-i", videoPath], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: FFMPEG_MAX_BUFFER });
  } catch (err) {
    // ffmpeg -i は exit code 1 を返すが、stderr に情報が含まれる
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    const match = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const s = parseFloat(match[3]);
      return h * 3600 + m * 60 + s;
    }
  }
  return 0;
}

// ─── ASS subtitle generation ──────────────────────────────────────────────────

interface SubtitleEntry {
  text:      string;
  startSec:  number;
  endSec:    number;
}

/**
 * 秒数を ASS タイムコード形式（H:MM:SS.cc）に変換する。
 */
function toAssTime(sec: number): string {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = Math.floor(sec % 60);
  const cs = Math.round((sec % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * ASS ファイルを生成する。
 * スタイル: 画面下部、白文字・グレー枠線、フェードイン 500ms。
 *
 * @param entries    - 字幕エントリの配列（開始/終了秒 + テキスト）
 * @param outputPath - 出力 ASS ファイルパス
 * @param resolution - 動画解像度（例: "1920x1080"）
 */
export function generateAssFile(
  entries:    SubtitleEntry[],
  outputPath: string,
  resolution: string
): void {
  const [w, h] = resolution.split("x").map(Number);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // PrimaryColour=white, OutlineColour=gray, Alignment=2(bottom-center)
    "Style: Default,MS Gothic,60,&H00FFFFFF,&H000000FF,&H00808080,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,20,20,50,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const dialogues = entries.map((e) => {
    // フェードイン 500ms
    const text = `{\\fad(500,0)}${e.text}`;
    return `Dialogue: 0,${toAssTime(e.startSec)},${toAssTime(e.endSec)},Default,,0,0,0,,${text}`;
  });

  const content = header + "\n" + dialogues.join("\n") + "\n";
  // UTF-8 BOM なしで書き込む（Linux/GitHub Actions で問題なし）
  fs.writeFileSync(outputPath, content, "utf8");
}

/**
 * SceneVideoInput 配列からタイムコードを計算して SubtitleEntry[] を構築する。
 *
 * タイムライン（最終動画）:
 *   [intro_dur] [intro_black] [scene0] xfade [scene1] ... [outro_black] [quiz_dur]
 *
 * @param scenes         - SceneVideoInput 配列（scene_no 昇順）
 * @param introOffset    - 字幕開始前のオフセット（intro尺 + INTRO_BLACK_DURATION）
 * @param xfadeDuration  - xfade トランジション秒数
 * @param subtitleDelay  - シーン先頭から字幕を表示するまでの遅延（秒）
 */
export function buildSubtitleEntries(
  scenes:        SceneVideoInput[],
  introOffset:   number,
  xfadeDuration: number,
  subtitleDelay  = 1.0
): SubtitleEntry[] {
  const entries: SubtitleEntry[] = [];
  let cumulativeDur = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene.subtitleText) {
      cumulativeDur += scene.durationSec;
      if (i > 0) cumulativeDur -= xfadeDuration;
      continue;
    }

    // このシーンが merged_scenes タイムライン上で始まる時刻
    // scene 0: merged_start = 0
    // scene k: merged_start = sum(dur[0..k-1]) - (k-1)*xfadeDur  (k >= 1)
    const mergedStart = i === 0 ? 0 : cumulativeDur;
    const finalStart  = introOffset + mergedStart + subtitleDelay;

    // シーンの末尾（次のシーンとの xfade が始まる直前まで）
    const sceneEnd    = mergedStart + scene.durationSec;
    const finalEnd    = introOffset + sceneEnd - (i < scenes.length - 1 ? xfadeDuration + 0.3 : 0.5);

    if (finalEnd > finalStart) {
      entries.push({ text: scene.subtitleText, startSec: finalStart, endSec: finalEnd });
    }

    // 次シーン用の cumulative 更新
    cumulativeDur = sceneEnd;
    if (i < scenes.length - 1) cumulativeDur -= xfadeDuration;
  }

  return entries;
}

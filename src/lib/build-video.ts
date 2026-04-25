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

import { spawn, spawnSync } from "node:child_process";
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

/**
 * ffmpeg を非同期で実行する。
 * spawnSync は長時間プロセスで ENOBUFS を引き起こすため、
 * async spawn + Promise で代替する。stdio は全て ignore。
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = getFfmpegBin();
    const proc = spawn(bin, ["-loglevel", "quiet", ...args], {
      stdio: "ignore",
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed with exit code ${code ?? "?"}`));
      }
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 静止画（PNG）+ 音声（MP3）からシーン mp4 を生成する。
 */
export async function buildSceneClip(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  durationSec: number,
  resolution: string
): Promise<void> {
  const [w, h] = resolution.split("x");
  await runFfmpeg([
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
export async function buildBlackClip(
  outputPath: string,
  durationSec: number,
  resolution: string
): Promise<void> {
  await runFfmpeg([
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
 * @returns 結合後の総尺（秒）
 */
export async function mergeScenes(
  clipPaths: string[],
  durations: number[],
  outputPath: string,
  xfadeDuration = DEFAULT_XFADE_DURATION
): Promise<number> {
  if (clipPaths.length === 0) throw new Error("mergeScenes: no clips provided");
  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], outputPath);
    return durations[0];
  }

  const N = clipPaths.length;

  // xfade filter_complex を組み立てる
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

  // Audio: シンプル concat
  const audioInputs = Array.from({ length: N }, (_, i) => `[${i}:a]`).join("");
  filterComplex += `${audioInputs}concat=n=${N}:v=0:a=1[a]`;

  const inputs: string[] = [];
  for (const p of clipPaths) inputs.push("-i", p);

  await runFfmpeg([
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

  return durations.reduce((s, d) => s + d, 0) - (N - 1) * xfadeDuration;
}

/**
 * クリップ群を単純な cut で結合する（concat demuxer）。
 */
export async function concatClips(clipPaths: string[], outputPath: string): Promise<void> {
  if (clipPaths.length === 0) throw new Error("concatClips: no clips provided");

  const listContent = clipPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
  const listPath = outputPath + ".concat.txt";
  fs.writeFileSync(listPath, listContent, "utf8");

  try {
    await runFfmpeg([
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
 */
export async function burnSubtitles(
  inputPath: string,
  assPath: string,
  outputPath: string
): Promise<void> {
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  await runFfmpeg([
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
 * ffmpeg -i で stderr から duration を読み取るフォールバックを使用。
 * (probeVideoDuration は短時間で完了するため spawnSync を維持)
 */
export function probeVideoDuration(videoPath: string): number {
  const bin = getFfmpegBin();
  try {
    const ffprobePath = bin.replace("ffmpeg", "ffprobe");
    if (fs.existsSync(ffprobePath)) {
      const r = spawnSync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ], { stdio: ["ignore", "pipe", "ignore"] });
      if (!r.error && r.status === 0) {
        return parseFloat(r.stdout?.toString().trim() ?? "0") || 0;
      }
    }
  } catch {
    // ffprobe 不可の場合はフォールバック
  }

  // ffmpeg -i でヘッダー情報を読み取る（stderr に出力される）
  {
    const r = spawnSync(bin, ["-i", videoPath], { stdio: ["ignore", "ignore", "pipe"] });
    const stderr = r.stderr?.toString() ?? "";
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
    "Style: Default,MS Gothic,60,&H00FFFFFF,&H000000FF,&H00808080,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,20,20,50,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const dialogues = entries.map((e) => {
    const text = `{\\fad(500,0)}${e.text}`;
    return `Dialogue: 0,${toAssTime(e.startSec)},${toAssTime(e.endSec)},Default,,0,0,0,,${text}`;
  });

  const content = header + "\n" + dialogues.join("\n") + "\n";
  fs.writeFileSync(outputPath, content, "utf8");
}

/**
 * SceneVideoInput 配列からタイムコードを計算して SubtitleEntry[] を構築する。
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

    const mergedStart = i === 0 ? 0 : cumulativeDur;
    const finalStart  = introOffset + mergedStart + subtitleDelay;
    const sceneEnd    = mergedStart + scene.durationSec;
    const finalEnd    = introOffset + sceneEnd - (i < scenes.length - 1 ? xfadeDuration + 0.3 : 0.5);

    if (finalEnd > finalStart) {
      entries.push({ text: scene.subtitleText, startSec: finalStart, endSec: finalEnd });
    }

    cumulativeDur = sceneEnd;
    if (i < scenes.length - 1) cumulativeDur -= xfadeDuration;
  }

  return entries;
}

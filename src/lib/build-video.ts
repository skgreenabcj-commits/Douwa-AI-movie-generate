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

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
// ffmpeg-static は ESM でも動作する。パスを文字列として取得。
import type { SceneVideoInput } from "../types.js";
import ffmpegStaticPkg from "ffmpeg-static";

const FFMPEG_STATIC_PATH = (ffmpegStaticPkg as unknown as string | { default: string });

// Prefer system ffmpeg (installed via apt-get) over ffmpeg-static bundled binary.
// ffmpeg-static can cause ENOBUFS on Linux CI due to binary compatibility issues.
function getFfmpegBin(): string {
  const systemPaths = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p;
  }
  // Fall back to ffmpeg-static
  if (typeof FFMPEG_STATIC_PATH === "string") return FFMPEG_STATIC_PATH;
  if (typeof (FFMPEG_STATIC_PATH as { default: string }).default === "string") {
    return (FFMPEG_STATIC_PATH as { default: string }).default;
  }
  throw new Error("ffmpeg binary not found (system paths and ffmpeg-static both unavailable)");
}

// デフォルトの xfade トランジション秒数
export const DEFAULT_XFADE_DURATION = 0.8;
// イントロ後ブラック尺
export const INTRO_BLACK_DURATION = 0.8;
// アウトロ前ブラック尺
export const OUTRO_BLACK_DURATION = 1.0;
// シーン間トランジション尺（xfade wipeleft）
export const SCENE_TRANSITION_DURATION = 0.7;

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
    // Use -loglevel error so only actual errors appear in stderr.
    // Pipe stderr to capture error messages; stdout ignored.
    const proc = spawn(bin, ["-loglevel", "error", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed (exit ${code ?? "?"}): ${stderr.trim()}`));
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
  _durationSec: number,  // kept for API compat; clip length is determined by -shortest
  resolution: string
): Promise<void> {
  const [w, h] = resolution.split("x");
  // Do NOT pass -t: let -shortest stop at the end of the audio track.
  // GSS duration_sec may diverge from actual TTS audio length; relying on -t
  // would cut audio short or pad with silence.
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
    "-ar", "44100",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-vf",
    `format=rgb24,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
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
  const tmpDir = path.dirname(outputPath);

  // Pairwise iterative xfade — avoids chained filter_complex PTS drift that
  // causes black frames in ffmpeg 4.x.  Each step merges the current running
  // output with the next clip using a single two-input xfade, then the
  // intermediate temp file is deleted before the next step.
  let currentInput = clipPaths[0];
  let currentDuration = durations[0];
  let prevTemp: string | null = null;

  for (let k = 0; k < N - 1; k++) {
    const isLast = k === N - 2;
    const stepOut = isLast
      ? outputPath
      : path.join(tmpDir, `_xfstep${k}_${path.basename(outputPath)}`);
    // offset = how far into currentInput the transition begins.
    // Subtract 0.1s safety margin: probeVideoDuration may slightly overestimate
    // the actual clip length, causing offset > real duration → black frames.
    const offset = Math.max(0.001, currentDuration - xfadeDuration - 0.1);

    await runFfmpeg([
      "-y",
      "-i", currentInput,
      "-i", clipPaths[k + 1],
      "-filter_complex",
      `[0:v][1:v]xfade=transition=wipeleft:duration=${xfadeDuration.toFixed(3)}:offset=${offset.toFixed(3)}[v];` +
      `[0:a][1:a]acrossfade=d=${xfadeDuration.toFixed(3)}:curve1=tri:curve2=tri[a]`,
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "128k",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      stepOut,
    ]);

    // Remove the previous intermediate file (never the original input clips)
    if (prevTemp) {
      try { fs.unlinkSync(prevTemp); } catch { /* ignore cleanup error */ }
    }
    prevTemp = isLast ? null : stepOut;
    currentInput = stepOut;
    currentDuration = currentDuration + durations[k + 1] - xfadeDuration;
  }

  return currentDuration;
}

/**
 * クリップ群を結合する。
 * filter_complex で各クリップを target resolution にスケール正規化してから concat。
 * concat demuxer は解像度/フレームレート不一致で黒フレームを出すため使用しない。
 *
 * @param clipPaths  - 結合するクリップのパス配列
 * @param outputPath - 出力 MP4 ファイルパス
 * @param resolution - 全クリップを正規化する解像度（例: "1080x1920"）
 */
export async function concatClips(
  clipPaths: string[],
  outputPath: string,
  resolution: string
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("concatClips: no clips provided");

  const [w, h] = resolution.split("x");
  const N = clipPaths.length;
  const inputs: string[] = [];
  for (const p of clipPaths) inputs.push("-i", p);

  // Scale each input to target resolution, then concat
  let filterComplex = "";
  for (let i = 0; i < N; i++) {
    filterComplex += `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[sv${i}];`;
  }
  // Interleave scaled-video and original-audio pairs for concat — ensures
  // video and audio stay in sync across all clips.
  const inputPairs = Array.from({ length: N }, (_, i) => `[sv${i}][${i}:a]`).join("");
  filterComplex += `${inputPairs}concat=n=${N}:v=1:a=1[v][a]`;

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
    "-ar", "44100",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);
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
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

/**
 * ffprobe で動画の尺（秒）を取得する。
 * ffmpeg-static には ffprobe が含まれていないため、
 * ffmpeg -i で stderr から duration を読み取るフォールバックを使用。
 */
export function probeVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const bin = getFfmpegBin();

    // ffmpeg -i はヘッダー読み取り後すぐ終了するため出力量は少ないが、
    // spawnSync は ENOBUFS を引き起こすため async spawn を使用する。
    const proc = spawn(bin, ["-i", videoPath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", () => {
      const match = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
      if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const s = parseFloat(match[3]);
        resolve(h * 3600 + m * 60 + s);
      } else {
        resolve(0);
      }
    });
    proc.on("error", () => resolve(0));
  });
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

// Fixed subtitle font size (px at PlayRes scale)
const SUBTITLE_FONT_SIZE = 60;

/**
 * テキストを指定文字数ごとに分割して行配列を返す。
 * \N に依存せず複数 Dialogue エントリで絶対座標指定する方式のために使用。
 */
function splitSubtitleLines(text: string, charsPerLine: number): string[] {
  if (charsPerLine <= 0 || text.length <= charsPerLine) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > charsPerLine) {
    lines.push(remaining.slice(0, charsPerLine));
    remaining = remaining.slice(charsPerLine);
  }
  if (remaining.length > 0) lines.push(remaining);
  return lines;
}

/**
 * ASS ファイルを生成する。
 *
 * 行折り返しは \N ではなく複数 Dialogue エントリ + \pos() 絶対座標方式を使用する。
 * ffmpeg 4.x の libass は \N をテキスト内ハード改行として正しく処理しない場合があるため。
 */
export function generateAssFile(
  entries:    SubtitleEntry[],
  outputPath: string,
  resolution: string
): void {
  const [w, h] = resolution.split("x").map(Number);
  const marginH = Math.max(50, Math.round(w * 0.06));
  // CJK full-width chars = 1em = SUBTITLE_FONT_SIZE px wide
  const charsPerLine = Math.floor((w - marginH * 2) / SUBTITLE_FONT_SIZE);
  // Vertical spacing between wrapped lines (font size + ~25% leading)
  const lineH = Math.round(SUBTITLE_FONT_SIZE * 1.25);
  // Bottom Y of the lowest subtitle line (bottom-center anchor \an2)
  const bottomY = h - Math.round(h * 0.06);
  const cx = Math.round(w / 2);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",   // no auto-wrap; all wrapping is explicit via multiple Dialogue entries
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Noto Sans CJK JP,${SUBTITLE_FONT_SIZE},&H00FFFFFF,&H000000FF,&H00808080,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  // Each subtitle entry is split into lines; each line becomes its own Dialogue
  // entry with \an2\pos(cx,cy) to anchor it at the correct absolute Y position.
  const dialogues: string[] = [];
  for (const e of entries) {
    const lines = splitSubtitleLines(e.text, charsPerLine);
    const N = lines.length;
    for (let li = 0; li < N; li++) {
      // li=0 is the topmost line, li=N-1 is the bottom line
      const cy = bottomY - (N - 1 - li) * lineH;
      dialogues.push(
        `Dialogue: 0,${toAssTime(e.startSec)},${toAssTime(e.endSec)},Default,,0,0,0,,` +
        `{\\an2\\pos(${cx},${cy})\\fad(500,0)}${lines[li]}`
      );
    }
  }

  const content = header + "\n" + dialogues.join("\n") + "\n";
  fs.writeFileSync(outputPath, content, "utf8");
}

/**
 * SceneVideoInput 配列からタイムコードを計算して SubtitleEntry[] を構築する。
 *
 * シーン間は xfade（wipeleft）を想定。
 * - シーン i は merged 動画内で「前の xfade が終わった時点」から dominant になる。
 * - 字幕は incoming transition 終了後 + subtitleDelay から表示し、
 *   outgoing transition 開始の 0.3s 前に消す。
 *
 * @param scenes          - シーン情報配列
 * @param actualDurations - probeVideoDuration で取得した実秒数（scenes と同インデックス）
 * @param introOffset     - イントロ + イントロ後ブラックの合計秒数
 * @param xfadeDuration   - シーン間 xfade 秒数
 * @param subtitleDelay   - シーンが dominant になってから字幕表示までの遅延秒数
 */
export function buildSubtitleEntries(
  scenes:          SceneVideoInput[],
  actualDurations: number[],
  introOffset:     number,
  xfadeDuration:   number,
  subtitleDelay    = 1.0
): SubtitleEntry[] {
  const entries: SubtitleEntry[] = [];
  const N = scenes.length;

  // Pre-compute when each scene becomes dominant in the merged video.
  // Scene 0: 0 (no incoming transition)
  // Scene i (i > 0): previous dominantStart + prev_dur - xfadeDuration + xfadeDuration
  //   = prevDominantStart + prev_dur
  //   (the xfade occupies the last T sec of scene i-1 and first T sec of scene i,
  //    so scene i becomes dominant exactly at the end of the previous scene)
  // Cumulative:
  //   dominantStart[0] = 0
  //   dominantStart[i] = dominantStart[i-1] + dur[i-1]   (i > 0, i-1 not last)
  //   BUT since the xfade overlaps, the next scene's content in the merged timeline
  //   starts at dominantStart[i-1] + dur[i-1] - xfadeDuration (= xfade offset).
  //   It becomes "fully dominant" T seconds later = dominantStart[i-1] + dur[i-1].
  const dominantStarts: number[] = [0];
  for (let i = 1; i < N; i++) {
    const prev = (actualDurations[i - 1] ?? 0) > 0 ? actualDurations[i - 1] : scenes[i - 1].durationSec;
    dominantStarts.push(dominantStarts[i - 1] + prev);
  }

  for (let i = 0; i < N; i++) {
    const scene = scenes[i];
    if (!scene.subtitleText) continue;

    const dur = (actualDurations[i] ?? 0) > 0 ? actualDurations[i] : scene.durationSec;
    const hasOutgoing = i < N - 1;

    // Show after incoming transition ends; hide before outgoing transition starts
    const finalStart = introOffset + dominantStarts[i] + subtitleDelay;
    const finalEnd   = introOffset + dominantStarts[i] + dur
      - (hasOutgoing ? xfadeDuration + 0.3 : 0.5);

    if (finalEnd > finalStart) {
      entries.push({ text: scene.subtitleText, startSec: finalStart, endSec: finalEnd });
    }
  }

  return entries;
}

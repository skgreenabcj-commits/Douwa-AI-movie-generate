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
// xfade offset safety margin — subtracted from currentDuration when computing
// the xfade start offset to prevent black frames caused by probeVideoDuration
// slightly overestimating actual clip length.  Must be consistent between
// mergeScenes (offset calc + duration accumulation) and buildSubtitleEntries.
export const XFADE_SAFETY = 0.1;

// Codec settings for intermediate clips (re-encoded by burnSubtitles, so quality
// doesn't matter here — use H.264 ultrafast to minimize total encode time).
// Pairwise merging is O(n^2) in encoded video-seconds; H.265 fast would make
// 24-scene Full videos take 40+ minutes in mergeScenes alone.
const INTERMEDIATE_CODEC = "libx264";
const INTERMEDIATE_PRESET = "ultrafast";
const INTERMEDIATE_CRF = "18";

// Final output codec — used only by burnSubtitles (single full-video encode).
const OUTPUT_CODEC = "libx265";
const OUTPUT_PRESET = "fast";
const OUTPUT_CRF = "24";

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
 *
 * 音声の前後に SCENE_TRANSITION_DURATION 秒の無音を追加する。
 * これにより xfade トランジション中（SCENE_TRANSITION_DURATION 秒）は
 * clip0 の末尾無音 + clip1 の先頭無音が再生され、セリフが途切れない。
 * clip 総尺 = T_silence + TTS_dur + T_silence。
 *
 * NOTE: -loop 1 (infinite image) + filter_complex + -shortest は
 * ffmpeg が終端を検知できずハングするため、音声ファイルを probe して
 * -t で総尺を明示指定する。
 */
export async function buildSceneClip(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  durationSec: number,  // fallback when probe fails
  resolution: string
): Promise<void> {
  const [w, h] = resolution.split("x");
  const T = SCENE_TRANSITION_DURATION; // silence padding duration (seconds)
  // Probe actual TTS audio duration; fall back to GSS estimate on failure.
  const ttsDur = await probeVideoDuration(audioPath);
  const clipDur = (ttsDur > 0 ? ttsDur : durationSec) + 2 * T;

  await runFfmpeg([
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-filter_complex",
    // Use 24000 Hz mono null-source pads to match Google TTS native format.
    // All three concat inputs share the same sample rate and channel layout,
    // so ffmpeg performs no implicit resampling — eliminating the boundary
    // "shu" noise caused by SWR transient response at format mismatches.
    `anullsrc=r=24000:cl=mono,atrim=duration=${T}[spre];` +
    `anullsrc=r=24000:cl=mono,atrim=duration=${T}[spost];` +
    `[spre][1:a][spost]concat=n=3:v=0:a=1[aout];` +
    `[0:v]format=rgb24,scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[vout]`,
    "-map", "[vout]",
    "-map", "[aout]",
    "-t", clipDur.toFixed(3),   // explicit duration — avoids -shortest hang with -loop 1
    "-c:v", INTERMEDIATE_CODEC,
    "-preset", INTERMEDIATE_PRESET,
    "-crf", INTERMEDIATE_CRF,
    "-c:a", "aac",
    "-b:a", "32k",
    "-ar", "24000",
    "-ac", "1",
    "-pix_fmt", "yuv420p",
    "-r", "30",
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
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-c:v", INTERMEDIATE_CODEC,
    "-preset", INTERMEDIATE_PRESET,
    "-crf", INTERMEDIATE_CRF,
    "-c:a", "aac",
    "-b:a", "32k",
    "-ac", "1",
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
    // Subtract XFADE_SAFETY: probeVideoDuration may slightly overestimate the
    // actual clip length, causing offset > real duration → black frames.
    const offset = Math.max(0.001, currentDuration - xfadeDuration - XFADE_SAFETY);

    // Audio: simple concat (no crossfade).  Scene clips have silence-padded
    // audio (buildSceneClip), so clip0 is in its trailing silence and clip1 in
    // its leading silence during the xfade window — effectively silent.
    // concat audio total = clip0_dur + clip1_dur (longer than video by T).
    // -shortest trims to video duration, cutting clip1's trailing silence only.
    await runFfmpeg([
      "-y",
      "-i", currentInput,
      "-i", clipPaths[k + 1],
      "-filter_complex",
      `[0:v][1:v]xfade=transition=wipeleft:duration=${xfadeDuration.toFixed(3)}:offset=${offset.toFixed(3)}[v];` +
      `[0:a][1:a]concat=n=2:v=0:a=1[a]`,
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", INTERMEDIATE_CODEC,
      "-preset", INTERMEDIATE_PRESET,
      "-crf", INTERMEDIATE_CRF,
      "-c:a", "aac",
      "-b:a", "32k",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-shortest",
      stepOut,
    ]);

    // Remove the previous intermediate file (never the original input clips)
    if (prevTemp) {
      try { fs.unlinkSync(prevTemp); } catch { /* ignore cleanup error */ }
    }
    prevTemp = isLast ? null : stepOut;
    currentInput = stepOut;
    // Accumulate the actual merged output duration.  The xfade offset uses
    // XFADE_SAFETY so the real output duration is:
    //   offset + d_{k+1} = (currentDuration - T - SAFETY) + d_{k+1}
    // Without subtracting SAFETY here, currentDuration drifts +SAFETY per
    // iteration (e.g. +1.5 s over 15 merges), making later offsets too large.
    currentDuration = currentDuration + durations[k + 1] - xfadeDuration - XFADE_SAFETY;
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

  // Scale each input to target resolution and normalize audio to 24 kHz mono,
  // then concat.  Explicit aresample ensures intro/outro clips (which may be
  // 44.1 kHz stereo) are converted without implicit SWR transient noise.
  let filterComplex = "";
  for (let i = 0; i < N; i++) {
    filterComplex += `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[sv${i}];`;
    filterComplex += `[${i}:a]aresample=24000,aformat=channel_layouts=mono[sa${i}];`;
  }
  // Interleave normalized video/audio pairs for concat.
  const inputPairs = Array.from({ length: N }, (_, i) => `[sv${i}][sa${i}]`).join("");
  filterComplex += `${inputPairs}concat=n=${N}:v=1:a=1[v][a]`;

  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", INTERMEDIATE_CODEC,
    "-preset", INTERMEDIATE_PRESET,
    "-crf", INTERMEDIATE_CRF,
    "-c:a", "aac",
    "-b:a", "32k",
    "-ar", "24000",
    "-ac", "1",
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
    "-c:v", OUTPUT_CODEC,
    "-preset", OUTPUT_PRESET,
    "-crf", OUTPUT_CRF,
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
 * テキストを指定文字数以内の行に分割して返す。
 * 全角スペース・半角スペース・句点・読点・コンマ の直後を優先して折り返す。
 * 自然な折り返し位置が見つからない場合は charsPerLine でハードブレーク。
 * \N に依存せず複数 Dialogue エントリで絶対座標指定する方式のために使用。
 */
function splitSubtitleLines(text: string, charsPerLine: number): string[] {
  if (charsPerLine <= 0 || text.length <= charsPerLine) return [text];
  // Characters after which a line break is acceptable
  const BREAK_AFTER = new Set(["　", " ", "。", "、", ",", "，"]);
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > charsPerLine) {
    // Search backwards from charsPerLine for a natural break character
    let breakPos = -1;
    for (let i = charsPerLine - 1; i >= 0; i--) {
      if (BREAK_AFTER.has(remaining[i])) {
        breakPos = i + 1; // break after this character
        break;
      }
    }
    if (breakPos <= 0) breakPos = charsPerLine; // fallback: hard break
    lines.push(remaining.slice(0, breakPos).trimEnd());
    remaining = remaining.slice(breakPos).trimStart();
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
  const marginH = Math.max(50, Math.round(w * 0.03));
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

  // Pre-compute when each scene becomes dominant in the pairwise-xfade merged video.
  //
  // With offset = mergedDur - T - SAFETY, scene i is fully dominant at:
  //   dominantStart[i] = mergedDur_before_step_i - SAFETY
  // where mergedDur accumulates as:
  //   mergedDur += d_i - T - SAFETY   (each pairwise merge step)
  //
  // Using sum(actualDurations[0..i-1]) as dominantStart[i] ignores SAFETY and
  // drifts by i × 0.8 s — scene 15 would be ~11 s late.
  const dominantStarts: number[] = [0];
  let mergedDur = (actualDurations[0] ?? 0) > 0 ? actualDurations[0] : scenes[0].durationSec;
  for (let i = 1; i < N; i++) {
    dominantStarts.push(mergedDur - XFADE_SAFETY);
    const d = (actualDurations[i] ?? 0) > 0 ? actualDurations[i] : scenes[i].durationSec;
    mergedDur += d - xfadeDuration - XFADE_SAFETY;
  }

  for (let i = 0; i < N; i++) {
    const scene = scenes[i];
    if (!scene.subtitleText) continue;

    const dur = (actualDurations[i] ?? 0) > 0 ? actualDurations[i] : scene.durationSec;
    const hasOutgoing = i < N - 1;

    // Show after incoming transition ends; hide before outgoing transition starts.
    // Next xfade starts at dominantStarts[i] + dur - T - SAFETY, so subtitle
    // must end (T + SAFETY + 0.3) s before that to give a 0.3 s buffer.
    const finalStart = introOffset + dominantStarts[i] + subtitleDelay;
    const finalEnd   = introOffset + dominantStarts[i] + dur
      - (hasOutgoing ? xfadeDuration + XFADE_SAFETY + 0.3 : 0.5);

    if (finalEnd > finalStart) {
      entries.push({ text: scene.subtitleText, startSec: finalStart, endSec: finalEnd });
    }
  }

  return entries;
}

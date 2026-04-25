/**
 * step10-video-build.ts
 *
 * STEP_10 Video Build のオーケストレーター。
 *
 * ─── 処理概要 ──────────────────────────────────────────────────────────────────
 *
 * 1. batchGet で必要シートを一括取得（94_Runtime_Config, 00_Project,
 *                                      09_Edit_Plan, 08_TTS_Subtitles）
 * 2. project ごとに video_format に応じて short / full / 両方を処理
 * 3. 各バージョンの処理:
 *    a. 09_Edit_Plan + 08_TTS_Subtitles から SceneVideoInput を構築
 *    b. アセット（画像・音声）を Drive からダウンロードして一時ディレクトリに保存
 *    c. イントロ・アウトロ動画を Drive からダウンロード
 *    d. シーンごとに scene_N.mp4 を生成（静止画 + 音声）
 *    e. シーン群を wipe_left xfade で結合
 *    f. イントロ → 0.8s ブラック → merged_scenes → 1.0s ブラック → アウトロ を結合
 *    g. ASS 字幕を生成して焼き込み
 *    h. 完成 mp4 を Drive にアップロード
 *    i. 07_Assets に storage_url / duration_sec を upsert
 * 4. 00_Project を最小更新（current_step = STEP_10_VIDEO_BUILD）
 * 5. 100_App_Logs にログ記録
 *
 * ─── dry_run モード ──────────────────────────────────────────────────────────
 * - GSS / Drive 読み込みは実行（アセット取得の検証のため）
 * - ffmpeg 処理・Drive アップロード・GSS 書き込みはスキップ
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type {
  WorkflowPayload,
  ProjectMinimalPatch,
  VideoAssetRow,
  SceneVideoInput,
  TtsSubtitleVersion,
} from "../types.js";
import { parseRuntimeConfig, getConfigValue } from "../lib/load-runtime-config.js";
import { filterProjectsByIds } from "../lib/load-project-input.js";
import { filterVideoAssets } from "../lib/load-video-assets.js";
import { readSheetsBatch } from "../lib/sheets-client.js";
import { downloadFileFromDrive, uploadImageToDrive, ensurePjtFolder } from "../lib/upload-to-drive.js";
import { upsertVideoAsset } from "../lib/write-assets.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import { appendAppLog } from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";
import {
  buildSceneClip,
  buildBlackClip,
  mergeScenes,
  concatClips,
  burnSubtitles,
  generateAssFile,
  buildSubtitleEntries,
  probeVideoDuration,
  resolveResolution,
  DEFAULT_XFADE_DURATION,
  INTRO_BLACK_DURATION,
  OUTRO_BLACK_DURATION,
} from "../lib/build-video.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Step10Result {
  projectId:    string;
  successCount: number;
  failCount:    number;
}

// ─── Drive URL helper ─────────────────────────────────────────────────────────

/**
 * Google Drive 閲覧 URL から fileId を抽出してバッファをダウンロードする。
 * URL 形式: https://drive.google.com/file/d/{fileId}/view
 */
async function downloadFromDriveUrl(url: string): Promise<Buffer> {
  const match = /\/file\/d\/([^/]+)/.exec(url);
  if (!match) throw new Error(`Invalid Drive URL: ${url}`);
  return downloadFileFromDrive(match[1]);
}

// ─── Per-version video generation ─────────────────────────────────────────────

async function buildVideoForVersion(params: {
  projectId:   string;
  version:     TtsSubtitleVersion;
  scenes:      SceneVideoInput[];
  introUrl:    string;
  quizUrl:     string;
  resolution:  string;
  folderId:    string;
  dryRun:      boolean;
  tempDir:     string;
}): Promise<{ storageUrl: string; durationSec: number }> {
  const { projectId, version, scenes, introUrl, quizUrl, resolution, folderId, dryRun, tempDir } = params;

  logInfo(`[STEP_10][${projectId}][${version}] Generating video with ${scenes.length} scenes`);

  if (dryRun) {
    logInfo(`[STEP_10][${projectId}][${version}] DRY_RUN: skip ffmpeg + Drive upload`);
    return { storageUrl: "DRY_RUN", durationSec: 0 };
  }

  // ── 1. イントロ・アウトロをダウンロード ────────────────────────────────────
  const introPath = path.join(tempDir, `intro_${version}.mp4`);
  const quizPath  = path.join(tempDir, `quiz_${version}.mp4`);
  logInfo(`[STEP_10][${projectId}][${version}] Downloading intro: ${introUrl}`);
  fs.writeFileSync(introPath, await downloadFromDriveUrl(introUrl).catch(e => { throw new Error(`intro download failed (${introUrl}): ${e.message}`); }));
  logInfo(`[STEP_10][${projectId}][${version}] Downloading quiz: ${quizUrl}`);
  fs.writeFileSync(quizPath,  await downloadFromDriveUrl(quizUrl).catch(e => { throw new Error(`quiz download failed (${quizUrl}): ${e.message}`); }));

  const introDuration = probeVideoDuration(introPath);

  // ── 2. シーンアセットをダウンロードしてシーンクリップを生成 ─────────────────
  const sceneClipPaths: string[] = [];
  const sceneDurations: number[] = [];

  for (const scene of scenes) {
    const imgPath  = path.join(tempDir, `${scene.recordId}_${version}.png`);
    const audPath  = path.join(tempDir, `${scene.recordId}_${version}.mp3`);
    const clipPath = path.join(tempDir, `scene_${scene.sceneNo}_${version}.mp4`);

    logInfo(`[STEP_10][${projectId}][${version}] scene ${scene.sceneNo}: img=${scene.imageUrl}`);
    fs.writeFileSync(imgPath, await downloadFromDriveUrl(scene.imageUrl).catch(e => { throw new Error(`scene ${scene.sceneNo} image download failed (${scene.imageUrl}): ${e.message}`); }));
    logInfo(`[STEP_10][${projectId}][${version}] scene ${scene.sceneNo}: aud=${scene.audioUrl}`);
    fs.writeFileSync(audPath, await downloadFromDriveUrl(scene.audioUrl).catch(e => { throw new Error(`scene ${scene.sceneNo} audio download failed (${scene.audioUrl}): ${e.message}`); }));

    await buildSceneClip(imgPath, audPath, clipPath, scene.durationSec, resolution);

    sceneClipPaths.push(clipPath);
    sceneDurations.push(scene.durationSec);
  }

  // ── 3. シーンを wipe_left xfade で結合 ────────────────────────────────────
  const mergedScenesPath = path.join(tempDir, `merged_scenes_${version}.mp4`);
  const mergedDuration   = await mergeScenes(
    sceneClipPaths,
    sceneDurations,
    mergedScenesPath,
    DEFAULT_XFADE_DURATION
  );

  // ── 4. ブラッククリップを生成 ──────────────────────────────────────────────
  const blackInPath  = path.join(tempDir, `black_intro_${version}.mp4`);
  const blackOutPath = path.join(tempDir, `black_outro_${version}.mp4`);
  await buildBlackClip(blackInPath,  INTRO_BLACK_DURATION, resolution);
  await buildBlackClip(blackOutPath, OUTRO_BLACK_DURATION, resolution);

  // ── 5. 全クリップを結合（イントロ → ブラック → scenes → ブラック → クイズ） ─
  const concatPath = path.join(tempDir, `concat_${version}.mp4`);
  await concatClips(
    [introPath, blackInPath, mergedScenesPath, blackOutPath, quizPath],
    concatPath
  );

  // ── 6. ASS 字幕を生成して焼き込む ──────────────────────────────────────────
  const introOffset = introDuration + INTRO_BLACK_DURATION;
  const subtitleEntries = buildSubtitleEntries(
    scenes,
    introOffset,
    DEFAULT_XFADE_DURATION
  );
  const assPath    = path.join(tempDir, `subtitle_${version}.ass`);
  generateAssFile(subtitleEntries, assPath, resolution);

  const finalPath = path.join(tempDir, `final_${version}.mp4`);
  await burnSubtitles(concatPath, assPath, finalPath);

  // ── 7. 総尺を計算 ──────────────────────────────────────────────────────────
  const quizDuration = probeVideoDuration(quizPath);
  const totalDuration = introDuration + INTRO_BLACK_DURATION + mergedDuration + OUTRO_BLACK_DURATION + quizDuration;

  // ── 8. Drive にアップロード ─────────────────────────────────────────────────
  const timestamp   = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName    = `${projectId}_${version}_v1_${timestamp}.mp4`;
  const mp4Buffer   = fs.readFileSync(finalPath);
  const storageUrl  = await uploadImageToDrive(folderId, fileName, mp4Buffer, "video/mp4");

  logInfo(`[STEP_10][${projectId}][${version}] Video uploaded: ${storageUrl} (${totalDuration.toFixed(1)}s)`);

  return { storageUrl, durationSec: totalDuration };
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runStep10VideoBuild(
  payload:       WorkflowPayload,
  spreadsheetId: string
): Promise<Step10Result[]> {
  const { project_ids, max_items, dry_run } = payload;
  const results: Step10Result[] = [];

  // 一括読み込み（06_Image_Prompts を追加して画像 URL を直接取得）
  const BATCH_SHEETS = ["94_Runtime_Config", "00_Project", "09_Edit_Plan", "08_TTS_Subtitles", "06_Image_Prompts"] as const;
  const batchData = await readSheetsBatch(spreadsheetId, [...BATCH_SHEETS]);

  const configMap = parseRuntimeConfig(batchData.get("94_Runtime_Config") ?? []);
  const introUrl  = getConfigValue(configMap, "step_10_intro_video_url");
  const quizUrl   = getConfigValue(configMap, "step_10_quiz_video_url");
  // 他ステップと同様に 94_Runtime_Config の google_drive_folder_id を使用する
  const driveFolderId = getConfigValue(configMap, "google_drive_folder_id", "");
  if (!driveFolderId && !dry_run) {
    throw new Error("94_Runtime_Config: google_drive_folder_id is missing or empty.");
  }

  const projects = filterProjectsByIds(batchData.get("00_Project") ?? [], project_ids)
    .slice(0, max_items);

  if (projects.length === 0) {
    logInfo("[STEP_10] No matching projects found.");
    return results;
  }

  for (const project of projects) {
    const projectId  = project.project_id;
    const videoFormat = (project.video_format ?? "short").trim().toLowerCase();
    const versions: TtsSubtitleVersion[] = videoFormat === "full" ? ["full"]
                                         : videoFormat === "short+full" ? ["short", "full"]
                                         : ["short"];

    logInfo(`[STEP_10][${projectId}] Starting. video_format=${videoFormat}, versions=${versions.join(",")}`);

    let successCount = 0;
    let failCount    = 0;

    // 一時ディレクトリを作成
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `step10_${projectId}_`));

    try {
      // Drive プロジェクトフォルダを確保
      const pjtFolderId = dry_run ? "" : await ensurePjtFolder(driveFolderId, projectId);

      for (const version of versions) {
        const aspectKey = version === "short" ? "aspect_short" : "aspect_full";
        const resolution = resolveResolution(project[aspectKey]);

        const scenes = filterVideoAssets(
          batchData.get("09_Edit_Plan")      ?? [],
          batchData.get("08_TTS_Subtitles")  ?? [],
          batchData.get("06_Image_Prompts")  ?? [],
          projectId,
          version
        );

        if (scenes.length === 0) {
          logInfo(`[STEP_10][${projectId}][${version}] No scenes found — skipping.`);
          continue;
        }

        try {
          const { storageUrl, durationSec } = await buildVideoForVersion({
            projectId,
            version,
            scenes,
            introUrl,
            quizUrl,
            resolution,
            folderId:  pjtFolderId,
            dryRun:    dry_run,
            tempDir,
          });

          // 07_Assets に upsert
          if (!dry_run) {
            const now = new Date().toISOString();
            const assetRow: VideoAssetRow = {
              project_id:        projectId,
              record_id:         `${projectId}-VID-${version}`,
              generation_status: "GENERATED",
              approval_status:   "PENDING",
              step_id:           "STEP_10_VIDEO_BUILD",
              asset_type:        "video",
              related_version:   version,
              file_name:         `${projectId}_${version}_v1.mp4`,
              file_format:       "mp4",
              storage_url:       storageUrl,
              duration_sec:      durationSec,
              resolution,
              updated_at:        now,
              updated_by:        "STEP_10",
              notes:             "",
            };
            await upsertVideoAsset(spreadsheetId, assetRow);
          }

          successCount++;
        } catch (err) {
          logError(`[STEP_10][${projectId}][${version}] Failed: ${err instanceof Error ? err.message : String(err)}`);
          failCount++;

          await appendAppLog(spreadsheetId, {
            project_id:   projectId,
            record_id:    `${projectId}-VID-${version}`,
            current_step: "STEP_10_VIDEO_BUILD",
            timestamp:    new Date().toISOString(),
            app_log:      `[ERROR][VIDEO_BUILD_FAILED] version=${version}: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // 00_Project を最小更新（少なくとも 1 バージョンが成功した場合）
      if (successCount > 0 && !dry_run) {
        const patch: ProjectMinimalPatch = {
          current_step:    "STEP_10_VIDEO_BUILD",
          approval_status: "PENDING",
          updated_at:      new Date().toISOString(),
          updated_by:      "STEP_10",
        };
        await updateProjectMinimal(spreadsheetId, projectId, patch);
      }

    } finally {
      // 一時ディレクトリを削除
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        logInfo(`[STEP_10][${projectId}] Warning: could not clean up temp dir ${tempDir}`);
      }
    }

    logInfo(`[STEP_10][${projectId}] Done. success=${successCount}, fail=${failCount}`);
    results.push({ projectId, successCount, failCount });
  }

  return results;
}

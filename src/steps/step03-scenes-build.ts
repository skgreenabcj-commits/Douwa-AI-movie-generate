/**
 * step03-scenes-build.ts
 *
 * STEP_03 Scenes Build のオーケストレーター。
 *
 * 処理フロー（仕様書 step03_implementation_spec_v0.2.md §3 準拠）:
 * 1. 94_Runtime_Config を読む（scene_max_sec_* / step_03_model_role 含む）
 * 2. 00_Project から対象案件を読む
 * 3. 01_Source から当該 project_id の行を読む
 * 4. 01_Source.approval_status が APPROVED でない場合はエラー停止
 * 5. Prompt / Schema / Example / Policy を repo から読む
 * 6. required_scene_count_base を算出する（= ceil(full_target_sec / scene_max_sec)）
 * 7. STEP_03 プロンプトをアセンブル
 * 8. Gemini を実行する
 *    - primary     : step_03_model_role（デフォルト: gemini-2.5-pro）
 *    - 1st fallback: model_role_text_pro（デフォルト: gemini-3.1-pro-preview）
 *    - 2nd fallback: model_role_text_flash_seconday（デフォルト: gemini-2.0-flash）
 * 9. AI 出力を schema 検証する
 * 10. scene_no / scene_order をシステム側で付与する（scene_no: project_id ごとの通し番号 "1","2","3"...）
 * 11. 02_Scenes に scene 行を upsert する（project_id + scene_no 複合キー）
 * 12. 00_Project の current_step 等を最小更新する
 * 13. 100_App_Logs に成功・失敗ログを書き出す
 *
 * dry_run=true の場合:
 *   Gemini 呼び出しをスキップし、プロンプトプレビューのみ出力する。
 */

import type { WorkflowPayload, ProjectMinimalPatch, SceneFullRow } from "../types.js";
import { loadRuntimeConfig } from "../lib/load-runtime-config.js";
import { readProjectsByIds } from "../lib/load-project-input.js";
import { loadSourceByProjectId } from "../lib/load-source.js";
import { loadStep03Assets } from "../lib/load-assets.js";
import { buildStep03Prompt } from "../lib/build-prompt.js";
import {
  callGemini,
  buildGeminiOptionsStep03,
  GeminiSpendingCapError,
} from "../lib/call-gemini.js";
import { validateSceneAiResponse } from "../lib/validate-json.js";
import { upsertScene, generateSceneId, markScenesGenerationFailed } from "../lib/write-scenes.js";
import { updateProjectMinimal } from "../lib/update-project.js";
import {
  appendAppLog,
  buildStep03SuccessLog,
  buildStep03FailureLog,
} from "../lib/write-app-log.js";
import { logInfo, logError } from "../lib/logger.js";

// scene_max_sec のデフォルト値（94_Runtime_Config 未設定時フォールバック）
// 仕様書 §6.4 / step03_implementation_ai_requirement.md §3.2 準拠
const DEFAULT_SCENE_MAX_SEC: Record<string, number> = {
  "2-3": 15,
  "4-6": 25,
  "6-8": 40,
};
const DEFAULT_SCENE_MAX_SEC_FALLBACK = 25; // target_age が想定外の場合（4-6歳相当）

export async function runStep03ScenesBuild(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void> {
  logInfo("STEP_03 Scenes Build started", {
    project_ids: payload.project_ids,
    max_items: payload.max_items,
    dry_run: payload.dry_run,
  });

  // ─── 1. Runtime Config ──────────────────────────────────────────────────
  const configMap = await loadRuntimeConfig(spreadsheetId);
  logInfo("94_Runtime_Config loaded", { size: configMap.size });

  const geminiOptions = buildGeminiOptionsStep03(configMap);

  // ─── 2. 対象案件を読む（max_items でスライス）────────────────────────────
  const targetIds = payload.project_ids.slice(0, payload.max_items);
  const projects = await readProjectsByIds(spreadsheetId, targetIds);

  if (projects.length === 0) {
    logInfo("No matching projects found. STEP_03 finished with no-op.", {
      project_ids: targetIds,
    });
    return;
  }

  // ─── 3. repo assets を一度だけ読む ─────────────────────────────────────
  const assets = loadStep03Assets();
  logInfo("STEP_03 assets loaded from repo.");

  // ─── 4. 案件を逐次処理 ──────────────────────────────────────────────────
  for (const project of projects) {
    const projectId = project.project_id;
    const projectRecordId = project.record_id;
    const now = new Date().toISOString();

    logInfo(`Processing project: ${projectId}`);

    try {
      // Mandatory フィールドチェック
      const titleJp = (project.title_jp ?? "").trim();
      const targetAge = (project.target_age ?? "").trim();
      const fullTargetSecStr = (project.full_target_sec ?? "").trim();
      const shortTargetSecStr = (project.short_target_sec ?? "").trim();

      if (!titleJp) {
        throw new Error(`project_id "${projectId}": title_jp is empty.`);
      }
      if (!targetAge) {
        throw new Error(`project_id "${projectId}": target_age is empty.`);
      }
      const fullTargetSec = parseInt(fullTargetSecStr, 10);
      if (isNaN(fullTargetSec) || fullTargetSec <= 0) {
        throw new Error(
          `project_id "${projectId}": full_target_sec is invalid ("${fullTargetSecStr}"). Expected 60-1200.`
        );
      }
      if (shortTargetSecStr && isNaN(parseInt(shortTargetSecStr, 10))) {
        throw new Error(
          `project_id "${projectId}": short_target_sec is invalid ("${shortTargetSecStr}").`
        );
      }

      // 3. 01_Source を読む
      const sourceRow = await loadSourceByProjectId(spreadsheetId, projectId);

      if (!sourceRow) {
        await handleStep03Failure(
          spreadsheetId, projectId, projectRecordId, now,
          "runtime_failure",
          `01_Source row not found for project_id "${projectId}". Run STEP_02 first.`,
          payload.dry_run
        );
        continue;
      }

      logInfo(`01_Source loaded for ${projectId}`, {
        approval_status: sourceRow.approval_status,
      });

      // 4. 01_Source.approval_status チェック
      if (sourceRow.approval_status !== "APPROVED") {
        await handleStep03Failure(
          spreadsheetId, projectId, sourceRow.record_id, now,
          "runtime_failure",
          `01_Source.approval_status is "${sourceRow.approval_status}" (expected: APPROVED). STEP_03 aborted.`,
          payload.dry_run
        );
        continue;
      }

      // 6. scene_max_sec と required_scene_count_base を算出
      const sceneMaxSecKey = `scene_max_sec_${targetAge}`;
      const sceneMaxSecRaw = configMap.get(sceneMaxSecKey);
      if (!sceneMaxSecRaw) {
        const fallbackVal = DEFAULT_SCENE_MAX_SEC[targetAge] ?? DEFAULT_SCENE_MAX_SEC_FALLBACK;
        logInfo(
          `[WARN] ${sceneMaxSecKey} not found in 94_Runtime_Config. Using default: ${fallbackVal}`
        );
      }
      const sceneMaxSec = sceneMaxSecRaw
        ? parseInt(sceneMaxSecRaw, 10)
        : (DEFAULT_SCENE_MAX_SEC[targetAge] ?? DEFAULT_SCENE_MAX_SEC_FALLBACK);

      // required_scene_count_base = ceil(full_target_sec / scene_max_sec)
      // AI はこの値の ±15% 程度を許容範囲として scene 数を調整してよい
      const requiredSceneCountBase = Math.ceil(fullTargetSec / sceneMaxSec);

      logInfo(`Scene params for ${projectId}`, {
        targetAge,
        fullTargetSec,
        sceneMaxSec,
        requiredSceneCountBase,
        allowedMin: Math.floor(requiredSceneCountBase * 0.85),
        allowedMax: Math.ceil(requiredSceneCountBase * 1.15),
      });

      // 7. プロンプトアセンブル
      const prompt = buildStep03Prompt(
        assets, project, sourceRow, sceneMaxSec, requiredSceneCountBase
      );
      logInfo(`Prompt assembled for ${projectId}`, {
        promptLength: prompt.length,
        target_age: targetAge,
        full_target_sec: fullTargetSec,
        required_scene_count_base: requiredSceneCountBase,
      });

      // ── dry_run=true → Gemini 呼び出しをスキップ ─────────────────────
      if (payload.dry_run) {
        logInfo(`[dry_run] Skipping Gemini call for ${projectId}.`);
        logInfo(`[dry_run] Prompt preview (first 500 chars):\n${prompt.slice(0, 500)}`);
        continue;
      }

      // 8. Gemini 呼び出し（primary → 1st fallback → 2nd fallback）
      logInfo(`Calling Gemini for ${projectId}...`);
      let geminiResult;
      try {
        geminiResult = await callGemini(prompt, geminiOptions);
      } catch (aiErr) {
        if (aiErr instanceof GeminiSpendingCapError) {
          await handleStep03Failure(
            spreadsheetId, projectId, sourceRow.record_id, now,
            "spending_cap_exceeded",
            `[Spending Cap] Google Cloud の支出上限に達しています。` +
            ` Google Cloud Console > お支払い > 予算とアラート でキャップを引き上げてください。` +
            ` 詳細: ${aiErr.message}`,
            payload.dry_run
          );
          logError(`[Spending Cap] Aborting remaining projects.`);
          break;
        }
        await handleStep03Failure(
          spreadsheetId, projectId, sourceRow.record_id, now,
          "ai_failure",
          `Gemini call failed: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`,
          payload.dry_run
        );
        continue;
      }

      logInfo(`Gemini responded for ${projectId}`, {
        modelUsed: geminiResult.modelUsed,
        usedFallback: geminiResult.usedFallback,
        responseLength: geminiResult.text.length,
      });

      // 9. schema validate
      const validationResult = validateSceneAiResponse(
        geminiResult.text,
        assets.aiSchema
      );

      if (!validationResult.success) {
        // デバッグ: 先頭 500 文字と末尾 200 文字をログに残す
        const raw = geminiResult.text;
        logInfo(`[DEBUG] raw response head (500): ${raw.slice(0, 500)}`);
        logInfo(`[DEBUG] raw response tail (200): ${raw.slice(-200)}`);
        await handleStep03Failure(
          spreadsheetId, projectId, sourceRow.record_id, now,
          "schema_validation_failure",
          `Schema validation failed: ${validationResult.errors}`,
          payload.dry_run
        );
        continue;
      }

      const aiScenes = validationResult.scenes;
      logInfo(`AI response validated for ${projectId}. scene count: ${aiScenes.length}`);

      // 10. scene_no / scene_order をシステム側で付与して 02_Scenes に upsert
      // AI が出力した順序（配列インデックス）をそのまま scene_order とする
      // scene_no = project_id ごとの通し番号（"1", "2", "3"...）。GSS の scene_no カラムに書き込む。
      // scene_order はシステム内部用（record_id 採番・ログ）。GSS には書き込まない。
      const upsertedRecordIds: string[] = [];
      for (let i = 0; i < aiScenes.length; i++) {
        const aiScene = aiScenes[i];
        const sceneOrder = i + 1; // 1始まり
        const sceneNo = generateSceneId(projectId, sceneOrder); // SC-001-01 形式

        const fullRow: SceneFullRow = {
          // AI 出力フィールド（新フィールドセット）
          ...aiScene,
          // システム側付与フィールド
          project_id: projectId,
          record_id: "",          // upsert 側で確定
          generation_status: "GENERATED",
          approval_status: "PENDING",
          step_id: "STEP_03_SCENES_BUILD",
          scene_no: sceneNo,      // GSS の scene_no カラムへ書き込む
          scene_type: "normal",   // 新規生成は常に "normal"。ユーザーが GSS で手動変更する。
          scene_order: sceneOrder, // システム内部用（record_id 採番）
          updated_at: now,
          updated_by: "github_actions",
          notes: "",
        };

        const upsertedId = await upsertScene(spreadsheetId, fullRow);
        upsertedRecordIds.push(upsertedId);
        logInfo(`  02_Scenes upserted: scene_no=${sceneNo}, scene_order=${sceneOrder}, record_id=${upsertedId}`);
      }

      // 11. 00_Project を最小更新（成功時）
      const patch: ProjectMinimalPatch = {
        current_step: "STEP_03_SCENES_BUILD",
        approval_status: "PENDING",
        created_at: now,
        updated_at: now,
        updated_by: "github_actions",
      };
      await updateProjectMinimal(spreadsheetId, projectId, patch);
      logInfo(`00_Project updated for ${projectId}.`);

      // 12. 成功ログ
      const firstRecordId = upsertedRecordIds[0] ?? "";
      const successLog = buildStep03SuccessLog(
        projectId,
        firstRecordId,
        `STEP_03 completed. model=${geminiResult.modelUsed}, ` +
          `usedFallback=${geminiResult.usedFallback}, ` +
          `scene_count=${aiScenes.length}, ` +
          `target_age=${targetAge}, ` +
          `full_target_sec=${fullTargetSec}, ` +
          `required_scene_count_base=${requiredSceneCountBase}`
      );
      await appendAppLog(spreadsheetId, successLog);

      logInfo(`STEP_03 completed successfully for ${projectId}.`);
    } catch (err) {
      // 予期しないランタイムエラー
      await handleStep03Failure(
        spreadsheetId, projectId, projectRecordId, now,
        "runtime_failure",
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        payload.dry_run
      );
    }
  }

  logInfo("STEP_03 Scenes Build finished.");
}

// ─── Private helpers ─────────────────────────────────────────────────────────

async function handleStep03Failure(
  spreadsheetId: string,
  projectId: string,
  recordId: string,
  now: string,
  errorType: string,
  message: string,
  dryRun: boolean
): Promise<void> {
  logError(`STEP_03 failed for ${projectId} [${errorType}]: ${message}`);

  if (dryRun) {
    logInfo(`[dry_run] Skipping GSS write for failure of ${projectId}.`);
    return;
  }

  // 00_Project を失敗状態に更新
  try {
    const failPatch: ProjectMinimalPatch = {
      current_step: "STEP_03_SCENES_BUILD",
      approval_status: "UNKNOWN",
      updated_at: now,
      updated_by: "github_actions",
    };
    await updateProjectMinimal(spreadsheetId, projectId, failPatch);
  } catch (updateErr) {
    logError(
      `Failed to update 00_Project for ${projectId} after STEP_03 failure`,
      updateErr
    );
  }

  // 100_App_Logs にエラーログを追記
  try {
    const failLog = buildStep03FailureLog(projectId, recordId, errorType, message);
    await appendAppLog(spreadsheetId, failLog);
  } catch (logErr) {
    logError(`Failed to write failure log for ${projectId}`, logErr);
  }

  // 02_Scenes の generation_status を "FAILED" に更新（行が存在する場合のみ）
  try {
    await markScenesGenerationFailed(spreadsheetId, projectId, now);
  } catch (markErr) {
    logError(`Failed to mark generation_status=FAILED for ${projectId} in 02_Scenes`, markErr);
  }
}

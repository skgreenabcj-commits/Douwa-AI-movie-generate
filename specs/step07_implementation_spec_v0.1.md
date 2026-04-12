# STEP_07 Image Prompts 実装設計書 v0.1

> **ステータス**: ドラフト（オーナー判断反映済み 2026-04-12）
> **改訂履歴**:
> - v0.1 (2026-04-12): 初版ドラフト（論点1〜5・追加指示のオーナー判断反映版）
> **元仕様**: `docs/02_process_flow.md`、`docs/03_process_sequence.md`
> **前提実装**: STEP_01〜06 のコードパターンを継承する
> **決定事項記録**: 論点1〜5 / 画像生成追加指示のオーナー判断をすべて本書に反映済み

---

## §1 本書の目的

STEP_07 Image Prompts の実装設計を定義する。

本ステップは Visual Bible（STEP_06）とシーンマスター（STEP_03）をもとに、各シーンの画像生成用プロンプトを `06_Image_Prompts` シートに格納し、さらに Gemini 3.1 Flash Image（Nano Banana 2）で実際の画像を生成して Google Drive に保存する。

生成された画像の Google Drive URL は `image_take_1` カラムに書き込まれ、後続の動画制作ステップへの入力となる。

---

## §2 確定した設計判断

| # | 論点 | 判断 | 実装への影響 |
|---|---|---|---|
| 論点1 | 行粒度 | **`02_Scenes.record_id` ごとに1行**（Short/Full 区別なし） | `related_version` には `scenes.record_id` 値を格納 |
| 論点2 | 入力データ範囲 | **02_Scenes + 05_Visual_Bible のみ**（Script 参照なし） | `visual_focus` / `emotion` / `scene_summary` + VB ルールを主入力とする |
| 論点3 | `prompt_full` の組み立て | **コード側で結合**（画像生成クセへの一貫対応のため） | AI はパーツのみ出力。コードが `prompt_full` を組み立てる |
| 論点4 | `record_id` 採番 | **`PJT-001-IMG-001` 形式**（システム側連番採番） | AI には `record_id` を生成させない。配列インデックス順に採番 |
| 論点5 | `related_version` | **`02_Scenes.record_id` の値**（例: `PJT-001-SCN-001`） | `scene_no` は表示補助列。`related_version` が行の識別子 |
| 追加A | 画像生成 API | **Gemini 3.1 Flash Image（Nano Banana 2）** | Gemini API の Image Generation エンドポイントを使用 |
| 追加B | 生成枚数 | **1シーン1枚**（`image_take_1` のみ） | `image_take_2` / `image_take_3` は空文字で書き込む |
| 追加C | アスペクト比 | **16:9** 固定 | 画像生成リクエストに `aspectRatio: "16:9"` を指定 |
| 追加D | Google Drive 保存 | PJT フォルダ作成 + ファイル格納 | Runtime Config `google_drive_folder_id` 配下に `PJT-###` フォルダを作成 |
| 追加E | ファイル命名規則 | `{scene_record_id}_{short\|full\|shortfull}_{YYYYMMDD}.png` | `short_use`/`full_use` の組み合わせで `short`/`full`/`shortfull` を決定 |

### `shortfull` 判定ロジック

| `short_use` | `full_use` | ファイル名中の値 |
|---|---|---|
| Y | N | `short` |
| N | Y | `full` |
| Y | Y | `shortfull` |

### `current_step` 設定値

| 実行状態 | `current_step` 値 |
|---|---|
| 成功 | `STEP_07_IMAGE_PROMPTS` |
| 失敗 | 更新しない |

---

## §3 ファイル構成

### 新規作成ファイル

```
src/
  steps/
    step07-image-prompts.ts              # オーケストレーター

  lib/
    write-image-prompts.ts               # 06_Image_Prompts upsert
    load-image-prompts.ts                # 06_Image_Prompts 読み込み（再実行時）
    upload-to-drive.ts                   # Google Drive フォルダ作成 + 画像アップロード（既存 .env サービスアカウント認証を流用）

  scripts/
    dry-run-step07.ts                    # dry-run スクリプト

prompts/
  image_prompt_prompt_v1.md              # STEP_07 プロンプトテンプレート

schemas/
  image_prompt_schema_ai_v1.json         # AI 出力バリデーション用スキーマ
  image_prompt_schema_full_v1.json       # GSS 書き込み行バリデーション用スキーマ

examples/
  image_prompt_ai_response_example_v1.json
  image_prompt_full_response_example_v1.json
```

### 既存ファイルへの追記対象

```
src/
  index.ts                              # STEP_07 ルーティング追加
  types.ts                              # ImagePromptAiRow / ImagePromptRow / ImagePromptReadRow 追加; StepId 更新

  lib/
    build-prompt.ts                     # buildStep07Prompt() 追加
    load-assets.ts                      # loadStep07Assets() 追加
    call-gemini.ts                      # generateImageStep07() 追加（画像生成用）
    validate-json.ts                    # validateImagePromptAiResponse() 追加
    write-app-log.ts                    # buildStep07 ログビルダー追加

  # .env.example への追記不要（Drive 認証は既存 GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY を流用）
  # google_drive_folder_id は 94_Runtime_Config から取得
```

---

## §4 処理フロー（概要）

```
for each projectId in payload.project_ids:

  1.  loadRuntimeConfig()
  2.  readProjectsByIds() → ProjectRow（video_format 取得）
  3.  video_format バリデーション
  4.  loadScenesByProjectId() → SceneReadRow[]
      → video_format に応じてフィルタ（full_use=Y / short_use=Y）
  5.  loadVisualBibleByProjectId() → VisualBibleReadRow[]（全 VB 要素）
      → 0 件: preflight failure（no_visual_bible）

  ─── Prompt Build ────────────────────────────────────────────
  6.  loadStep07Assets()
  7.  for each targetScene:
        buildStep07Prompt(assets, project, scene, visualBibleRows) でプロンプト組み立て
        callGeminiText() で AI 呼び出し（prompt parts 生成）
        validateImagePromptAiResponse() で AJV 検証
        prompt_full をコード側で組み立て

  ─── Image Generation + Drive Upload ──────────────────────────
  8.  ensurePjtFolder(GDRIVE_IMAGE_FOLDER_ID, projectId) → folderId
  9.  for each validated aiRow:
        generateImageStep07(prompt_full) → PNG binary（アスペクト比: 16:9）
        versionLabel = resolveVersionLabel(scene.short_use, scene.full_use)
        fileName = `${scene.record_id}_${versionLabel}_${YYYYMMDD}.png`
        uploadToDrive(folderId, fileName, pngBinary) → driveUrl

  ─── GSS Upsert ──────────────────────────────────────────────
  10. record_id 採番（PJT-001-IMG-001 形式）
  11. for each row:
        ImagePromptRow を組み立て（image_take_1 = driveUrl）
        upsertImagePrompts()

  12. 00_Project を最小更新（current_step = "STEP_07_IMAGE_PROMPTS"）
  13. buildStep07SuccessLog() → appendAppLog()
```

---

## §5 record_id 採番方針

- 採番形式: `{projectId}-IMG-{index:03d}`（例: `PJT-001-IMG-001`）
- インデックスは `targetScenes` の配列順（`02_Scenes` の読み込み順）
- 再実行時: `loadImagePromptsByProjectId()` で既存行を取得し、インデックス順で record_id を再利用
- 再実行時に AI 出力件数が減少した場合: 余剰既存行は残置（DELETE 禁止）

```typescript
function assignImagePromptRecordIds(
  projectId: string,
  sceneCount: number,
  existingRows: ImagePromptReadRow[]
): string[] {
  return Array.from({ length: sceneCount }, (_, i) =>
    existingRows[i]?.record_id ?? `${projectId}-IMG-${String(i + 1).padStart(3, "0")}`
  );
}
```

---

## §6 GSS フィールドマッピング（`06_Image_Prompts`）

| フィールド | role | 値の設定元 |
|---|---|---|
| `project_id` | SYSTEM_CONTROL | `project.project_id` |
| `record_id` | SYSTEM_CONTROL | システム採番（§5） |
| `generation_status` | SYSTEM_CONTROL | `"GENERATED"` 固定 |
| `approval_status` | HUMAN_REVIEW | `"PENDING"` 固定 |
| `step_id` | SYSTEM_CONTROL | `"STEP_07_IMAGE_PROMPTS"` 固定 |
| `scene_no` | SYSTEM_CONTROL | `scene.scene_no`（表示補助） |
| `related_version` | SYSTEM_CONTROL | `scene.record_id`（例: `PJT-001-SCN-001`） |
| `prompt_base` | AI_OUTPUT | AI 出力 |
| `prompt_character` | AI_OUTPUT | AI 出力 |
| `prompt_scene` | AI_OUTPUT | AI 出力 |
| `prompt_composition` | AI_OUTPUT | AI 出力 |
| `negative_prompt` | AI_OUTPUT | AI 出力 |
| `prompt_full` | AI_OUTPUT | コード側で組み立て（§11 参照） |
| `image_take_1` | REFERENCE | Google Drive URL（生成画像） |
| `image_take_2` | REFERENCE | `""` 固定（本実装では未使用） |
| `image_take_3` | REFERENCE | `""` 固定（本実装では未使用） |
| `selected_asset` | HUMAN_REVIEW | `""` 初期値（人手入力） |
| `revision_note` | HUMAN_REVIEW | `""` 初期値 |
| `style_consistency_check` | HUMAN_REVIEW | `""` 初期値 |
| `updated_at` | SYSTEM_CONTROL | 実行時刻（ISO 8601） |
| `updated_by` | SYSTEM_CONTROL | `"STEP_07_IMAGE_PROMPTS"` 固定 |
| `notes` | HUMAN_REVIEW | `""` 初期値 |

---

## §7 AI 出力スキーマ（概要）

AI（Gemini Text モデル）が返す1シーン分のサンプル JSON:

```json
{
  "image_prompts": [
    {
      "scene_record_id": "PJT-001-SCN-001",
      "prompt_base": "Children's picture-book illustration, soft watercolor style, warm pastel tones, 16:9 landscape",
      "prompt_character": "Momotaro: cheerful young boy in red-and-white kimono, round face, big bright eyes, standing center-right",
      "prompt_scene": "Riverside at dusk, large peach floating in shallow stream, lush green banks, gentle ripples",
      "prompt_composition": "Wide establishing shot, peach as focal point left-center, grandmother in background right, golden hour light",
      "negative_prompt": "dark tones, scary expressions, photorealistic, violent imagery, fluorescent colors, modern objects"
    }
  ]
}
```

---

## §8 Gemini 設定

### テキスト生成（プロンプトパーツ生成）

| 項目 | 値 |
|---|---|
| primary model | Runtime Config `step_07_model_role`（未設定時: `model_role_text_pro` フォールバック） |
| fallback | `model_role_text_flash` |
| `maxOutputTokens` | `8192` |
| 呼び出し粒度 | シーンごとに1回（1シーン = 1 Gemini Text 呼び出し） |

### 画像生成

| 項目 | 値 |
|---|---|
| model | `gemini-2.0-flash-preview-image-generation`（Nano Banana 2 / Gemini 3.1 Flash Image） |
| `aspectRatio` | `"16:9"` 固定 |
| `responseModalities` | `["IMAGE"]` |
| 環境変数 | `GEMINI_API_KEY`（既存） |
| 呼び出し粒度 | シーンごとに1回 |

---

## §9 エラーハンドリング方針

| エラー種別 | `error_type` | 挙動 |
|---|---|---|
| `video_format` 不正値 | `invalid_video_format` | preflight failure → 次 project へ |
| 02_Scenes 読み込み失敗 | `load_scenes_failure` | preflight failure → 次 project へ |
| 対象 scene 0 件 | `no_target_scenes` | preflight failure → 次 project へ |
| 05_Visual_Bible 0 件 | `no_visual_bible` | preflight failure → 次 project へ |
| Gemini Text API エラー（SpendingCap） | — | `throw GeminiSpendingCapError`（全 project 停止） |
| Gemini Text API エラー（その他） | `gemini_text_error` | シーン単位で failure log → 次シーンへ |
| スキーマ validation 失敗 | `schema_validation_failure` | 対象シーンをスキップ（upsert なし） |
| 画像生成 API エラー | `gemini_image_error` | `image_take_1 = ""` でプロンプト行のみ upsert。failure log に記録 |
| Google Drive アップロード失敗 | `drive_upload_error` | `image_take_1 = ""` でプロンプト行のみ upsert。failure log に記録 |
| `upsertImagePrompts` 失敗 | `upsert_failure` | 失敗行のみ failure log。成功行は確定 |
| 予期しない例外 | `unexpected_error` | failure log → 次 project へ |

---

## §10 dry-run スクリプト（`src/scripts/dry-run-step07.ts`）

| 環境変数 | 挙動 |
|---|---|
| `DRY_RUN=true` | Gemini API・画像生成・Google Drive への呼び出しをモック。GSS 書き込みをスキップ |
| `DRY_RUN=false` | 実際に API を呼び出し GSS + Drive に書き込む |

モック project_id: `PJT-001`

dry-run 時の画像生成モック:
- PNG binary の代わりに 1x1 透明 PNG を返す定数を使用
- Drive URL の代わりに `"https://drive.google.com/mock/PJT-001-SCN-001.png"` を返す

---

## §11 型定義設計（`src/types.ts` 追記）

### `StepId`（更新）

```typescript
export type StepId =
  | "STEP_01"
  | "STEP_02"
  | "STEP_03"
  | "STEP_04_05"
  | "STEP_04_SHORT_SCRIPT_BUILD"
  | "STEP_05_FULL_SCRIPT_BUILD"
  | "STEP_04_05_COMBINED"
  | "STEP_06_VISUAL_BIBLE"
  | "STEP_07_IMAGE_PROMPTS";   // ← 追加
```

### `ImagePromptAiRow`（AI 出力用・新規）

```typescript
/**
 * STEP_07 Image Prompts — AI が返す 1 scene 分の row
 * スキーマ: image_prompt_schema_ai_v1.json
 *
 * record_id / prompt_full は AI 出力に含めない。
 * - record_id: システム側で採番（PJT-001-IMG-001 形式）
 * - prompt_full: コード側で buildPromptFull() により組み立て
 */
export interface ImagePromptAiRow {
  scene_record_id:  string;  // 対応する 02_Scenes.record_id（突合用）
  prompt_base:      string;  // 基礎スタイル指示（画風・全体トーン）
  prompt_character: string;  // キャラクター描写
  prompt_scene:     string;  // 背景・場所描写
  prompt_composition: string; // 構図・フレーミング
  negative_prompt:  string;  // 禁止要素
  [key: string]: unknown;    // matchAiOutput 互換
}
```

### `ImagePromptRow`（GSS 書き込み用・新規）

```typescript
/**
 * Google Sheets 06_Image_Prompts 書き込み行（image_prompt_schema_full_v1）
 *
 * upsert キー: record_id
 * 再実行時は既存行を record_id で上書き UPDATE する。
 */
export interface ImagePromptRow {
  project_id:             string;
  record_id:              string;   // システム採番: {projectId}-IMG-{index:03d}
  generation_status:      "GENERATED" | "FAILED" | "PENDING";
  approval_status:        "PENDING" | "APPROVED" | "REJECTED";
  step_id:                string;   // 固定: "STEP_07_IMAGE_PROMPTS"
  scene_no:               string;   // 表示補助: 02_Scenes.scene_no
  related_version:        string;   // 02_Scenes.record_id の値
  prompt_base:            string;
  prompt_character:       string;
  prompt_scene:           string;
  prompt_composition:     string;
  negative_prompt:        string;
  prompt_full:            string;   // コード側で組み立て済み
  image_take_1:           string;   // Google Drive URL（生成画像）
  image_take_2:           string;   // "" 固定（本実装では未使用）
  image_take_3:           string;   // "" 固定
  selected_asset:         string;   // "" 初期値
  revision_note:          string;   // "" 初期値
  style_consistency_check: string;  // "" 初期値
  updated_at:             string;
  updated_by:             string;
  notes:                  string;
}
```

### `ImagePromptReadRow`（06_Image_Prompts 読み込み用・新規）

```typescript
/** 06_Image_Prompts から読み込む参照用 row（再実行時の record_id 再利用用） */
export interface ImagePromptReadRow {
  project_id:      string;
  record_id:       string;
  related_version: string;  // = 02_Scenes.record_id
}
```

---

## §12 モジュール設計

### `src/lib/write-image-prompts.ts`（新規）

```typescript
upsertImagePrompts(spreadsheetId: string, row: ImagePromptRow): Promise<string>
// returns record_id
```

- シート名: `06_Image_Prompts`（定数固定）
- upsert キー: `record_id`
- ヘッダー列順は `docs/GSS_field_master.tsv` の `06_Image_Prompts` 定義順に従う

### `src/lib/load-image-prompts.ts`（新規）

```typescript
loadImagePromptsByProjectId(
  spreadsheetId: string,
  projectId: string
): Promise<ImagePromptReadRow[]>
```

- `06_Image_Prompts` シートを全行読み込み、`project_id` 一致行を返す
- `generation_status = "GENERATED"` の行のみ返す
- 0 件の場合は空配列（初回実行では正常）

### `src/lib/upload-to-drive.ts`（新規）

```typescript
/** PJT-### フォルダを GDRIVE_IMAGE_FOLDER_ID 配下に作成（既存ならスキップ）→ folderId を返す */
ensurePjtFolder(parentFolderId: string, projectId: string): Promise<string>

/** PNG binary を指定フォルダにアップロード → 閲覧用 URL を返す */
uploadImageToDrive(
  folderId: string,
  fileName: string,
  pngBuffer: Buffer
): Promise<string>

/** short_use / full_use から short|full|shortfull を解決 */
resolveVersionLabel(shortUse: string, fullUse: string): "short" | "full" | "shortfull"
```

- Google Drive API v3 を使用（`googleapis` パッケージ）
- 認証: `.env` の `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`（GSS 認証と同一サービスアカウント）
- `google_drive_folder_id` は `loadRuntimeConfig()` 経由で `94_Runtime_Config` から取得
- ファイルの MIME type: `image/png`
- アップロード後に閲覧権限を `anyone-reader` に設定する

### `src/lib/build-prompt.ts`（追記）

```typescript
buildStep07Prompt(
  assets: Step07Assets,
  project: ProjectRow,
  scene: SceneReadRow,
  visualBible: VisualBibleReadRow[]
): string
```

- `image_prompt_prompt_v1.md` テンプレートを読み込み `{{INPUT_DATA}}` を置換
- 注入する INPUT_DATA:
  - `project`: `project_id`, `title_jp`, `target_age`, `visual_style`
  - `scene`: `scene_no`, `scene_record_id`（= `scene.record_id`）, `scene_title`, `scene_summary`, `visual_focus`, `emotion`
  - `visual_bible`: VB 全要素（`category`, `key_name`, `description`, + 各ルールフィールド）

### `prompt_full` 組み立てロジック（`buildPromptFull`）

```typescript
function buildPromptFull(ai: ImagePromptAiRow): string {
  return [
    ai.prompt_base,
    ai.prompt_character,
    ai.prompt_scene,
    ai.prompt_composition,
  ]
    .filter(Boolean)
    .join(", ");
  // negative_prompt は prompt_full には含めない（画像生成 API に別パラメータで渡す）
}
```

### `src/lib/call-gemini.ts`（追記）

```typescript
/** Gemini Image Generation 呼び出し → PNG Buffer を返す */
generateImageStep07(
  promptFull: string,
  negativePrompt: string
): Promise<Buffer>
```

- `responseModalities: ["IMAGE"]`
- `aspectRatio: "16:9"`
- model: `gemini-2.0-flash-preview-image-generation`
- `negative_prompt` は API パラメータ `negativePrompt` に渡す（`prompt_full` には含めない）

### `src/lib/load-assets.ts`（追記）

```typescript
export interface Step07Assets {
  promptTemplate: string;
  aiSchema:       string;
  fullSchema:     string;
}

export function loadStep07Assets(): Step07Assets
```

---

## §13 INPUT_DATA 仕様

プロンプトに注入する JSON 構造（1シーン分）:

```jsonc
{
  "project": {
    "project_id": "PJT-001",
    "title_jp": "桃太郎",
    "target_age": "4-6",
    "visual_style": "やわらかい水彩絵本風、明るい色調"
  },
  "scene": {
    "scene_no": "1",
    "scene_record_id": "PJT-001-SCN-001",
    "scene_title": "大きな桃が川から流れてくる",
    "scene_summary": "おばあさんが川で洗濯をしていると、大きな桃がどんぶらこと流れてくる。",
    "visual_focus": "大きな桃と驚くおばあさん",
    "emotion": "ふしぎ、わくわく"
  },
  "visual_bible": [
    {
      "category": "character",
      "key_name": "おばあさん",
      "description": "やさしいおばあさん。白髪で小柄。",
      "color_palette": "薄茶・白・若草色の着物",
      "line_style": "柔らかい輪郭線",
      "expression_rule": "穏やかな笑顔、驚きは目を丸くする"
    },
    {
      "category": "color_theme",
      "key_name": "全体配色",
      "description": "桃色・空色・若草色をメインとした暖色系パレット",
      "color_palette": "桃色 #F7B8C2、空色 #B3D9F7、若草色 #A8D5A2"
    }
    // ... 他の VB 要素
  ]
}
```

---

## §14 100_App_Logs Upsert 仕様

| ビルダー関数 | `step_id` | `level` | 用途 |
|---|---|---|---|
| `buildStep07SuccessLog(projectId, recordId, msg)` | `STEP_07_IMAGE_PROMPTS` | `INFO` | 全シーン正常完了 |
| `buildStep07PartialSuccessLog(projectId, recordId, msg)` | `STEP_07_IMAGE_PROMPTS` | `WARN` | 一部シーン失敗（部分成功） |
| `buildStep07FailureLog(projectId, recordId, reason, msg)` | `STEP_07_IMAGE_PROMPTS` | `ERROR` | シーン単位の失敗 |
| `buildStep07PreflightFailureLog(projectId, recordId, reason, msg)` | `STEP_07_IMAGE_PROMPTS` | `ERROR` | 前処理失敗 |

- `recordId`: 最初に upsert に成功した `image_take_1` の `record_id`（`PJT-001-IMG-001`）
- `recordId` が取得できない場合は `project.record_id`（空文字）をフォールバック

---

## §15 オーケストレーター設計詳細（`src/steps/step07-image-prompts.ts`）

```
export async function runStep07ImagePrompts(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void>

for each projectId in payload.project_ids:

  [PREFLIGHT]
  1.  config = loadRuntimeConfig()
  2.  project = readProjectsByIds(spreadsheetId, [projectId])[0]
      → undefined: throw + preflight failure log

  3.  video_format 取得・バリデーション
      → 不正値: buildStep07PreflightFailureLog(invalid_video_format) → continue

  4.  scenes = loadScenesByProjectId(spreadsheetId, projectId)
      → 0 件: buildStep07PreflightFailureLog(no_scenes) → continue

  5.  targetScenes = filterScenesByVideoFormat(scenes, video_format)
      → 0 件: buildStep07PreflightFailureLog(no_target_scenes) → continue

  6.  visualBible = loadVisualBibleByProjectId(spreadsheetId, projectId)
      → 0 件: buildStep07PreflightFailureLog(no_visual_bible) → continue

  7.  existingRows = loadImagePromptsByProjectId(spreadsheetId, projectId)
  8.  recordIds = assignImagePromptRecordIds(projectId, targetScenes.length, existingRows)

  9.  parentFolderId = config["google_drive_folder_id"]
      → 未設定: buildStep07PreflightFailureLog(missing_config_gdrive_folder) → continue
  10. folderId = ensurePjtFolder(parentFolderId, projectId)

  [SCENE LOOP]
  let firstUpsertedId = ""
  let successCount = 0, failCount = 0

  for (i, scene) of targetScenes.entries():
    recordId = recordIds[i]

    try:
      // --- Prompt Parts 生成 ---
      prompt = buildStep07Prompt(assets, project, scene, visualBible)
      rawText = callGeminiText(prompt, geminiOptions)
      validateResult = validateImagePromptAiResponse(rawText, assets.aiSchema)
      → failure: buildStep07FailureLog(schema_validation_failure) → failCount++ → continue

      aiRow = validateResult.item  // scene_record_id が一致するものを使用
      promptFull = buildPromptFull(aiRow)

      // --- 画像生成 ---
      let driveUrl = ""
      try:
        pngBuffer = generateImageStep07(promptFull, aiRow.negative_prompt)
        versionLabel = resolveVersionLabel(scene.short_use, scene.full_use)
        fileName = `${scene.record_id}_${versionLabel}_${YYYYMMDD}.png`
        driveUrl = uploadImageToDrive(folderId, fileName, pngBuffer)
      catch imageErr:
        buildStep07FailureLog(gemini_image_error or drive_upload_error) → 記録のみ
        // driveUrl = "" のままプロンプト行はupsertする

      // --- GSS Upsert ---
      row: ImagePromptRow = {
        ...systemFields,
        ...aiRow,
        prompt_full: promptFull,
        image_take_1: driveUrl,
        image_take_2: "", image_take_3: "",
        related_version: scene.record_id,
        scene_no: scene.scene_no,
        record_id: recordId,
      }
      upsertImagePrompts(spreadsheetId, row)
      if (!firstUpsertedId) firstUpsertedId = recordId
      successCount++

    catch unexpectedErr:
      buildStep07FailureLog(unexpected_error) → failCount++ → continue

  [POST LOOP]
  if (successCount === 0):
    buildStep07PreflightFailureLog(all_scenes_failed) → continue
  else:
    updateProjectCurrentStep(spreadsheetId, projectId, "STEP_07_IMAGE_PROMPTS")
    if (failCount > 0):
      buildStep07PartialSuccessLog(projectId, firstUpsertedId, summary)
    else:
      buildStep07SuccessLog(projectId, firstUpsertedId, summary)
```

---

## 未決定事項・今後の検討

| # | 事項 | 備考 |
|---|---|---|
| 未定1 | Gemini Image Generation の正確な model ID | `gemini-2.0-flash-preview-image-generation` を仮定。リリース時に `94_Runtime_Config` で上書き可能にする |
| 未定2 | Google Drive 閲覧権限の設定方針 | `anyone-reader` で公開リンク生成を想定。セキュリティ要件によっては変更の可能性あり |
| 未定3 | `googleapis` パッケージの追加 | `package.json` 依存関係への追加が必要。認証は既存サービスアカウント（`.env`）を流用するため新規認証情報は不要 |
| 未定4 | `step_07_model_role` の Runtime Config 登録 | `94_Runtime_Config` シートへの初期値投入が必要 |
| 未定5 | 画像生成失敗時の retry 戦略 | 現状は1回のみ。将来的にリトライロジックを追加する可能性あり |

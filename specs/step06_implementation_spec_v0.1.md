# STEP_06 Visual Bible 実装設計書 v0.1

> **ステータス**: ドラフト（オーナー判断反映済み 2026-04-11）
> **改訂履歴**:
> - v0.1 (2026-04-11): 初版ドラフト（論点1〜5・追加論点A〜C のオーナー判断反映版）
> **元仕様**: `docs/02_process_flow.md`、`docs/03_process_sequence.md`
> **前提実装**: STEP_01〜05 のコードパターンを継承する
> **決定事項記録**: 論点1〜5 / 追加論点A〜C のオーナー判断をすべて本書に反映済み

---

## 1. 本書の目的

STEP_06 Visual Bible の実装設計を定義する。

Visual Bible は「プロジェクト横断的なビジュアル設計辞書」であり、キャラクター・背景・色・
ライティング・スタイルなど視覚要素ごとの設計ルールを `05_Visual_Bible` シートに格納する。
STEP_07 以降の画像プロンプト生成・映像制作が本シートを参照することで、動画全体の視覚的一貫性を担保する。

---

## 2. 確定した設計判断

| # | 論点 | 判断 | 実装への影響 |
|---|---|---|---|
| 論点1 | Visual Bible の行粒度 | **Element粒度**（1 visual element = 1 row） | `category` + `key_name` で要素を識別。scene と 1対1 紐付けなし |
| 論点2 | Short / Full の扱い | **共通1セット**（Short・Full 両バージョンで同一 Visual Bible） | `related_version` 列なし。1プロジェクト = 1 Visual Bible |
| 論点3 | 入力データ範囲 | **02_Scenes のみ**（Script は参照しない） | `visual_focus` / `emotion` / `scene_summary` を主入力とする |
| 論点4 | `video_format` との関係 | **video_format に応じてフレキシブル** | `full` → `full_use=Y` scenes のみ、`short` → `short_use=Y` scenes のみ、`short+full` → `full_use=Y` scenes（包括的） |
| 論点5 | AI 呼び出し粒度 | **プロジェクト全体で1回** | 全対象 scene を1プロンプトに束ね、`visual_bible` 配列を一括返却 |
| 追加論点A | `record_id` 採番 | **`PJT-001-VB-001` 形式**（システム側連番採番） | AI には `record_id` を生成させない。配列インデックス順に採番 |
| 追加論点B | `category` 値設計 | **固定 enum + `key_name` は AI 自由記述** | `category` を JSON Schema で enum 拘束。`key_name` は AI が場面・要素名を記述 |
| 追加論点C | scene との紐付け | **切り離し（`scene_no` なし）** | Visual Bible はプロジェクトレベルの辞書として機能。`scene_no` 列なし |

### `category` 固定 enum

| 値 | 意味 |
|---|---|
| `character` | 登場キャラクターの外見・表情・衣装ルール |
| `background` | 背景・場所・空間の視覚ルール |
| `color_theme` | プロジェクト全体の色パレット・配色方針 |
| `lighting` | 照明・明暗・時間帯のルール |
| `style_global` | 全体的な画風・線スタイル・タッチのルール |
| `avoid` | 使用禁止の視覚表現・要素 |

### `current_step` 設定値

| 実行状態 | `current_step` 値 |
|---|---|
| 成功 | `STEP_06_VISUAL_BIBLE` |
| 失敗 | 更新しない |

---

## 3. ファイル構成（新規作成対象）

```
src/
  steps/
    step06-visual-bible.ts              # オーケストレーター

  lib/
    write-visual-bible.ts               # 05_Visual_Bible upsert
    load-visual-bible.ts                # 05_Visual_Bible 読み込み（再実行時の既存行取得）

prompts/
  visual_bible_prompt_v1.md             # STEP_06 プロンプトテンプレート

schemas/
  visual_bible_schema_ai_v1.json        # AI 出力バリデーション用スキーマ
  visual_bible_schema_full_v1.json      # GSS 書き込み行バリデーション用スキーマ

examples/
  visual_bible_ai_response_example_v1.json
```

### 既存ファイルへの追記対象

```
src/
  index.ts                              # STEP_06 ルーティング追加
  types.ts                              # VisualBibleAiRow / VisualBibleRow 追加; StepId 更新

  lib/
    build-prompt.ts                     # buildStep06Prompt() 追加
    load-assets.ts                      # loadStep06Assets() 追加
    call-gemini.ts                      # buildGeminiOptionsStep06() 追加
    validate-json.ts                    # validateVisualBibleAiResponse() 追加
    write-app-log.ts                    # buildStep06 ログビルダー追加
```

---

## 4. 型定義設計（`src/types.ts` 追記）

### 4.1 `StepId`（更新）

```typescript
export type StepId =
  | "STEP_01"
  | "STEP_02"
  | "STEP_03"
  | "STEP_04_05"
  | "STEP_04_SHORT_SCRIPT_BUILD"
  | "STEP_05_FULL_SCRIPT_BUILD"
  | "STEP_04_05_COMBINED"
  | "STEP_06_VISUAL_BIBLE";          // ← 追加
```

### 4.2 `VisualBibleCategory`（新規）

```typescript
/** 05_Visual_Bible の category 固定 enum（スキーマと同期） */
export type VisualBibleCategory =
  | "character"
  | "background"
  | "color_theme"
  | "lighting"
  | "style_global"
  | "avoid";
```

### 4.3 `VisualBibleAiRow`（AI 出力用・新規）

```typescript
/**
 * STEP_06 Visual Bible — AI が返す 1 element 分の row
 * スキーマ: visual_bible_schema_ai_v1.json
 *
 * record_id は AI 出力に含めない（システム側で採番: PJT-001-VB-001 形式）。
 * scene_no は含めない（論点C: Visual Bible は scene と切り離したプロジェクト辞書）。
 */
export interface VisualBibleAiRow {
  category:         VisualBibleCategory;  // 固定 enum
  key_name:         string;               // AI が自由記述（例: "桃太郎", "川辺", "全体配色"）
  description:      string;               // 要素の概要・役割説明
  color_palette:    string;               // 色指定（空文字可）
  line_style:       string;               // 線・タッチのスタイル（空文字可）
  lighting:         string;               // 照明・明暗指定（空文字可）
  composition_rule: string;               // 構図・フレーミングルール（空文字可）
  crop_rule:        string;               // クロップ・トリミングルール（空文字可）
  expression_rule:  string;               // 表情・動きの表現ルール（空文字可）
  character_rule:   string;               // キャラクターデザインルール（空文字可）
  background_rule:  string;               // 背景描写ルール（空文字可）
  avoid_rule:       string;               // 禁止表現・回避要素（空文字可）
  reference_note:   string;               // 参考メモ・補足（空文字可）
  [key: string]: unknown;                 // matchAiOutput 互換
}
```

### 4.4 `VisualBibleRow`（GSS 書き込み用・新規）

```typescript
/**
 * Google Sheets 05_Visual_Bible 書き込み行（visual_bible_schema_full_v1）
 *
 * record_id はシステム側で採番する（形式: PJT-001-VB-001）。
 * upsert キー: record_id 単体（シート名固定で一意性を担保）。
 * 再実行時は既存行を record_id で上書き UPDATE する。
 */
export interface VisualBibleRow extends VisualBibleAiRow {
  project_id:        string;
  record_id:         string;   // システム採番: {project_id}-VB-{index:03d}
  generation_status: "GENERATED" | "FAILED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;   // 固定: "STEP_06_VISUAL_BIBLE"
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}
```

### 4.5 `VisualBibleReadRow`（05_Visual_Bible 読み込み用・新規）

```typescript
/** 05_Visual_Bible から読み込む参照用 row（再実行時の既存行取得用） */
export interface VisualBibleReadRow {
  project_id:  string;
  record_id:   string;
  category:    string;
  key_name:    string;
}
```

---

## 5. モジュール設計

### 5.1 `src/lib/write-visual-bible.ts`（新規）

```
upsertVisualBible(spreadsheetId, row: VisualBibleRow): Promise<string>  // returns record_id
```

- シート名: `05_Visual_Bible`（定数固定）
- upsert キー: `record_id`
- UPDATE: 既存 `record_id` 一致行を上書き
- INSERT: 末尾次の空行に挿入
- STEP_04/05 の `write-script-full.ts` と同一パターン

#### 書き込み列順（GSS 05_Visual_Bible ヘッダー順）

```typescript
const VISUAL_BIBLE_HEADERS: Array<Extract<keyof VisualBibleRow, string>> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "category",
  "key_name",
  "description",
  "color_palette",
  "line_style",
  "lighting",
  "composition_rule",
  "crop_rule",
  "expression_rule",
  "character_rule",
  "background_rule",
  "avoid_rule",
  "reference_note",
  "updated_at",
  "updated_by",
  "notes",
];
```

### 5.2 `src/lib/load-visual-bible.ts`（新規）

```
loadVisualBibleByProjectId(spreadsheetId, projectId): Promise<VisualBibleReadRow[]>
```

- `05_Visual_Bible` シートを全行読み込み、`project_id` が一致する行を返す
- `generation_status = "GENERATED"` の行のみ返す
- 再実行時の record_id 採番継続に使用する
- 0 件の場合は空配列（初回実行では正常）

### 5.3 `src/lib/build-prompt.ts`（追記）

```
buildStep06Prompt(assets: Step06Assets, project: ProjectRow, scenes: SceneReadRow[]): string
```

- `visual_bible_prompt_v1.md` テンプレートを読み込み、プレースホルダーを置換
- `INPUT_DATA` に以下を JSON 注入:
  - `project_id`, `title_jp`, `target_age`, `visual_style`, `adaptation_policy`
  - `scenes`: `video_format` に応じてフィルタ済みの scene 配列
    - 各 scene から: `scene_no`, `chapter`, `scene_title`, `scene_summary`, `visual_focus`, `emotion`
    - `difficult_words` / `easy_rewrite` / `narration_*` は含めない（論点3: 02_Scenes のみ）

### 5.4 `src/lib/load-assets.ts`（追記）

```typescript
export interface Step06Assets {
  promptTemplate: string;  // visual_bible_prompt_v1.md の文字列
  aiSchema:       string;  // visual_bible_schema_ai_v1.json の文字列
  fullSchema:     string;  // visual_bible_schema_full_v1.json の文字列
}

export function loadStep06Assets(): Step06Assets
```

### 5.5 `src/lib/call-gemini.ts`（追記）

```typescript
export function buildGeminiOptionsStep06(configMap: RuntimeConfigMap): GeminiCallOptions
```

- Runtime Config キー: `step_06_model_role`（未設定時は `model_role_text_pro` にフォールバック）
- `maxOutputTokens`: 呼び出し側で `32768` を指定

---

## 6. オーケストレーター設計（`src/steps/step06-visual-bible.ts`）

### 6.1 処理フロー

```
export async function runStep06VisualBible(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void>
```

```
for each projectId in payload.project_ids:

  1. loadRuntimeConfig()
  2. readProjectsByIds() → ProjectRow
  3. video_format を取得（"short" | "full" | "short+full"）
     → 不正値: buildStep06PreflightFailureLog(invalid_video_format) + 次 project へ

  4. loadScenesByProjectId() → SceneReadRow[]（全 scene）
     → 失敗: buildStep06PreflightFailureLog(load_scenes_failure) + 次 project へ
     → 0 件: buildStep06PreflightFailureLog(no_scenes) + 次 project へ

  5. video_format に応じて対象 scene をフィルタ:
     "full"       → targetScenes = scenes.filter(full_use = "Y")
     "short"      → targetScenes = scenes.filter(short_use = "Y")
     "short+full" → targetScenes = scenes.filter(full_use = "Y")（包括的）
     → targetScenes が 0 件: buildStep06PreflightFailureLog(no_target_scenes) + 次 project へ

  ─── STEP_06 Visual Bible Build ──────────────────────────
  6.  step06Assets = loadStep06Assets()
  7.  buildStep06Prompt(step06Assets, project, targetScenes) でプロンプト組み立て

  8.  callGemini(prompt, { ...geminiOptionsStep06, maxOutputTokens: 32768 })

  9.  validateVisualBibleAiResponse(text, step06Assets.aiSchema)
      → 0 件: validation fail
      → category 不正値: スキーマ検証で fail
      → 必須フィールド空文字: validation fail

  10. record_id 採番:
      既存行取得: loadVisualBibleByProjectId() → existingRows
      既存行数 N を取得。
      - 新規 AI 出力の i 番目 (0-indexed):
          i < N の場合: record_id = existingRows[i].record_id（既存 ID を再利用）
          i >= N の場合: record_id = `${projectId}-VB-${String(N + i - N + 1).padStart(3, "0")}`
                       = `${projectId}-VB-${String(i + 1).padStart(3, "0")}` (初回の場合)

      ⚠️ 再実行時に AI 出力件数が減少した場合、余剰の既存行は残置する（DELETE 禁止）。
         余剰行の generation_status は "GENERATED" のまま残る（手動管理）。

  11. for each { ai, record_id } of matched:
        VisualBibleRow を組み立て、upsertVisualBible()

  12. 00_Project を最小更新（current_step = "STEP_06_VISUAL_BIBLE"）

  13. buildStep06SuccessLog() → appendAppLog()
```

### 6.2 `record_id` 採番ロジック詳細

```typescript
function assignVisualBibleRecordIds(
  projectId: string,
  aiRows: VisualBibleAiRow[],
  existingRows: VisualBibleReadRow[]
): Array<{ ai: VisualBibleAiRow; record_id: string }> {
  return aiRows.map((ai, i) => {
    // 既存行が存在する場合は既存 record_id を再利用（インデックス順で突合）
    const record_id = existingRows[i]?.record_id
      ?? `${projectId}-VB-${String(i + 1).padStart(3, "0")}`;
    return { ai, record_id };
  });
}
```

> STEP_04/05 と異なり、`record_id` は 02_Scenes 由来ではなくシステムが採番するため、
> `matchAiOutputToScenes` は使用しない（record_id 突合ではなくインデックス順で対応）。

---

## 7. INPUT_DATA 仕様

### 7.1 プロンプトへの注入データ（`scenes` 配列）

```jsonc
{
  "project_id": "PJT-001",
  "title_jp": "桃太郎",
  "target_age": "4-6",
  "visual_style": "やわらかい水彩絵本風、明るい色調",
  "adaptation_policy": "現代語・現代設定で子ども向けに脚色",
  "video_format": "short+full",
  "scenes": [
    {
      "scene_no": "1",
      "chapter": "導入",
      "scene_title": "大きな桃が川から流れてくる",
      "scene_summary": "おじいさんが山へ、おばあさんが川へ洗濯に行く。川に大きな桃がどんぶらこと流れてくる。",
      "visual_focus": "大きな桃と驚くおばあさん",
      "emotion": "ふしぎ、わくわく"
    }
    // ... 他 scene
  ]
}
```

**含めないフィールド**（論点3）:
- `narration_draft` / `narration_tts` / `subtitle_*`（Script 系）
- `difficult_words` / `easy_rewrite`（STEP_03 補助情報）
- `est_duration_*`（尺情報）

### 7.2 AI 出力フォーマット

```jsonc
{
  "visual_bible": [
    {
      "category": "character",
      "key_name": "桃太郎",
      "description": "本作品の主人公。明るく勇敢な男の子。",
      "color_palette": "赤・白・青（着物の配色）。肌色は温かみのある淡橙色。",
      "line_style": "柔らかい輪郭線。水彩絵本タッチ。",
      "lighting": "",
      "composition_rule": "画面中央〜やや右寄りに配置。視線は進行方向へ。",
      "crop_rule": "バストアップ〜全身。感情表現シーンはクローズアップ可。",
      "expression_rule": "豊かな表情。驚き・笑顔・真剣さを使い分ける。",
      "character_rule": "着物スタイル。腰に「桃」マークの巾着。",
      "background_rule": "",
      "avoid_rule": "暗い表情・恐怖を煽る描写は避ける。",
      "reference_note": ""
    },
    {
      "category": "color_theme",
      "key_name": "全体配色",
      "description": "作品全体の色調方針。",
      "color_palette": "メインカラー: 桃色・空色・若草色。アクセント: 金黄色。",
      "line_style": "水彩にじみを活かす。輪郭線は細め。",
      "lighting": "柔らかい自然光。過度なコントラストは避ける。",
      "composition_rule": "",
      "crop_rule": "",
      "expression_rule": "",
      "character_rule": "",
      "background_rule": "",
      "avoid_rule": "彩度の高いビビッドカラー・蛍光色は使用禁止。",
      "reference_note": "ターゲット年齢 4-6 歳向け。やわらかく温かみのある印象を保つこと。"
    }
    // ... 他 visual elements
  ]
}
```

---

## 8. スキーマ設計

### 8.1 `schemas/visual_bible_schema_ai_v1.json`（AI 出力バリデーション用）

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VisualBibleAiResponse",
  "type": "object",
  "required": ["visual_bible"],
  "properties": {
    "visual_bible": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["category", "key_name", "description"],
        "properties": {
          "category": {
            "type": "string",
            "enum": ["character", "background", "color_theme", "lighting", "style_global", "avoid"]
          },
          "key_name":         { "type": "string", "minLength": 1 },
          "description":      { "type": "string", "minLength": 1 },
          "color_palette":    { "type": "string" },
          "line_style":       { "type": "string" },
          "lighting":         { "type": "string" },
          "composition_rule": { "type": "string" },
          "crop_rule":        { "type": "string" },
          "expression_rule":  { "type": "string" },
          "character_rule":   { "type": "string" },
          "background_rule":  { "type": "string" },
          "avoid_rule":       { "type": "string" },
          "reference_note":   { "type": "string" }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

**必須フィールドの空文字チェック**（バリデーター追加チェック）:
- `category`, `key_name`, `description` は `minLength: 1` でスキーマ側が保証
- 他フィールドは空文字可（`string` 型のみ強制）

### 8.2 `schemas/visual_bible_schema_full_v1.json`（GSS 書き込み行バリデーション用）

AI 出力スキーマをベースに、システム付与フィールドを追加したフルスキーマ。
`project_id`, `record_id`, `generation_status`, `approval_status`, `step_id`,
`updated_at`, `updated_by`, `notes` を追加 required とする。

---

## 9. バリデーション設計（`src/lib/validate-json.ts` 追記）

```typescript
export interface VisualBibleValidationResult {
  success: true;
  items: VisualBibleAiRow[];
}

export interface VisualBibleValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}

export type ValidateVisualBibleResult =
  | VisualBibleValidationResult
  | VisualBibleValidationFailure;

export function validateVisualBibleAiResponse(
  rawText: string,
  schema: string
): ValidateVisualBibleResult
```

**バリデーション手順**:
1. `extractJson()` で JSON ブロック抽出
2. `JSON.parse()`
3. AJV スキーマ検証（`visual_bible_schema_ai_v1.json`）
4. `response.visual_bible.length === 0` → fail
5. 各要素の `category` が enum 内であることはスキーマが保証済み
6. `key_name` / `description` の空文字チェックはスキーマ（`minLength: 1`）が保証済み

> STEP_04/05 と異なり `expectedCount` による件数チェックは不要（AI が判断した件数を受け入れる）。

---

## 10. ログ設計（`src/lib/write-app-log.ts` 追記）

| ビルダー関数 | `step_id` | `level` | 用途 |
|---|---|---|---|
| `buildStep06SuccessLog(projectId, recordId, msg)` | `STEP_06_VISUAL_BIBLE` | `INFO` | 正常完了 |
| `buildStep06FailureLog(projectId, recordId, reason, msg)` | `STEP_06_VISUAL_BIBLE` | `ERROR` | 失敗（validation / upsert 等） |
| `buildStep06PreflightFailureLog(projectId, recordId, reason, msg)` | `STEP_06_VISUAL_BIBLE` | `ERROR` | 前処理失敗（scene 取得失敗等） |

---

## 11. エラーハンドリング設計

| ケース | 処理 |
|---|---|
| `video_format` 不正値 | `buildStep06PreflightFailureLog(invalid_video_format)` → 次 project へ |
| `02_Scenes` 読み込み失敗 | `buildStep06PreflightFailureLog(load_scenes_failure)` → 次 project へ |
| 対象 scene 0 件 | `buildStep06PreflightFailureLog(no_target_scenes)` → 次 project へ |
| Gemini API エラー（SpendingCap） | throw `GeminiSpendingCapError`（全 project 停止） |
| Gemini API エラー（その他） | `buildStep06FailureLog(gemini_error)` → 次 project へ |
| スキーマ validation 失敗 | `buildStep06FailureLog(schema_validation_failure)` → upsert しない |
| `upsertVisualBible` 失敗 | 失敗行のみ `buildStep06FailureLog` 記録。成功行は確定 |
| 予期しない例外 | `buildStep06FailureLog(unexpected_error)` → 次 project へ |

---

## 12. プロンプト設計（`prompts/visual_bible_prompt_v1.md`）

### 構成

```
[ロール定義]
あなたは「童話動画制作プロジェクト」における STEP_06 Visual Bible Build を担当するビジュアルデザイン支援AIです。

[タスク説明]
scene master (02_Scenes) をもとに、動画全体の視覚的一貫性を担保する「ビジュアル設計辞書」を生成してください。
生成した JSON のみを返してください。

[category ガイド]
各 category の定義と、key_name / 各フィールドの記述方針を説明するフィールドガイド

[制約]
- category は指定の enum のみ使用すること
- record_id は返さないこと
- 1 プロジェクトにつき必要十分な要素を過不足なく列挙すること
- 全ての場面に登場するキャラクター・背景・色方針は必ず定義すること

[INPUT_DATA]
{{PROJECT_JSON}}

[出力フォーマット]
{ "visual_bible": [ { ... }, ... ] }
```

---

## 13. 実装フェーズ（参考）

| Phase | 内容 |
|---|---|
| 1 | `src/types.ts` に型追加（`VisualBibleCategory`, `VisualBibleAiRow`, `VisualBibleRow`, `VisualBibleReadRow`） |
| 2 | `StepId` に `STEP_06_VISUAL_BIBLE` 追加 |
| 3 | `schemas/visual_bible_schema_ai_v1.json` 作成 |
| 4 | `schemas/visual_bible_schema_full_v1.json` 作成 |
| 5 | `examples/visual_bible_ai_response_example_v1.json` 作成 |
| 6 | `prompts/visual_bible_prompt_v1.md` 作成 |
| 7 | `src/lib/validate-json.ts` に `validateVisualBibleAiResponse()` 追記 |
| 8 | `src/lib/write-app-log.ts` にログビルダー追記 |
| 9 | `src/lib/write-visual-bible.ts` 作成 |
| 10 | `src/lib/load-visual-bible.ts` 作成 |
| 11 | `src/lib/load-assets.ts` に `loadStep06Assets()` 追記 |
| 12 | `src/lib/build-prompt.ts` に `buildStep06Prompt()` 追記 |
| 13 | `src/lib/call-gemini.ts` に `buildGeminiOptionsStep06()` 追記 |
| 14 | `src/steps/step06-visual-bible.ts` 作成（オーケストレーター） |
| 15 | `src/index.ts` に STEP_06 ルーティング追加 |
| 16 | `npm run typecheck` → `npm run build` 確認 |
| 17 | `npm run dry-run:step06` 動作確認 |

---

## 14. 未決定事項・今後の検討

| # | 事項 | 備考 |
|---|---|---|
| 未定1 | `05_Visual_Bible` GSS ヘッダー行の列順確認 | `docs/GSS_field_master.tsv` と本書 §5.1 を照合して確定すること |
| 未定2 | `step_06_model_role` の Runtime Config 登録 | `94_Runtime_Config` シートへの初期値投入が必要 |
| 未定3 | 再実行時に件数減少した余剰行の運用 | 現状は残置（手動管理）。将来的に `generation_status = "DEPRECATED"` 等への更新を検討 |
| 未定4 | `dry-run:step06` スクリプト | `src/scripts/dry-run-step06.ts` の実装は Phase 17 で対応 |

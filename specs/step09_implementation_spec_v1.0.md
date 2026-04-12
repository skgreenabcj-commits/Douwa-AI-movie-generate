# STEP_09 Q&A Build 実装設計書 v1.0

> **ステータス**: 確定（オーナー判断反映済み 2026-04-12）
> **改訂履歴**:
> - v1.0 (2026-04-12): 初版（論点1〜5 のオーナー判断反映版）
> **元仕様**: `docs/02_process_flow.md`、`docs/GSS_field_master.tsv`
> **前提実装**: STEP_01〜06 のコードパターンを継承する

---

## 1. 本書の目的

STEP_09 Q&A Build の実装設計を定義する。

Q&A は児童向け動画の視聴後に提供する理解度チェック用設問であり、
`02_Scenes` の `qa_seed` / `scene_summary` を入力として Gemini が生成する。
生成結果は `10_QA` シートに格納され、STEP_10 の品質チェック対象となる。

---

## 2. 確定した設計判断

| # | 論点 | 判断 | 実装への影響 |
|---|---|---|---|
| 論点1 | インプットデータ | **`02_Scenes` のみ**（Script は参照しない） | `qa_seed` / `scene_summary` / `scene_no` / `scene_title` / `chapter` / `emotion` / `short_use` / `full_use` を使用 |
| 論点2 | 生成数 | **Full: 10問 / Short: 3〜10問** | Full は fixed 10問。Short は short_use=Y シーン数に依存し最小3問 |
| 論点3 | Short QA の生成戦略 | **Full QA をコンテキストとして渡し、Short 用に再生成** | Gemini 呼び出しを Full → Short の順で実施。Short 生成時に Full QA を参照情報として提供 |
| 論点4 | `video_format` との関係 | **video_format に応じてフレキシブル** | `full` → Full QA のみ。`short` → Short QA のみ。`short+full` → Full → Short の順に各1回呼び出し |
| 論点5 | `record_id` 採番 | **通し採番**（`PJT-001-QA-001` 形式） | Full QA が先（001〜）、Short QA が後続採番。既存行はインデックス順に再利用 |

### `qa_type` 固定 enum

| 値 | 意味 | 例（桃太郎） |
|---|---|---|
| `comprehension` | 内容理解（何が起きたか） | 「桃の中から何が出てきたの？」 |
| `emotion` | 気持ち・感情 | 「おばあさんはどんな気持ちだったかな？」 |
| `vocabulary` | 語彙・言葉の意味 | 「"退治"ってどういう意味かな？」 |
| `moral` | 学び・教訓 | 「この話から何を学んだかな？」 |

### `current_step` 設定値

| 実行状態 | `current_step` 値 |
|---|---|
| 成功（Full or Short いずれか1つ以上） | `STEP_09_QA_BUILD` |
| 失敗 | 更新しない |

---

## 3. ファイル構成（新規作成対象）

```
src/
  steps/
    step09-qa-build.ts              # オーケストレーター

  lib/
    write-qa.ts                     # 10_QA upsert
    load-qa.ts                      # 10_QA 読み込み（再実行時の既存行取得）

prompts/
  qa_prompt_v1.md                   # STEP_09 プロンプトテンプレート

schemas/
  qa_schema_ai_v1.json              # AI 出力バリデーション用スキーマ
  qa_schema_full_v1.json            # GSS 書き込み行バリデーション用スキーマ

examples/
  qa_ai_response_example_v1.json    # AI 出力サンプル（桃太郎 / Full 10問）
  qa_full_response_example_v1.json  # GSS 書き込み行サンプル（抜粋）
```

### 既存ファイルへの追記対象

```
src/
  types.ts                          # QaAiRow / QaRow / QaReadRow / QaVersion 追加
  index.ts                          # STEP_09 ルーティング追加

  lib/
    load-assets.ts                  # loadStep09Assets() 追加
    build-prompt.ts                 # buildStep09FullPrompt() / buildStep09ShortPrompt() 追加
    call-gemini.ts                  # buildGeminiOptionsStep09() 追加
    validate-json.ts                # validateQaAiResponse() 追加
    write-app-log.ts                # buildStep09SuccessLog() / buildStep09FailureLog() 追加
```

---

## 4. 処理フロー（オーケストレーター）

```
1. 00_Project から ProjectRow を取得
2. video_format を検証（"full" | "short" | "short+full"）
3. 02_Scenes から全 scene を取得（generation_status = "GENERATED"）
4. video_format に応じて以下を実行:

   [full or short+full の場合]
   4a-1. full_use=Y の scene をフィルタ
   4a-2. Full QA プロンプトを組み立て Gemini 呼び出し（最大10問）
   4a-3. AJV スキーマ検証
   4a-4. 10_QA に upsert（related_version="full"）

   [short or short+full の場合]
   4b-1. short_use=Y の scene をフィルタ
   4b-2. Short QA プロンプトを組み立て（Full QA 結果も参照情報として含める）
   4b-3. Gemini 呼び出し（3〜10問）
   4b-4. AJV スキーマ検証
   4b-5. 10_QA に upsert（related_version="short"）

   ※ short+full の場合、Full が失敗したら Short もスキップ（依存関係あり）

5. 00_Project を最小更新（current_step = STEP_09_QA_BUILD）
6. 100_App_Logs にログ記録
```

---

## 5. record_id 採番方針

- 採番形式: `{project_id}-QA-{seq:03d}`（例: `PJT-001-QA-001`）
- Full QA が先に採番（例: 001〜010）、Short QA が後続（例: 011〜020）
- 再実行時: 既存行の `record_id` をインデックス順で再利用
- AI 出力件数 > 既存行件数の場合: 超過分は新規採番
- AI 出力件数 < 既存行件数の場合: 余剰の既存行は残置（DELETE 禁止）

---

## 6. GSS フィールドマッピング

| フィールド | role | 値の設定元 |
|---|---|---|
| `project_id` | SYSTEM_CONTROL | オーケストレーターがセット |
| `record_id` | SYSTEM_CONTROL | `{project_id}-QA-{seq:03d}` |
| `generation_status` | SYSTEM_CONTROL | `"GENERATED"` 固定 |
| `approval_status` | HUMAN_REVIEW | `"PENDING"` 固定 |
| `step_id` | SYSTEM_CONTROL | `"STEP_09_QA_BUILD"` 固定 |
| `qa_no` | SYSTEM_CONTROL | バージョン内の連番（1〜） |
| `related_version` | SYSTEM_CONTROL | `"full"` or `"short"` |
| `qa_type` | AI_OUTPUT | Gemini 出力（enum 制約あり） |
| `question` | AI_OUTPUT | Gemini 出力 |
| `answer_short` | AI_OUTPUT | Gemini 出力 |
| `answer_narration` | AI_OUTPUT | Gemini 出力 |
| `subtitle` | AI_OUTPUT | Gemini 出力 |
| `updated_at` | SYSTEM_CONTROL | `new Date().toISOString()` |
| `updated_by` | SYSTEM_CONTROL | `"github_actions"` 固定 |
| `notes` | HUMAN_REVIEW | `""` 固定（手動入力用） |

> `card_visual` / `duration_sec` / `learning_goal` は **UNUSED**（GSS に書き込まない）

---

## 7. AI 出力スキーマ（概要）

**Full QA レスポンス:**
```json
{
  "qa": [
    {
      "qa_type": "comprehension",
      "question": "桃の中から何が出てきたの？",
      "answer_short": "男の子",
      "answer_narration": "桃の中から元気な男の子が飛び出してきたんだよ。",
      "subtitle": "桃から生まれた男の子"
    }
  ]
}
```

**Short QA レスポンス:** 同一構造。`minItems: 3` / `maxItems: 10`

詳細は `schemas/qa_schema_ai_v1.json` を参照。

---

## 8. Gemini 設定

| 設定 | 値 |
|---|---|
| primary model | `gemini-2.5-flash`（`94_Runtime_Config` key: `step_09_model_role`） |
| fallback model | `model_role_text_flash`（`94_Runtime_Config` 同名キー） |
| `maxOutputTokens` | `8192` |

> `buildGeminiOptionsStep09()` を `src/lib/call-gemini.ts` に追加する。

---

## 9. エラーハンドリング方針

| エラー種別 | 挙動 |
|---|---|
| project not found | `100_App_Logs` にエラー記録。当該 project をスキップ |
| video_format 不正 | 同上 |
| scenes 0件（full_use=Y または short_use=Y） | 同上 |
| Gemini 呼び出し失敗 | 同上 |
| スキーマ検証失敗 | 同上 |
| upsert 失敗（行単位） | 失敗行のみ記録。成功行は確定 |
| short+full で Full 失敗 | Short もスキップ（依存関係）。両方をエラー記録 |
| GeminiSpendingCapError | 全プロジェクト停止（上位に throw） |

---

## 10. dry-run スクリプト

`src/scripts/dry-run-step09.ts` を追加する（実装フェーズで作成）。
- `DRY_RUN=true`: プロンプトアセンブルのみ（Gemini 呼び出しなし）
- `DRY_RUN=false`: Gemini 呼び出し + スキーマ検証（GSS 書き込みなし）
- モック: `PJT-001`（桃太郎）を使用

---

## 11. 型定義設計（`src/types.ts` 追記）

### 11.1 `StepId`（更新）

```typescript
export type StepId =
  | "STEP_01_RIGHTS_VALIDATION"
  | "STEP_02_SOURCE_BUILD"
  | "STEP_03_SCENES_BUILD"
  | "STEP_04_SHORT_SCRIPT_BUILD"
  | "STEP_05_FULL_SCRIPT_BUILD"
  | "STEP_06_VISUAL_BIBLE"
  | "STEP_09_QA_BUILD";   // ← 追加
```

### 11.2 `QaType`（新規）

```typescript
/** 10_QA の qa_type 固定 enum（スキーマと同期） */
export type QaType = "comprehension" | "emotion" | "vocabulary" | "moral";
```

### 11.3 `QaVersion`（新規）

```typescript
/** 10_QA の related_version 固定 enum */
export type QaVersion = "full" | "short";
```

### 11.4 `QaAiRow`（AI 出力用・新規）

```typescript
/**
 * STEP_09 Q&A Build — AI が返す 1 設問分の row
 * スキーマ: qa_schema_ai_v1.json
 *
 * record_id / qa_no / related_version は AI 出力に含めない（システム側で付与）。
 */
export interface QaAiRow {
  qa_type:          QaType;  // 固定 enum
  question:         string;  // 設問文
  answer_short:     string;  // 短い答え（1〜2語）
  answer_narration: string;  // 解説文（30〜60字）
  subtitle:         string;  // カード見出し（10〜20字）
}
```

### 11.5 `QaRow`（GSS 書き込み用・新規）

```typescript
/**
 * Google Sheets 10_QA 書き込み行（qa_schema_full_v1）
 *
 * record_id はシステム側で採番する（形式: PJT-001-QA-001）。
 * upsert キー: record_id 単体。
 * UNUSED フィールド（card_visual / duration_sec / learning_goal）は "" で書き込む。
 */
export interface QaRow extends QaAiRow {
  project_id:        string;
  record_id:         string;       // システム採番: {project_id}-QA-{seq:03d}
  generation_status: "GENERATED" | "FAILED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;       // 固定: "STEP_09_QA_BUILD"
  qa_no:             number;       // バージョン内の連番（1〜）
  related_version:   QaVersion;    // "full" | "short"
  card_visual:       "";           // UNUSED: 常に空文字
  duration_sec:      "";           // UNUSED: 常に空文字
  learning_goal:     "";           // UNUSED: 常に空文字
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}
```

### 11.6 `QaReadRow`（10_QA 読み込み用・新規）

```typescript
/** 10_QA から読み込む参照用 row（再実行時の既存行取得用） */
export interface QaReadRow {
  project_id:      string;
  record_id:       string;
  related_version: QaVersion;
}
```

---

## 12. モジュール設計

### 12.1 `src/lib/write-qa.ts`（新規）

```
upsertQa(spreadsheetId, row: QaRow): Promise<string>  // returns record_id
```

- シート名: `10_QA`（定数固定）
- upsert キー: `record_id`
- UPDATE: 既存 `record_id` 一致行を上書き
- INSERT: 末尾次の空行に挿入

#### 書き込み列順（GSS 10_QA ヘッダー順）

```typescript
const QA_HEADERS: Array<Extract<keyof QaRow, string>> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "qa_no",
  "related_version",
  "qa_type",
  "question",
  "answer_short",
  "answer_narration",
  "subtitle",
  "card_visual",
  "duration_sec",
  "learning_goal",
  "updated_at",
  "updated_by",
  "notes",
];
```

### 12.2 `src/lib/load-qa.ts`（新規）

```
loadQaByProjectId(spreadsheetId, projectId): Promise<QaReadRow[]>
```

- `10_QA` シートを全行読み込み、`project_id` が一致する行を返す
- `generation_status = "GENERATED"` の行のみ返す
- 再実行時の record_id 採番継続に使用する
- 0 件の場合は空配列（初回実行では正常）
- `related_version` でフィルタリングして Full / Short 別に取得可能

### 12.3 `src/lib/build-prompt.ts`（追記）

```typescript
buildStep09FullPrompt(
  assets: Step09Assets,
  project: ProjectRow,
  scenes: SceneReadRow[]
): string

buildStep09ShortPrompt(
  assets: Step09Assets,
  project: ProjectRow,
  scenes: SceneReadRow[],
  fullQaRows: QaAiRow[]   // Full QA 結果を参照コンテキストとして渡す
): string
```

- `qa_prompt_v1.md` テンプレートを読み込み、`{{INPUT_DATA}}` を置換
- `INPUT_DATA` に以下を JSON 注入（§13 参照）

### 12.4 `src/lib/load-assets.ts`（追記）

```typescript
export interface Step09Assets {
  promptTemplate: string;  // qa_prompt_v1.md の文字列
  aiSchema:       string;  // qa_schema_ai_v1.json の文字列
  fullSchema:     string;  // qa_schema_full_v1.json の文字列
}

export function loadStep09Assets(): Step09Assets
```

### 12.5 `src/lib/call-gemini.ts`（追記）

```typescript
export function buildGeminiOptionsStep09(configMap: RuntimeConfigMap): GeminiCallOptions
```

- Runtime Config キー: `step_09_model_role`（未設定時は `model_role_text_flash` にフォールバック）
- default primary model: `gemini-2.5-flash`
- `maxOutputTokens`: 呼び出し側で `8192` を指定

### 12.6 `src/lib/write-app-log.ts`（追記）

```typescript
export function buildStep09SuccessLog(
  projectId: string,
  recordId: string,
  message: string
): AppLogRow

export function buildStep09FailureLog(
  projectId: string,
  recordId: string,
  errorType: string,
  message: string
): AppLogRow
```

- `current_step`: `"STEP_09_QA_BUILD"` 固定
- 成功ログ: `[INFO][success] {message}`
- 失敗ログ: `[ERROR][{errorType}] {message}`

---

## 13. INPUT_DATA 仕様

### 13.1 Full QA プロンプトへの注入データ

```jsonc
{
  "project_id": "PJT-001",
  "title_jp": "桃太郎",
  "target_age": "4-6",
  "video_format": "short+full",
  "version": "full",
  "target_question_count": 10,
  "scenes": [
    {
      "scene_no": "1",
      "chapter": "導入",
      "scene_title": "大きな桃が川から流れてくる",
      "scene_summary": "おじいさんが山へ、おばあさんが川へ洗濯に行く。川に大きな桃がどんぶらこと流れてくる。",
      "emotion": "驚き・期待",
      "qa_seed": "桃が流れてきた理由、おばあさんの反応"
    }
    // ... full_use=Y の全 scene
  ]
}
```

### 13.2 Short QA プロンプトへの注入データ

Full と同一構造に加え、`reference_full_qa` を追加する:

```jsonc
{
  "project_id": "PJT-001",
  "title_jp": "桃太郎",
  "target_age": "4-6",
  "video_format": "short+full",
  "version": "short",
  "target_question_count": 10,
  "min_question_count": 3,
  "scenes": [
    // short_use=Y の scene のみ
  ],
  "reference_full_qa": [
    // Full で生成した QaAiRow[] をそのまま渡す
    {
      "qa_type": "comprehension",
      "question": "桃の中から何が出てきたかな？",
      "answer_short": "男の子",
      "answer_narration": "...",
      "subtitle": "桃から生まれた子"
    }
    // ...
  ]
}
```

---

## 14. 100_App_Logs Upsert 仕様

### 14.1 ログ記録タイミング

| タイミング | ログ種別 | `error_type` | メッセージ例 |
|---|---|---|---|
| project not found | FAILURE | `project_not_found` | `Project PJT-001 not found` |
| video_format 不正 | FAILURE | `invalid_video_format` | `Invalid video_format: undefined` |
| scenes 0件（full_use=Y） | FAILURE | `no_full_scenes` | `No full_use=Y scenes for PJT-001` |
| scenes 0件（short_use=Y） | FAILURE | `no_short_scenes` | `No short_use=Y scenes for PJT-001` |
| Gemini 呼び出し失敗 | FAILURE | `gemini_call_failed` | `Gemini error: {error.message}` |
| スキーマ検証失敗 | FAILURE | `schema_validation_failed` | `AJV: {errors[0].message}` |
| upsert 失敗（行単位） | FAILURE | `upsert_failed` | `Failed to upsert QA record_id: PJT-001-QA-003` |
| Full 失敗による Short スキップ | FAILURE | `short_skipped_due_to_full_failure` | `Short QA skipped: Full QA failed` |
| Full QA 生成成功 | SUCCESS | — | `STEP_09 Full QA generated: 10 rows for PJT-001` |
| Short QA 生成成功 | SUCCESS | — | `STEP_09 Short QA generated: 7 rows for PJT-001` |

### 14.2 `record_id` の扱い

- 成功ログ: 最後に書き込んだ `record_id`（例: `PJT-001-QA-010`）
- 失敗ログ: エラー発生時点の `project_id`（例: `PJT-001`）。行レベルのエラーは対象 `record_id`

### 14.3 呼び出しパターン

```typescript
// 成功時（Full）
await appendAppLog(spreadsheetId,
  buildStep09SuccessLog(projectId, lastRecordId,
    `STEP_09 Full QA generated: ${fullRows.length} rows for ${projectId}`
  )
);

// 失敗時
await appendAppLog(spreadsheetId,
  buildStep09FailureLog(projectId, projectId, "gemini_call_failed",
    `Gemini error: ${error.message}`
  )
);
```

---

## 15. オーケストレーター設計詳細（`src/steps/step09-qa-build.ts`）

```typescript
export async function runStep09QaBuild(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void>
```

```
for each projectId in payload.project_ids:

  1. loadRuntimeConfig()
  2. readProjectsByIds() → ProjectRow
     → 失敗 / 0件: buildStep09FailureLog(project_not_found) + 次 project へ

  3. video_format を取得（"short" | "full" | "short+full"）
     → 不正値: buildStep09FailureLog(invalid_video_format) + 次 project へ

  4. loadScenesByProjectId() → SceneReadRow[]
     → 失敗: buildStep09FailureLog(load_scenes_failure) + 次 project へ
     → 0件: buildStep09FailureLog(no_scenes) + 次 project へ

  5. step09Assets = loadStep09Assets()
  6. geminiOptions = buildGeminiOptionsStep09(runtimeConfig)

  ─── Full QA Build（video_format = "full" or "short+full"）───────────
  7. fullScenes = scenes.filter(s => s.full_use === "Y")
     → 0件: buildStep09FailureLog(no_full_scenes) + Full スキップ
     ※ short+full では Short もスキップ

  8. prompt = buildStep09FullPrompt(step09Assets, project, fullScenes)
  9. callGemini(prompt, { ...geminiOptions, maxOutputTokens: 8192 })
     → 失敗: buildStep09FailureLog(gemini_call_failed) + Full スキップ
     ※ short+full では Short もスキップ

  10. validateQaAiResponse(text, step09Assets.aiSchema)
      → 失敗: buildStep09FailureLog(schema_validation_failed) + Full スキップ
      ※ short+full では Short もスキップ

  11. record_id 採番（Full）:
      existingFullRows = loadQaByProjectId().filter(r => r.related_version === "full")
      aiRows[i] → existingFullRows[i]?.record_id ?? `${projectId}-QA-${i+1:03d}`

  12. for each { aiRow, record_id, qa_no } of fullQaRows:
        QaRow を組み立て → upsertQa()
        → 失敗: buildStep09FailureLog(upsert_failed, record_id) + 次行へ

  13. buildStep09SuccessLog(full) → appendAppLog()

  ─── Short QA Build（video_format = "short" or "short+full"）──────────
  14. shortScenes = scenes.filter(s => s.short_use === "Y")
      → 0件: buildStep09FailureLog(no_short_scenes) + Short スキップ

  15. prompt = buildStep09ShortPrompt(step09Assets, project, shortScenes, fullQaAiRows)
  16. callGemini(prompt, { ...geminiOptions, maxOutputTokens: 8192 })
      → 失敗: buildStep09FailureLog(gemini_call_failed) + Short スキップ

  17. validateQaAiResponse(text, step09Assets.aiSchema)（minItems: 3）
      → 失敗: buildStep09FailureLog(schema_validation_failed) + Short スキップ

  18. record_id 採番（Short）:
      existingShortRows = loadQaByProjectId().filter(r => r.related_version === "short")
      fullWrittenCount = fullQaRows.length（Full 書き込み済み件数）
      offset = fullWrittenCount   // Short は Full の後に続く通し番号
      aiRows[i] → existingShortRows[i]?.record_id
               ?? `${projectId}-QA-${offset + i + 1:03d}`

  19. for each { aiRow, record_id, qa_no } of shortQaRows:
        QaRow を組み立て → upsertQa()
        → 失敗: buildStep09FailureLog(upsert_failed, record_id) + 次行へ

  20. buildStep09SuccessLog(short) → appendAppLog()

  ─── プロジェクト完了処理 ──────────────────────────────────────────────
  21. 00_Project を最小更新（current_step = "STEP_09_QA_BUILD"）
      ※ Full / Short いずれか1つ以上成功した場合のみ更新
```

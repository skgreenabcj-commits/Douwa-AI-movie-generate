# STEP_04_05_COMBINED 実装設計書 v0.2

> **ステータス**: 設計確定（オーナー判断反映済み 2026-04-04）
> **改訂履歴**:
> - v0.1 (2026-04-04): 初版ドラフト（オーナー判断反映版）
> - v0.2 (2026-04-04): クロスレビュー前確認版。Fix #1〜#9 をすべて反映。
>   §2 current_step 状態表を STEP_04_05_PARTIAL 廃止・実装合致版に修正。
>   §6.1 オーケストレーターフローに Fix #1 依存性ルール・Fix #6 SKIPPED ルールを追記。
>   §6.3 record_id 突合ロジックを Fix #5 fail-fast 版に更新。
>   §9 バリデーション追加チェックに Fix #4/5 を反映。
>   §11 ログ設計に Fix #7/#8 の新規ビルダーを追記。
>   §12 エラーハンドリング設計に Fix #1/#6 ケースを追加。
> **元仕様**: `specs/step_04-step_05_combined_script_generate_v1.md` (v1.2)
> **前提実装**: STEP_01〜03 のコードパターンを継承する
> **決定事項記録**: 不明点1〜6 / 論点1〜4 のオーナー判断をすべて本書に反映済み

---

## 1. 本書の目的

`step_04-step_05_combined_script_generate_v1.md` をもとに、既存コード構造（STEP_01〜03）に
準拠した **プログラム実装のための設計仕様** を定義する。

prompt / schema / example ファイルの仕様もあわせて定義する。

---

## 2. 確定した設計判断

| # | 論点 | 判断 | 実装への影響 |
|---|---|---|---|
| 不明点1 | `short+full` 時の Full 参照 | **optional（存在チェックのみ）** | `hasFullScript: boolean` フラグをオーケストレーター内で保持し Prompt 注入を制御 |
| 不明点2 | Gemini 呼び出し回数 | **全 scene を 1 呼び出しで一括生成** | STEP_03 踏襲。`maxOutputTokens=32768` に拡張 |
| 不明点3 | `duration_sec` 算出 | **文字数 ÷ 読み速度でコード側が計算** | AI 出力には含めない。書き込み時にシステム側で補完（5.5文字/秒） |
| 不明点4 | `record_id` 一意性 | **シート名固定 + `record_id` 単体キー** | `SHEET_NAME` を各 write モジュール内定数として固定 |
| 不明点5 | `current_step` 値 | **推奨どおり状態別に設定** | 下表参照 |
| 不明点6 | `short_use=N` の扱い | **`03_Script_Short` に行を生成しない** | Short オーケストレーター内でフィルタリング |
| 論点1 | `emotion` | **コード側でそのまま引き継ぎ（STEP_03 値コピー）** | AI 出力スキーマから `emotion` を除外。write 時に `02_Scenes.emotion` を複製 |
| 論点2 | Full→Short 2 呼び出し | **初期実装は仕様どおり A（2 呼び出し）** | 将来最適化候補として C（1 呼び出し統合）を `FUTURE_OPTIMIZATION.md` に記録 |
| 論点3 | `difficult_words/easy_rewrite` | **入力として渡す（許容範囲）** | Prompt の `INPUT_DATA` に含める |
| 論点4 | `subtitle_short_*` 命名 | **現状踏襲（初期実装）** | schema / コメントで「Full版でも使用」を明記 |
| Fix #1 | `short+full` 依存性 | **Full 成功が Short 実行の前提** | Full 失敗時は Short をスキップ（dependency_failure）; shortDependsOnFull フラグで制御 |
| Fix #4 | `subtitle_short_2` 統一 | **required・空文字可（minLength なし）** | スキーマ・バリデーター・型・サンプル全ファイルで統一 |
| Fix #5 | record_id fail-fast | **件数不一致は validation で fail-fast** | `expectedCount` 引数で事前チェック; 20% 超不一致は fail |
| Fix #6 | short_use=Y 0件 | **SKIPPED 扱い（失敗ではない）** | `buildStep04ShortSkippedLog` で記録; current_step は変更しない |

### `current_step` 設定値

| 実行状態 | `current_step` 値 |
|---|---|
| Full のみ成功（`video_format=full`） | `STEP_05_FULL_SCRIPT_BUILD` |
| Short のみ成功（`video_format=short`） | `STEP_04_SHORT_SCRIPT_BUILD` |
| 両方成功（`video_format=short+full`） | `STEP_04_05_COMBINED` |
| Full成功 / Short失敗 | `STEP_05_FULL_SCRIPT_BUILD`（STEP_05 成功時点で設定済み） |
| Full失敗 / Short成功 | `STEP_04_SHORT_SCRIPT_BUILD`（STEP_04 成功時点で設定済み） |
| Full成功 / Short SKIPPED（short_use=0） | `STEP_05_FULL_SCRIPT_BUILD`（変更なし） |
| Full失敗 / Short SKIPPED（dependency） | 更新しない |
| 両方失敗 | 更新しない |

> ⚠️ `STEP_04_05_PARTIAL` という値は使用しない。

---

## 3. ファイル構成（新規作成対象）

```
src/
  steps/
    step04-05-script-build.ts          # オーケストレーター（STEP_04/05 統合）
  lib/
    load-scenes.ts                     # 02_Scenes 読み込み
    load-script.ts                     # 04_Script_Full 読み込み（Short 参照用）
    write-script-full.ts               # 04_Script_Full upsert
    write-script-short.ts              # 03_Script_Short upsert

prompts/
  script_full_prompt_v1.md             # STEP_05 Full 用プロンプトテンプレート
  script_short_prompt_v1.md            # STEP_04 Short 用プロンプトテンプレート
  fragments/
    script_output_field_guide_full_v1.md   # Full フィールドガイド
    script_output_field_guide_short_v1.md  # Short フィールドガイド

schemas/
  script_short_schema_ai_v1.json       # STEP_04 AI 出力スキーマ
  script_full_schema_ai_v1.json        # STEP_05 AI 出力スキーマ
  script_short_schema_full_v1.json     # 03_Script_Short 書き込み行スキーマ
  script_full_schema_full_v1.json      # 04_Script_Full 書き込み行スキーマ

examples/
  script_short_ai_response_example_v1.json
  script_full_ai_response_example_v1.json
```

### 既存ファイルへの追記対象

```
src/
  index.ts                             # STEP_04_05 ルーティング追加
  types.ts                             # 新 interface 追加; StepId 更新; scene_order 整理
  lib/
    build-prompt.ts                    # buildStep04Prompt / buildStep05Prompt 追加
    load-assets.ts                     # Step04Assets / Step05Assets 追加
    call-gemini.ts                     # buildGeminiOptionsStep04 / Step05 追加
    validate-json.ts                   # validateScriptFullAiResponse / Short 追加
    write-app-log.ts                   # buildStep04/05 ログビルダー追加（Fix #7/#8）
```

---

## 4. 型定義設計（`src/types.ts` 追記）

### 4.1 `StepId`（Fix #2 更新）

```typescript
export type StepId =
  | "STEP_01"                       // Rights Validation（GitHub Actions STEP_ID 用）
  | "STEP_02"                       // Source Build
  | "STEP_03"                       // Scenes Build
  | "STEP_04_05"                    // Short + Full Script Build（GitHub Actions STEP_ID 用）
  | "STEP_04_SHORT_SCRIPT_BUILD"    // GSS step_id / current_step 値（Short 完了）
  | "STEP_05_FULL_SCRIPT_BUILD"     // GSS step_id / current_step 値（Full 完了）
  | "STEP_04_05_COMBINED";          // current_step 値（Short+Full 両方完了）
```

> `STEP_04_05_PARTIAL` は使用しない。部分成功時は成功したステップ値を使用する。

### 4.2 `SceneReadRow`（02_Scenes 読み込み用）

```typescript
/** 02_Scenes から読み込む参照用 row（STEP_04/05 が参照） */
export interface SceneReadRow {
  project_id:         string;
  record_id:          string;   // STEP_04/05 の upsert キーとして引き継ぐ
  scene_no:           string;   // 表示用通し番号（"1","2","3"...）。キーに使わない。
  chapter:            string;
  scene_title:        string;
  scene_summary:      string;
  scene_goal:         string;
  visual_focus:       string;
  emotion:            string;   // 論点1: コード側で ScriptRow にそのまま引き継ぐ
  short_use:          string;   // "Y" | "N"
  full_use:           string;   // "Y" | "N"
  est_duration_short: string;
  est_duration_full:  string;
  difficult_words:    string;
  easy_rewrite:       string;
  qa_seed:            string;
  continuity_note:    string;
}
```

> `scene_id` / `scene_order` は GSS 02_Scenes の実在列ではないため `SceneReadRow` に含めない（Fix #3）。

### 4.3 `ScriptFullAiRow`（AI 出力 Full）

```typescript
export interface ScriptFullAiRow {
  record_id:        string;   // 02_Scenes.record_id をそのまま返させる（紐付け用）
  narration_draft:  string;
  narration_tts:    string;
  subtitle_short_1: string;   // 論点4: Full版でも同列名を使用
  subtitle_short_2: string;   // required・空文字可（Fix #4: "" は valid）
  visual_emphasis:  string;   // optional / 空文字可
  pause_hint:       string;
}
```

### 4.4 `ScriptShortAiRow`（AI 出力 Short）

```typescript
export interface ScriptShortAiRow {
  record_id:        string;   // 02_Scenes.record_id をそのまま返させる（紐付け用）
  narration_draft:  string;
  narration_tts:    string;
  subtitle_short_1: string;   // required・空文字不可
  subtitle_short_2: string;   // required・空文字可（Fix #4: "" は valid）
  emphasis_word:    string;   // optional / 空文字可
  transition_note:  string;
}
```

### 4.5 `ScriptFullRow`（GSS 書き込み用 Full）

```typescript
export interface ScriptFullRow extends ScriptFullAiRow {
  project_id:        string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;   // 固定: "STEP_05_FULL_SCRIPT_BUILD"
  scene_no:          string;   // 参照用・表示用（キーに使わない）
  related_version:   string;   // 固定: "full"
  duration_sec:      number;   // コード側計算: Math.ceil(narration_tts.length / 5.5)
  emotion:           string;   // 02_Scenes.emotion をコード側でコピー（論点1）
  hook_flag:         string;   // "Y" | "N" | ""（optional）
  tts_ready:         string;   // "Y" | "N" | ""（optional）
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}
```

### 4.6 `ScriptShortRow`（GSS 書き込み用 Short）

```typescript
export interface ScriptShortRow extends ScriptShortAiRow {
  project_id:        string;
  generation_status: "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;   // 固定: "STEP_04_SHORT_SCRIPT_BUILD"
  scene_no:          string;   // 参照用・表示用（キーに使わない）
  related_version:   string;   // 固定: "short"
  duration_sec:      number;   // コード側計算: Math.ceil(narration_tts.length / 5.5)
  emotion:           string;   // 02_Scenes.emotion をコード側でコピー（論点1）
  hook_flag:         string;   // "Y" | "N" | ""（optional）
  tts_ready:         string;   // "Y" | "N" | ""（optional）
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}
```

### 4.7 `ScriptFullReadRow`（04_Script_Full 読み込み用 — Short 参照時）

```typescript
export interface ScriptFullReadRow {
  project_id:       string;
  record_id:        string;
  narration_draft:  string;
  narration_tts:    string;
  subtitle_short_1: string;
  subtitle_short_2: string;
  emotion:          string;
  pause_hint:       string;
}
```

---

## 5. モジュール設計

### 5.1 `src/lib/load-scenes.ts`（新規）

```
loadScenesByProjectId(spreadsheetId, projectId): Promise<SceneReadRow[]>
```

- `02_Scenes` シートを全行読み込み、`project_id` が一致する行を返す
- `generation_status = "GENERATED"` の行のみを返す
- `scene_no` 数値順（昇順）にソートして返す
- 0 件の場合は空配列（呼び出し側でエラー判定）

### 5.2 `src/lib/load-script.ts`（新規）

```
loadFullScriptByProjectId(spreadsheetId, projectId): Promise<ScriptFullReadRow[]>
```

- `04_Script_Full` シートを全行読み込み、`project_id` が一致する行を返す
- `generation_status = "GENERATED"` の行のみを返す
- 0 件の場合は空配列（呼び出し側で `hasFullScript = false` と判定）
- **STEP_04 Short 生成時のみ呼び出す**（不明点1: optional）
- ⚠️ ソート時の `scene_no` は `ScriptFullReadRow` 型定義外のため `unknown` 経由でアクセスする（暫定実装）

### 5.3 `src/lib/write-script-full.ts`（新規）

```
upsertScriptFull(spreadsheetId, row: ScriptFullRow): Promise<string>  // returns record_id
```

- シート名: `04_Script_Full`（定数固定）
- upsert キー: `record_id`
- UPDATE: 既存 `record_id` 一致行を上書き
- INSERT: 末尾次の空行に挿入

#### 書き込み列順（GSS 04_Script_Full ヘッダー順）

```typescript
const SCRIPT_FULL_HEADERS: Array<keyof ScriptFullRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "scene_no",
  "related_version",
  "duration_sec",
  "narration_draft",
  "narration_tts",
  "subtitle_short_1",   // 論点4: Full版でも同列名
  "subtitle_short_2",   // 論点4: Full版でも同列名（空文字可; Fix #4）
  "visual_emphasis",
  "pause_hint",
  "emotion",            // 論点1: 02_Scenes.emotion をコピー
  "hook_flag",
  "tts_ready",
  "updated_at",
  "updated_by",
  "notes",
];
```

### 5.4 `src/lib/write-script-short.ts`（新規）

```
upsertScriptShort(spreadsheetId, row: ScriptShortRow): Promise<string>  // returns record_id
```

- シート名: `03_Script_Short`（定数固定）
- upsert キー: `record_id`
- 構造は `write-script-full.ts` と同一パターン

#### 書き込み列順（GSS 03_Script_Short ヘッダー順）

```typescript
const SCRIPT_SHORT_HEADERS: Array<keyof ScriptShortRow> = [
  "project_id",
  "record_id",
  "generation_status",
  "approval_status",
  "step_id",
  "scene_no",
  "related_version",
  "duration_sec",
  "narration_draft",
  "narration_tts",
  "subtitle_short_1",
  "subtitle_short_2",   // 空文字可（Fix #4）
  "emphasis_word",
  "transition_note",
  "emotion",            // 論点1: 02_Scenes.emotion をコピー
  "hook_flag",
  "tts_ready",
  "updated_at",
  "updated_by",
  "notes",
];
```

---

## 6. オーケストレーター設計（`src/steps/step04-05-script-build.ts`）

### 6.1 処理フロー

```
export async function runStep04_05ScriptBuild(
  payload: WorkflowPayload,
  spreadsheetId: string
): Promise<void>
```

```
for each projectId in payload.project_ids:

  1. loadRuntimeConfig()
  2. readProjectsByIds() → ProjectRow
  3. video_format を取得（"short" | "full" | "short+full"）
     → 不正値: buildStep04_05PreflightFailureLog(invalid_video_format) + 次 project へ
  4. loadScenesByProjectId() → SceneReadRow[]
     → 失敗: buildStep04_05PreflightFailureLog(load_scenes_failure) + 次 project へ
     → 0 件: buildStep04_05PreflightFailureLog(no_scenes) + 次 project へ
  5. 実行分岐:
     video_format = "full"       → [STEP_05 のみ]
     video_format = "short"      → [STEP_04 のみ]
     video_format = "short+full" → [STEP_05 → STEP_04]

  ─── STEP_05 Full Script Build ───────────────────────────
  6.  Full 用 assets を loadStep05Assets() でロード
  7.  buildStep05Prompt() でプロンプトアセンブル
      - full_use = "Y" の scene のみを INPUT_DATA の scenes 配列として渡す
  8.  callGemini(prompt, { ...geminiOptionsStep05, maxOutputTokens: 32768 })
  9.  validateScriptFullAiResponse(text, assets.aiSchema, fullUseCount)
      → 件数不一致: scene_count_mismatch エラー（fail-fast; Fix #5）
  10. matchAiOutputToScenes(aiRows, fullScenes, "STEP_05")
      → 20% 超不一致: null 返却 → fail
      → 20% 以下不一致: 警告 + インデックスフォールバック
  11. for each matched { ai, scene }:
        - duration_sec = Math.ceil(ai.narration_tts.length / 5.5)
        - emotion = scene.emotion（論点1）
        - ScriptFullRow を組み立て、upsertScriptFull()
  12. 00_Project を最小更新（current_step = "STEP_05_FULL_SCRIPT_BUILD"）
  13. buildStep05SuccessLog() → appendAppLog()
  14. fullSuccess = true

  ─── STEP_04 Short Script Build ──────────────────────────
  [Fix #1] video_format = "short+full" かつ fullSuccess = false の場合:
    → buildStep04DependencySkippedLog() → appendAppLog()
    → shortResult = "skipped"（STEP_04 実行しない）

  [Fix #6] shortScenes = allScenes.filter(short_use = "Y")
    → shortUseCount = 0 の場合:
      buildStep04ShortSkippedLog() → appendAppLog()
      shortResult = "skipped"

  15. video_format = "short+full" かつ fullSuccess = true の場合:
        loadFullScriptByProjectId() を試みる（不明点1: optional）
        hasFullScript = (結果.length > 0)
      video_format = "short" の場合:
        hasFullScript = false（仕様 §4.5）

  16. Short 用 assets を loadStep04Assets() でロード
  17. buildStep04Prompt() でプロンプトアセンブル
      - short_use = "Y" の scene のみを INPUT_DATA の scenes 配列として渡す（不明点6）
      - hasFullScript = true の場合: full_script_ref を scenes 各要素に追記
  18. callGemini(prompt, { ...geminiOptionsStep04, maxOutputTokens: 32768 })
  19. validateScriptShortAiResponse(text, assets.aiSchema, shortUseCount)
      → 件数不一致: scene_count_mismatch エラー（fail-fast; Fix #5）
  20. matchAiOutputToScenes(aiRows, shortScenes, "STEP_04")
  21. for each matched { ai, scene }:
        - duration_sec = Math.ceil(ai.narration_tts.length / 5.5)
        - emotion = scene.emotion（論点1）
        - ScriptShortRow を組み立て、upsertScriptShort()
  22. 00_Project を最小更新（current_step = fullSuccess ? "STEP_04_05_COMBINED" : "STEP_04_SHORT_SCRIPT_BUILD"）
  23. buildStep04SuccessLog() → appendAppLog()
  24. shortResult = "success"

  ─── partial success / 両方完了 ───────────────────────────
  25. Full=success, Short=success → current_step = "STEP_04_05_COMBINED"（step22 で設定済み）
      Full=success, Short=fail    → buildStep04_05PartialSuccessLog("STEP_05_FULL_SCRIPT_BUILD", "success", "fail")
      Full=success, Short=skipped → （ログは buildStep04DependencySkippedLog / buildStep04ShortSkippedLog で設定済み）
      Full=fail, Short=skipped    → current_step 更新なし（ログは buildStep04DependencySkippedLog で設定済み）
      Full=fail, Short=fail       → current_step 更新なし（ログのみ）
```

### 6.2 `duration_sec` 計算ロジック

```typescript
function calcDurationSec(narrationTts: string): number {
  return Math.ceil(narrationTts.length / 5.5);
}
```

### 6.3 `record_id` 突合ロジック（Fix #5 強化版）

```typescript
type AiRow = { record_id: string; [key: string]: unknown };

function matchAiOutputToScenes<T extends AiRow>(
  aiRows: T[],
  sceneRows: SceneReadRow[],
  stepLabel: string
): Array<{ ai: T; scene: SceneReadRow }> | null {
  // 件数不一致: fail-fast（validation で事前チェック済みのはずだが念のため）
  if (aiRows.length !== sceneRows.length) return null;

  // 1. record_id マップで突合
  const sceneMap = new Map(sceneRows.map(s => [s.record_id, s]));
  const result = [];
  const mismatches = [];

  for (let i = 0; i < aiRows.length; i++) {
    const byId = sceneMap.get(aiRows[i].record_id);
    if (byId) {
      result.push({ ai: aiRows[i], scene: byId });
    } else {
      mismatches.push(i);
    }
  }

  if (mismatches.length === 0) return result;  // 正常

  const mismatchRate = mismatches.length / aiRows.length;

  // 2. 20% 以下: 警告 + インデックス順フォールバック（部分許容）
  if (mismatchRate <= 0.2) {
    logError(`[${stepLabel}] record_id mismatch ${mismatches.length}/${aiRows.length}. Fallback.`);
    // 不一致分のみインデックス順でフォールバック（sceneRows[i] を使用）
    return fallbackResult;
  }

  // 3. 20% 超: fail（データ破壊防止）
  logError(`[${stepLabel}] record_id mismatch rate too high. Refusing upsert.`);
  return null;
}
```

---

## 7. Prompt 設計

### 7.1 STEP_05 Full プロンプト（`prompts/script_full_prompt_v1.md`）

**プレースホルダー構成**:

| プレースホルダー | 内容 |
|---|---|
| `{{INPUT_DATA}}` | project 情報 + 02_Scenes 行配列（full_use=Y のみ） |
| `{{OUTPUT_JSON_SCHEMA}}` | script_full_schema_ai_v1.json |
| `{{OUTPUT_FIELD_GUIDE}}` | script_output_field_guide_full_v1.md |
| `{{OUTPUT_EXAMPLE}}` | script_full_ai_response_example_v1.json |

**INPUT_DATA 構造**:

```json
{
  "project_id": "PJT-001",
  "title_jp": "桃太郎",
  "target_age": "4-6",
  "full_target_sec": 480,
  "visual_style": "...",
  "notes": "...",
  "scenes": [
    {
      "record_id": "PJT-001-SCN-001",
      "scene_no": "1",
      "chapter": "導入",
      "scene_title": "大きな桃が川から流れてくる",
      "scene_summary": "...",
      "scene_goal": "...",
      "visual_focus": "...",
      "emotion": "ふしぎ、わくわく",
      "est_duration_full": 35,
      "difficult_words": "どんぶらこ",
      "easy_rewrite": "ぷかぷか流れてくる",
      "continuity_note": "..."
    }
  ]
}
```

### 7.2 STEP_04 Short プロンプト（`prompts/script_short_prompt_v1.md`）

**プレースホルダー構成**:

| プレースホルダー | 内容 |
|---|---|
| `{{INPUT_DATA}}` | project 情報 + 02_Scenes 行配列（short_use=Y のみ）+ Full 参照（任意） |
| `{{HAS_FULL_SCRIPT}}` | `"true"` or `"false"` |
| `{{OUTPUT_JSON_SCHEMA}}` | script_short_schema_ai_v1.json |
| `{{OUTPUT_FIELD_GUIDE}}` | script_output_field_guide_short_v1.md |
| `{{OUTPUT_EXAMPLE}}` | script_short_ai_response_example_v1.json |

**Full 参照ありの INPUT_DATA 構造**（`hasFullScript = true` 時）:

```json
{
  "project_id": "PJT-001",
  "title_jp": "桃太郎",
  "target_age": "4-6",
  "short_target_sec": 240,
  "visual_style": "...",
  "has_full_script": true,
  "scenes": [
    {
      "record_id": "PJT-001-SCN-001",
      "scene_no": "1",
      "est_duration_short": 18,
      "full_script_ref": {
        "narration_draft": "...",
        "narration_tts": "...",
        "pause_hint": "..."
      }
    }
  ]
}
```

---

## 8. AI 出力スキーマ設計

### 8.1 `script_full_schema_ai_v1.json` の構造

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "script_full_schema_ai_v1",
  "type": "object",
  "required": ["scripts"],
  "additionalProperties": false,
  "properties": {
    "scripts": {
      "type": "array",
      "minItems": 1,
      "maxItems": 30,
      "items": {
        "type": "object",
        "required": [
          "record_id",
          "narration_draft",
          "narration_tts",
          "subtitle_short_1",
          "subtitle_short_2",
          "pause_hint"
        ],
        "additionalProperties": false,
        "properties": {
          "record_id":        { "type": "string", "minLength": 1 },
          "narration_draft":  { "type": "string", "minLength": 1 },
          "narration_tts":    { "type": "string", "minLength": 1 },
          "subtitle_short_1": { "type": "string", "minLength": 1 },
          "subtitle_short_2": { "type": "string" },
          "visual_emphasis":  { "type": "string" },
          "pause_hint":       { "type": "string", "minLength": 1 }
        }
      }
    }
  }
}
```

> `subtitle_short_2` は `required` に含めるが `minLength` は設定しない（空文字 `""` 許容; Fix #4）。
> `emotion` / `duration_sec` は AI 出力スキーマに含めない（論点1 / 不明点3）。

### 8.2 `script_short_schema_ai_v1.json` の構造

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "script_short_schema_ai_v1",
  "type": "object",
  "required": ["scripts"],
  "additionalProperties": false,
  "properties": {
    "scripts": {
      "type": "array",
      "minItems": 1,
      "maxItems": 30,
      "items": {
        "type": "object",
        "required": [
          "record_id",
          "narration_draft",
          "narration_tts",
          "subtitle_short_1",
          "subtitle_short_2",
          "transition_note"
        ],
        "additionalProperties": false,
        "properties": {
          "record_id":        { "type": "string", "minLength": 1 },
          "narration_draft":  { "type": "string", "minLength": 1 },
          "narration_tts":    { "type": "string", "minLength": 1 },
          "subtitle_short_1": { "type": "string", "minLength": 1 },
          "subtitle_short_2": { "type": "string" },
          "emphasis_word":    { "type": "string" },
          "transition_note":  { "type": "string", "minLength": 1 }
        }
      }
    }
  }
}
```

---

## 9. バリデーション設計（`src/lib/validate-json.ts` 追記）

### 9.1 `validateScriptFullAiResponse`（Fix #5 / Fix #9 反映）

```typescript
export function validateScriptFullAiResponse(
  rawText: string,
  schema: string,
  expectedCount?: number   // Fix #5: 件数チェック追加
): ValidateScriptFullResult
```

### 9.2 `validateScriptShortAiResponse`

同様のパターンで `ScriptShortAiRow[]` を返す。`expectedCount` 引数を受け取る。

### 9.3 追加バリデーションルール（Fix #4/#5 反映）

スキーマ検証後に以下をコード側で追加チェックする:

| チェック | 内容 | エラー種別 |
|---|---|---|
| 件数チェック（Fix #5） | AI 出力件数と入力 scenes 件数が一致するか（`expectedCount` と照合） | `scene_count_mismatch`（**エラーレベル・fail-fast**） |
| 必須フィールド空文字チェック | `narration_draft`, `narration_tts`, `subtitle_short_1`, `pause_hint`/`transition_note`, `record_id` が空文字でないか | `empty_required_field`（エラーレベル） |
| `subtitle_short_2` 存在チェック（Fix #4） | `undefined` または `null` のみ reject。空文字 `""` は許容 | `empty_required_field` |

### 9.4 extractJson 堅牢化（Fix #9）

AI レスポンスから JSON を抽出する `extractJson` 関数:
1. Markdown コードフェンス（` ```json ` / ` ``` `）内を優先
2. テキスト全体が `{...}` の場合はそのまま返す
3. brace カウント（文字列内の brace を正しく除外）で最初の完全な JSON オブジェクトを抽出

### 9.5 Ajv compile キャッシュ（Fix #9）

`ajv.compile()` の結果をモジュール単位の `Map<string, ValidateFunction>` にキャッシュする。
同一スキーマ文字列での再コンパイルを防ぎ、パフォーマンスを改善する。

---

## 10. Gemini オプション設計（`src/lib/call-gemini.ts` 追記）

```typescript
export function buildGeminiOptionsStep05(configMap: RuntimeConfigMap): GeminiCallOptions {
  // step_05_model_role → model_role_text_pro → model_role_text_flash_secondary
  // maxOutputTokens: 32768（一括生成のため STEP_03 の 2 倍）
}

export function buildGeminiOptionsStep04(configMap: RuntimeConfigMap): GeminiCallOptions {
  // step_04_model_role → model_role_text_pro → model_role_text_flash_secondary
  // maxOutputTokens: 32768
}
```

**94_Runtime_Config に追加が必要なキー**:

| key | デフォルト値 | 説明 |
|---|---|---|
| `step_04_model_role` | `gemini-2.5-pro` | STEP_04 primary model |
| `step_05_model_role` | `gemini-2.5-pro` | STEP_05 primary model |

---

## 11. ログ設計（`src/lib/write-app-log.ts` 追記）

### 11.1 既存ビルダー（STEP_04/05）

```typescript
// STEP_05 Full
buildStep05SuccessLog(projectId, recordId, message): AppLogRow
buildStep05FailureLog(projectId, recordId, errorType, message): AppLogRow

// STEP_04 Short
buildStep04SuccessLog(projectId, recordId, message): AppLogRow
buildStep04FailureLog(projectId, recordId, errorType, message): AppLogRow
```

### 11.2 新規ビルダー（Fix #7/#8 追加）

```typescript
// 前段エラー専用（video_format 不正・scenes 0件・load 失敗等）
buildStep04_05PreflightFailureLog(
  projectId, recordId, errorType, message, currentStep?
): AppLogRow

// partial success 専用（Full/Short の一方が失敗した場合）
buildStep04_05PartialSuccessLog(
  projectId, recordId, currentStep,
  fullResult: "success" | "fail" | "skipped",
  shortResult: "success" | "fail" | "skipped"
): AppLogRow

// short_use=Y 0件 SKIPPED 専用
buildStep04ShortSkippedLog(
  projectId, recordId, currentStep, reason
): AppLogRow

// Full 失敗による Short スキップ（dependency_failure）専用
buildStep04DependencySkippedLog(
  projectId, recordId, message
): AppLogRow
```

### 11.3 ログメッセージ形式

| イベント | ログ内容 |
|---|---|
| STEP_05 完了 | `[INFO][success] STEP_05 completed. model=..., usedFallback=..., script_count=N, duration_sec_total=N` |
| STEP_04 完了 | `[INFO][success] STEP_04 completed. model=..., usedFallback=..., script_count=N, has_full_script=true/false` |
| dependency_failure | `[WARN][dependency_failure] Short skipped because Full failed (video_format=short+full)` |
| short_skipped | `[INFO][short_skipped] short_use=Y scenes not found (count=0). Skipped.` |
| partial success | `[WARN][partial_success] Full=success/fail, Short=success/fail/skipped` |
| 前段エラー | `[ERROR][invalid_video_format \| load_scenes_failure \| no_scenes] ...` |
| schema 失敗 | `[ERROR][schema_validation_failure] ...` |

---

## 12. エラーハンドリング設計

| エラー種別 | 対処 | `approval_status` | ログビルダー |
|---|---|---|---|
| `02_Scenes` 0 件 | エラー停止、ログ、次 project へ | 更新しない | `buildStep04_05PreflightFailureLog(no_scenes)` |
| `video_format` 不正 | エラー停止、ログ | 更新しない | `buildStep04_05PreflightFailureLog(invalid_video_format)` |
| Full schema 失敗 | Full を失敗扱い、**short+full なら Short スキップ**（Fix #1） | `PENDING`（partial）| `buildStep05FailureLog(schema_validation_failure)` |
| Full 依存 Short スキップ（Fix #1） | Short 未実行、ログ | 更新しない | `buildStep04DependencySkippedLog` |
| Short schema 失敗 | Short を失敗扱い、Full 書き込み済みなら維持 | `PENDING`（partial） | `buildStep04FailureLog(schema_validation_failure)` |
| short_use=Y 0件（Fix #6） | SKIPPED（失敗ではない）、ログ | 更新しない | `buildStep04ShortSkippedLog` |
| scene_count_mismatch（Fix #5） | validation fail-fast、upsert しない | `PENDING` | `buildStep05/04FailureLog(schema_validation_failure)` |
| Full GSS 書き込み失敗 | ログ、partial success | `PENDING` | `buildStep05FailureLog(gss_write_failure)` |
| Short GSS 書き込み失敗 | ログ、partial success | `PENDING` | `buildStep04FailureLog(gss_write_failure)` |
| Spending Cap | 即時停止（残 project スキップ） | 更新しない | `GeminiSpendingCapError` を re-throw |
| 両方失敗 | ログのみ、`current_step` 更新しない | 更新しない | 各 FailureLog |

---

## 13. `index.ts` ルーティング追記

```typescript
case "STEP_04_05":
  await runStep04_05ScriptBuild(payload, spreadsheetId);
  break;
```

> `STEP_ID` 環境変数は `"STEP_04_05"` を使用する（統合実行）。
> 個別実行（`STEP_04` / `STEP_05` 単体）は初期実装では対応しない。

---

## 14. dry-run スクリプト設計

### `src/scripts/dry-run-step04-05.ts`

STEP_03 の `dry-run-step03.ts` と同構造で以下を出力する:

- video_format の確認
- 入力 scenes 一覧（scene_no / scene_title / short_use / full_use / est_duration）
- Full 参照あり/なし の状態確認
- Prompt プレビュー（Full / Short）
- Gemini 呼び出しはスキップ

---

## 15. 実装フェーズ計画

| Phase | 対象ファイル | 内容 | 優先度 |
|---|---|---|---|
| 1 | `src/types.ts` | 新 interface 追加（§4）; StepId 更新（Fix #2）; scene_id/order 整理（Fix #3） | ✅ 完了 |
| 2 | `src/lib/load-scenes.ts` | 02_Scenes 読み込みモジュール（新規） | ✅ 完了 |
| 3 | `schemas/script_full_schema_ai_v1.json` | Full AI 出力スキーマ（§8.1; Fix #4）| ✅ 完了 |
| 4 | `schemas/script_short_schema_ai_v1.json` | Short AI 出力スキーマ（§8.2; Fix #4）| ✅ 完了 |
| 5 | `schemas/script_full_schema_full_v1.json` | Full 書き込み行スキーマ | ✅ 完了 |
| 6 | `schemas/script_short_schema_full_v1.json` | Short 書き込み行スキーマ | ✅ 完了 |
| 7 | `src/lib/validate-json.ts` | ScriptFull / Short バリデーター（Fix #4/#5/#9） | ✅ 完了 |
| 8 | `src/lib/write-script-full.ts` | Full upsert モジュール（新規） | ✅ 完了 |
| 9 | `src/lib/write-script-short.ts` | Short upsert モジュール（新規） | ✅ 完了 |
| 10 | `src/lib/load-assets.ts` | Step04 / Step05 Assets 追記 | ✅ 完了 |
| 11 | `src/lib/call-gemini.ts` | buildGeminiOptionsStep04/05 追記 | ✅ 完了 |
| 12 | `src/lib/build-prompt.ts` | buildStep04Prompt / buildStep05Prompt 追記 | ✅ 完了 |
| 13 | `src/lib/write-app-log.ts` | Step04/05 ログビルダー追記（Fix #7/#8） | ✅ 完了 |
| 14 | `src/steps/step04-05-script-build.ts` | オーケストレーター（Fix #1/#5/#6 反映） | ✅ 完了 |
| 15 | `src/index.ts` | STEP_04_05 ルーティング追記 | ✅ 完了 |
| 16 | `prompts/script_full_prompt_v1.md` | Full プロンプトテンプレート | ✅ 完了 |
| 17 | `prompts/script_short_prompt_v1.md` | Short プロンプトテンプレート | ✅ 完了 |
| 18 | `prompts/fragments/script_output_field_guide_full_v1.md` | Full フィールドガイド（Fix #4 反映） | ✅ 完了 |
| 19 | `prompts/fragments/script_output_field_guide_short_v1.md` | Short フィールドガイド（Fix #4 反映） | ✅ 完了 |
| 20 | `examples/script_full_ai_response_example_v1.json` | Full サンプル | ✅ 完了 |
| 21 | `examples/script_short_ai_response_example_v1.json` | Short サンプル | ✅ 完了 |
| 22 | `src/lib/load-script.ts` | 04_Script_Full 読み込みモジュール（新規） | ✅ 完了 |
| 23 | `src/scripts/dry-run-step04-05.ts` | dry-run スクリプト | ✅ 完了 |

---

## 16. 将来最適化メモ（論点2）

> **FUTURE_OPTIMIZATION_C**: `video_format = short+full` 時に Full / Short を
> 1 回の Gemini 呼び出しで同時生成する。
> プロンプトで `{ "scripts_full": [...], "scripts_short": [...] }` の 2 配列を
> 1 回の応答で返させる方式。
> **採用条件**: Full と Short の narration 品質差が実運用上問題にならないと確認できた場合。
> **未解決課題**: 1 プロンプトの複雑化、出力トークン数のさらなる増大、
> Full/Short の個別 schema バリデーションの難化。

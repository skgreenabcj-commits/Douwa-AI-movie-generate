# STEP_04_05_COMBINED 実装設計書 v0.1

> **ステータス**: 設計確定（オーナー判断反映済み 2026-04-04）
> **元仕様**: `specs/step_04-step_05_combined_script_generate_v1.md`
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

### `current_step` 設定値

| 実行状態 | `current_step` 値 |
|---|---|
| Full のみ成功（`video_format=full`） | `STEP_05_FULL_SCRIPT_BUILD` |
| Short のみ成功（`video_format=short`） | `STEP_04_SHORT_SCRIPT_BUILD` |
| 両方成功（`video_format=short+full`） | `STEP_04_05_COMBINED` |
| partial success（片方失敗） | `STEP_04_05_PARTIAL` |

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
  types.ts                             # 新 interface 追加
  lib/
    build-prompt.ts                    # buildStep04Prompt / buildStep05Prompt 追加
    load-assets.ts                     # Step04Assets / Step05Assets 追加
    call-gemini.ts                     # buildGeminiOptionsStep04 / Step05 追加
    validate-json.ts                   # validateScriptFullAiResponse / Short 追加
    write-app-log.ts                   # buildStep04/05 ログビルダー追加
```

---

## 4. 型定義設計（`src/types.ts` 追記）

### 4.1 `SceneReadRow`（02_Scenes 読み込み用）

```typescript
/** 02_Scenes から読み込む参照用 row（STEP_04/05 が参照） */
export interface SceneReadRow {
  project_id:       string;
  record_id:        string;           // upsert キーとして引き継ぐ
  scene_no:         string;           // 表示用通し番号（キーに使わない）
  chapter:          string;
  scene_title:      string;
  scene_summary:    string;
  scene_goal:       string;
  visual_focus:     string;
  emotion:          string;           // 論点1: コード側でそのまま引き継ぐ
  short_use:        string;           // "Y" | "N"
  full_use:         string;           // "Y" | "N"
  est_duration_short: string;
  est_duration_full:  string;
  difficult_words:  string;
  easy_rewrite:     string;
  qa_seed:          string;
  continuity_note:  string;
}
```

### 4.2 `ScriptFullAiRow`（AI 出力 Full）

```typescript
/**
 * STEP_05 Full Script — AI が返す 1 scene 分の row
 * スキーマ: script_full_schema_ai_v1.json
 *
 * emotion は AI 出力に含めない（論点1: 02_Scenes.emotion をコード側でコピー）。
 * duration_sec は AI 出力に含めない（不明点3: 文字数 ÷ 読み速度でコード側が計算）。
 */
export interface ScriptFullAiRow {
  record_id:          string;   // 02_Scenes.record_id を返させる（紐付け用）
  narration_draft:    string;
  narration_tts:      string;
  subtitle_short_1:   string;   // 論点4: Full版でも同列名を使用
  subtitle_short_2:   string;   // 論点4: Full版でも同列名を使用
  visual_emphasis:    string;   // optional / 空文字可
  pause_hint:         string;
}
```

### 4.3 `ScriptShortAiRow`（AI 出力 Short）

```typescript
/**
 * STEP_04 Short Script — AI が返す 1 scene 分の row
 * スキーマ: script_short_schema_ai_v1.json
 *
 * emotion は AI 出力に含めない（論点1: 02_Scenes.emotion をコード側でコピー）。
 * duration_sec は AI 出力に含めない（不明点3: 文字数 ÷ 読み速度でコード側が計算）。
 * short_use=N の scene は AI に渡さない（不明点6: 行を生成しない）。
 */
export interface ScriptShortAiRow {
  record_id:          string;   // 02_Scenes.record_id を返させる（紐付け用）
  narration_draft:    string;
  narration_tts:      string;
  subtitle_short_1:   string;
  subtitle_short_2:   string;
  emphasis_word:      string;   // optional / 空文字可
  transition_note:    string;
}
```

### 4.4 `ScriptFullRow`（GSS 書き込み用 Full）

```typescript
/** Google Sheets 04_Script_Full 書き込み行（script_full_schema_full_v1） */
export interface ScriptFullRow extends ScriptFullAiRow {
  project_id:         string;
  generation_status:  "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status:    "PENDING" | "APPROVED" | "REJECTED";
  step_id:            string;         // 固定: "STEP_05_FULL_SCRIPT_BUILD"
  scene_no:           string;         // 参照用・表示用（キーに使わない）
  related_version:    string;         // 固定: "full"
  duration_sec:       number;         // コード側計算（文字数 ÷ 5.5）
  emotion:            string;         // 02_Scenes.emotion をコード側でコピー（論点1）
  hook_flag:          string;         // "Y" | "N" | ""（optional）
  tts_ready:          string;         // "Y" | "N" | ""（optional）
  updated_at:         string;
  updated_by:         string;
  notes:              string;
}
```

### 4.5 `ScriptShortRow`（GSS 書き込み用 Short）

```typescript
/** Google Sheets 03_Script_Short 書き込み行（script_short_schema_full_v1） */
export interface ScriptShortRow extends ScriptShortAiRow {
  project_id:         string;
  generation_status:  "GENERATED" | "FAILED" | "SKIPPED" | "PENDING";
  approval_status:    "PENDING" | "APPROVED" | "REJECTED";
  step_id:            string;         // 固定: "STEP_04_SHORT_SCRIPT_BUILD"
  scene_no:           string;         // 参照用・表示用（キーに使わない）
  related_version:    string;         // 固定: "short"
  duration_sec:       number;         // コード側計算（文字数 ÷ 5.5）
  emotion:            string;         // 02_Scenes.emotion をコード側でコピー（論点1）
  hook_flag:          string;         // "Y" | "N" | ""（optional）
  tts_ready:          string;         // "Y" | "N" | ""（optional）
  updated_at:         string;
  updated_by:         string;
  notes:              string;
}
```

### 4.6 `ScriptFullReadRow`（04_Script_Full 読み込み用 — Short 参照時）

```typescript
/** 04_Script_Full から読み込む参照用 row（STEP_04 Short 生成時の任意参照） */
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

### 5.3 `src/lib/write-script-full.ts`（新規）

```
upsertScriptFull(spreadsheetId, row: ScriptFullRow): Promise<string>  // returns record_id
```

- シート名: `04_Script_Full`（定数固定）
- upsert キー: `record_id`（不明点4: シート名固定 + record_id 単体）
- UPDATE: 既存 `record_id` 一致行を上書き
- INSERT: 末尾次の空行に挿入
- `record_id` は `02_Scenes.record_id` をそのまま引き継ぐ（新規採番しない）

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
  "subtitle_short_2",   // 論点4: Full版でも同列名
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
  "subtitle_short_2",
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
     → 不正値はエラー停止 + ログ
  4. loadScenesByProjectId() → SceneReadRow[]
     → 0 件はエラー停止 + ログ（仕様 §6.1）
  5. 実行分岐:
     video_format = "full"       → [STEP_05 のみ]
     video_format = "short"      → [STEP_04 のみ]
     video_format = "short+full" → [STEP_05 → STEP_04]

  ─── STEP_05 Full Script Build ───────────────────────────
  6.  Full 用 assets を loadStep05Assets() でロード
  7.  buildStep05Prompt() でプロンプトアセンブル
      - full_use = "Y" の scene のみを INPUT_DATA の scenes 配列として渡す
      - 全 scene の emotion / difficult_words / easy_rewrite も含める（論点3）
  8.  callGemini(prompt, buildGeminiOptionsStep05(configMap))
  9.  validateScriptFullAiResponse(text, assets.aiSchema)
  10. AI 出力の record_id と 02_Scenes.record_id を突合（順序ズレ検出）
  11. for each scene:
        - duration_sec をコード側で計算（論点3: 文字数 ÷ 5.5、切り捨て整数）
        - emotion = 02_Scenes.emotion のコピー（論点1）
        - ScriptFullRow を組み立て、upsertScriptFull()
  12. 00_Project を最小更新（current_step = "STEP_05_FULL_SCRIPT_BUILD"）
  13. 成功ログ

  ─── STEP_04 Short Script Build ──────────────────────────
  14. video_format = "short+full" の場合:
        loadFullScriptByProjectId() を試みる（不明点1: optional）
        hasFullScript = (結果.length > 0)
      video_format = "short" の場合:
        hasFullScript = false（仕様 §4.4）

  15. Short 用 assets を loadStep04Assets() でロード
  16. buildStep04Prompt() でプロンプトアセンブル
      - short_use = "Y" の scene のみを INPUT_DATA の scenes 配列として渡す（不明点6）
      - hasFullScript = true の場合: 対応 Full script の narration_draft/tts/pause_hint を
        scenes 配列の各要素に full_script_ref として追記
      - hasFullScript = false の場合: full_script_ref は含めない
  17. callGemini(prompt, buildGeminiOptionsStep04(configMap))
  18. validateScriptShortAiResponse(text, assets.aiSchema)
  19. AI 出力の record_id と 02_Scenes.record_id を突合（short_use=Y のもののみ）
  20. for each scene:
        - duration_sec をコード側で計算
        - emotion = 02_Scenes.emotion のコピー
        - ScriptShortRow を組み立て、upsertScriptShort()
  21. 00_Project を最小更新（下表の current_step 値）
  22. 成功ログ

  ─── partial success / 両方完了 ───────────────────────────
  23. 両方成功時: current_step = "STEP_04_05_COMBINED"
      Full のみ成功: current_step = "STEP_05_FULL_SCRIPT_BUILD"（step6〜13 で設定済み）
      Short のみ成功: current_step = "STEP_04_SHORT_SCRIPT_BUILD"
      両方失敗: current_step は更新しない（ログのみ）
```

### 6.2 `duration_sec` 計算ロジック

```typescript
/**
 * narration_tts の文字数から duration_sec を概算する。
 * 読み速度: 5.5 文字/秒（日本語音読の一般的な平均）
 * 結果は Math.ceil で整数化（切り上げ）する。
 */
function calcDurationSec(narrationTts: string): number {
  return Math.ceil(narrationTts.length / 5.5);
}
```

### 6.3 `record_id` 突合ロジック

AI 出力の各要素が持つ `record_id` と、事前に取得した `SceneReadRow[]` の `record_id` を照合する。  
順序ズレや欠落を検出し、ログ警告を出す。突合失敗時は **順序ベースのフォールバック**（配列インデックス順で紐付け）を使用する。

```typescript
function matchAiOutputToScenes(
  aiRows: ScriptFullAiRow[],   // or ScriptShortAiRow[]
  sceneRows: SceneReadRow[]    // full_use=Y または short_use=Y でフィルタ済み
): Array<{ ai: ScriptFullAiRow; scene: SceneReadRow }> {
  // 1. record_id マップで突合
  // 2. 突合できなかった要素は配列インデックス順でフォールバック
  // 3. 警告ログ
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
    // ... 全 full_use=Y scene
  ]
}
```

**AI への指示方針**:
- `scenes` 配列と同じ順序で `scripts` 配列を返す（1 scene = 1 script row）
- 各行に `record_id` を必ず含める（紐付け用）
- `emotion` は出力しない（コード側でコピーするため）
- `duration_sec` は出力しない（コード側で計算するため）
- `full_target_sec` を意識しつつ物語品質優先、+15% 許容
- `subtitle_short_1/2` は意味・感情・読みやすさを優先した自然な分割

### 7.2 STEP_04 Short プロンプト（`prompts/script_short_prompt_v1.md`）

**プレースホルダー構成**（Full 参照あり/なしで分岐するプレースホルダー）:

| プレースホルダー | 内容 |
|---|---|
| `{{INPUT_DATA}}` | project 情報 + 02_Scenes 行配列（short_use=Y のみ）+ Full 参照（任意） |
| `{{HAS_FULL_SCRIPT}}` | `"true"` or `"false"`（Full 参照の有無を AI に伝える） |
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
      "chapter": "導入",
      "scene_title": "大きな桃が川から流れてくる",
      "scene_summary": "...",
      "scene_goal": "...",
      "visual_focus": "...",
      "emotion": "ふしぎ、わくわく",
      "est_duration_short": 18,
      "difficult_words": "どんぶらこ",
      "easy_rewrite": "ぷかぷか流れてくる",
      "continuity_note": "...",
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
          "record_id":        { "type": "string" },
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
          "record_id":        { "type": "string" },
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

### 9.1 `validateScriptFullAiResponse`

```typescript
export interface ScriptFullValidationResult {
  success: true;
  scripts: ScriptFullAiRow[];
}
export interface ScriptFullValidationFailure {
  success: false;
  errors: string;
  rawText: string;
}
export type ValidateScriptFullResult =
  | ScriptFullValidationResult
  | ScriptFullValidationFailure;

export function validateScriptFullAiResponse(
  rawText: string,
  schema: string
): ValidateScriptFullResult
```

### 9.2 `validateScriptShortAiResponse`

同様のパターンで `ScriptShortAiRow[]` を返す。

### 9.3 追加バリデーションルール

スキーマ検証後に以下をコード側で追加チェックする:

| チェック | 内容 | エラー種別 |
|---|---|---|
| `record_id` 存在チェック | AI 出力の各 `record_id` が `02_Scenes` に存在するか | `record_id_mismatch`（警告レベル） |
| 件数チェック | AI 出力件数と入力 scenes 件数が一致するか | `scene_count_mismatch`（警告レベル） |
| 必須フィールド空文字チェック | `narration_draft` 等が空文字でないか | `empty_required_field`（エラーレベル） |

---

## 10. Gemini オプション設計（`src/lib/call-gemini.ts` 追記）

```typescript
export function buildGeminiOptionsStep05(configMap: RuntimeConfigMap): GeminiCallOptions {
  // step_05_model_role → model_role_text_pro → model_role_text_flash_seconday
  // maxOutputTokens: 32768（一括生成のため STEP_03 の 2 倍）
}

export function buildGeminiOptionsStep04(configMap: RuntimeConfigMap): GeminiCallOptions {
  // step_04_model_role → model_role_text_pro → model_role_text_flash_seconday
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

```typescript
// STEP_05 Full
buildStep05SuccessLog(projectId, recordId, message): AppLogRow
buildStep05FailureLog(projectId, recordId, errorType, message): AppLogRow

// STEP_04 Short
buildStep04SuccessLog(projectId, recordId, message): AppLogRow
buildStep04FailureLog(projectId, recordId, errorType, message): AppLogRow
```

**ログメッセージに含める情報**:

| イベント | ログ内容 |
|---|---|
| STEP_05 開始 | `[INFO][start] STEP_05 started. scene_count=N, full_use_count=N` |
| STEP_05 完了 | `[INFO][success] STEP_05 completed. model=..., usedFallback=..., script_count=N, duration_sec_total=N` |
| STEP_04 開始 | `[INFO][start] STEP_04 started. short_use_count=N, has_full_script=true/false` |
| STEP_04 完了 | `[INFO][success] STEP_04 completed. model=..., usedFallback=..., script_count=N` |
| short only | `[INFO][short_only] video_format=short. Full script not referenced.` |
| partial success | `[WARN][partial_success] Full=success/fail, Short=success/fail` |
| schema 失敗 | `[ERROR][schema_validation_failure] ...` |
| GSS 書き込み失敗 | `[ERROR][gss_write_failure] ...` |

---

## 12. エラーハンドリング設計

| エラー種別 | 対処 | `approval_status` |
|---|---|---|
| `02_Scenes` 0 件 | エラー停止、ログ、次 project へ | 更新しない |
| `video_format` 不正 | エラー停止、ログ | 更新しない |
| Full schema 失敗 | Full を失敗扱い、Short 実行可能なら継続 | `PENDING`（partial） |
| Short schema 失敗 | Short を失敗扱い、Full 書き込み済みなら維持 | `PENDING`（partial） |
| Full GSS 書き込み失敗 | ログ、partial success | `PENDING` |
| Short GSS 書き込み失敗 | ログ、partial success | `PENDING` |
| Spending Cap | 即時停止（残 project スキップ） | 更新しない |
| 両方失敗 | ログのみ、`current_step` 更新しない | 更新しない |

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
| 1 | `src/types.ts` | 新 interface 追加（§4） | 🔴 最高 |
| 2 | `src/lib/load-scenes.ts` | 02_Scenes 読み込みモジュール（新規） | 🔴 最高 |
| 3 | `schemas/script_full_schema_ai_v1.json` | Full AI 出力スキーマ（§8.1） | 🔴 最高 |
| 4 | `schemas/script_short_schema_ai_v1.json` | Short AI 出力スキーマ（§8.2） | 🔴 最高 |
| 5 | `schemas/script_full_schema_full_v1.json` | Full 書き込み行スキーマ | 🔴 最高 |
| 6 | `schemas/script_short_schema_full_v1.json` | Short 書き込み行スキーマ | 🔴 最高 |
| 7 | `src/lib/validate-json.ts` | ScriptFull / Short バリデーター追記 | 🔴 最高 |
| 8 | `src/lib/write-script-full.ts` | Full upsert モジュール（新規） | 🔴 最高 |
| 9 | `src/lib/write-script-short.ts` | Short upsert モジュール（新規） | 🔴 最高 |
| 10 | `src/lib/load-assets.ts` | Step04 / Step05 Assets 追記 | 🔴 最高 |
| 11 | `src/lib/call-gemini.ts` | buildGeminiOptionsStep04/05 追記 | 🔴 最高 |
| 12 | `src/lib/build-prompt.ts` | buildStep04Prompt / buildStep05Prompt 追記 | 🔴 最高 |
| 13 | `src/lib/write-app-log.ts` | Step04/05 ログビルダー追記 | 🔴 最高 |
| 14 | `src/steps/step04-05-script-build.ts` | オーケストレーター（新規）（§6） | 🔴 最高 |
| 15 | `src/index.ts` | STEP_04_05 ルーティング追記 | 🔴 最高 |
| 16 | `prompts/script_full_prompt_v1.md` | Full プロンプトテンプレート | 🟡 高 |
| 17 | `prompts/script_short_prompt_v1.md` | Short プロンプトテンプレート | 🟡 高 |
| 18 | `prompts/fragments/script_output_field_guide_full_v1.md` | Full フィールドガイド | 🟡 高 |
| 19 | `prompts/fragments/script_output_field_guide_short_v1.md` | Short フィールドガイド | 🟡 高 |
| 20 | `examples/script_full_ai_response_example_v1.json` | Full サンプル | 🟡 高 |
| 21 | `examples/script_short_ai_response_example_v1.json` | Short サンプル | 🟡 高 |
| 22 | `src/lib/load-script.ts` | 04_Script_Full 読み込みモジュール（新規） | 🟢 中 |
| 23 | `src/scripts/dry-run-step04-05.ts` | dry-run スクリプト | 🟢 中 |
| 24 | `schemas/README.md` | 新スキーマ説明追記 | 🟢 中 |

---

## 16. 将来最適化メモ（論点2）

> **FUTURE_OPTIMIZATION_C**: `video_format = short+full` 時に Full / Short を
> 1 回の Gemini 呼び出しで同時生成する。  
> プロンプトで `{ "scripts_full": [...], "scripts_short": [...] }` の 2 配列を
> 1 回の応答で返させる方式。  
> **採用条件**: Full と Short の narration 品質差が実運用上問題にならないと確認できた場合。  
> **未解決課題**: 1 プロンプトの複雑化、出力トークン数のさらなる増大、
> Full/Short の個別 schema バリデーションの難化。

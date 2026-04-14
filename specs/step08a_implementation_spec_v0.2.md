# STEP_08A TTS Subtitle & Edit Plan Build 実装設計書 v0.2

> **ステータス**: 確定（オーナー判断反映済み 2026-04-13）
> **改訂履歴**:
> - v0.1 (2026-04-12): 初版（論点1〜5 のオーナー判断反映版）
> - v0.2 (2026-04-13): record_id 引き継ぎ・tts_text SSML 化・speech_rate RuntimeConfig 化・pause_hint/emphasis_word INPUT_DATA 追加
> **元仕様**: `docs/02_process_flow.md`、`docs/GSS_field_master.tsv`
> **前提実装**: STEP_01〜07 のコードパターンを継承する

---

## 1. 本書の目的

STEP_08A TTS Subtitle & Edit Plan Build の実装設計を定義する。

本ステップは `03_Script_Short` / `04_Script_Full` のナレーションテキストと
`02_Scenes` のシーン情報を入力として Gemini が以下を生成する:

- **`08_TTS_Subtitles`**: SSML 形式の TTS 音声指示テキスト（tts_text）、音声パラメータ（voice_style / speech_rate / pitch_hint / emotion_hint）、字幕テキスト（subtitle_text / subtitle_text_alt）
- **`09_Edit_Plan`**: 映像編集計画（duration_sec / camera_motion / transition_in/out / bgm_section / sfx 等）

`tc_in` / `tc_out` / `audio_file` / `asset_audio` は本ステップでは空欄とし、
後続の STEP_08B（TTS 音声生成）で埋める。

---

## 2. 確定した設計判断

| # | 論点 | 判断 | 実装への影響 |
|---|---|---|---|
| 論点1 | AI 呼び出し | **1回のAI呼び出しで両シート分を1 JSON生成** | レスポンスに `tts_subtitles[]` + `edit_plan[]` をネストする構造 |
| 論点2 | Full/Short の扱い | **`video_format` ドリブン分岐** | `full` → Full のみ。`short` → Short のみ。`short+full` → Full → Short の順に各1回呼び出し |
| 論点3 | `line_no` の粒度 | **1シーン = 1行固定**（`line_no` 常に `1`） | `narration_tts`（Script）のみがソースのため単行 |
| 論点4 | `tc_in` / `tc_out` | **空欄保存**（STEP_08B で入力） | AI 出力スキーマから除外。書き込み時は `""` 固定 |
| 論点5 | `asset_image` | **空欄可**（STEP_07 完了時は自動参照） | STEP_07 未完了でも進行。完了していれば `06_Image_Prompts.image_take_1` を格納 |
| 論点6 | `record_id` | **Script の record_id をそのまま引き継ぐ** | `03_Script_Short` / `04_Script_Full` の record_id（= `02_Scenes` 由来: `PJT-001-SCN-001` 形式）を使用。新規採番なし |
| 論点7 | upsert キー | **`record_id + related_version` 複合キー** | 同一シートに Full/Short 両バージョンが共存するため record_id 単体では一意性が保てない |
| 論点8 | `tts_text` | **Gemini が生成した SSML 文字列** | `narration_tts` をベースに `pause_hint` / `emphasis_word` / `emotion_hint` を反映した `<speak>〜</speak>` SSML を Gemini が出力 |
| 論点9 | `speech_rate` 数値 | **RuntimeConfig 管理**（読み聞かせ基準速度） | `tts_speaking_rate_{slow\|normal\|fast}` キーで管理。デフォルト: slow=0.75 / normal=0.82 / fast=0.92 |
| 論点10 | Short の `pause_hint` | **Short 版は非対応**（Gemini が文脈判断） | `03_Script_Short` に `pause_hint` フィールドが存在しないため、Gemini が scene_summary / emotion から pause 位置を推定する |

### `voice_style` 固定 enum

1物語 = 1声優（voice name 固定）。`voice_style` はシーンごとの**演技トーン**を表す。

| 値 | 意味 | 使用例 |
|---|---|---|
| `narrator` | 標準ナレーション（落ち着いた第三者視点） | 物語冒頭・状況説明 |
| `gentle` | やさしい・温かみのある語り口 | 穏やかな日常シーン |
| `excited` | 明るく活気のある表現 | 喜び・発見・勝利場面 |
| `tense` | 緊張感・ドラマティックな場面 | 対峙・葛藤・クライマックス |
| `whisper` | ひそやか・内緒話・思索的 | 噂話・独白・秘密の場面 |
| `cheerful` | 子ども向け・元気いっぱい | 子ども登場・歌・游び場面 |

### `speech_rate` 固定 enum（実数値は RuntimeConfig 管理）

児童向け読み聞かせを想定し、デフォルト速度は機械的な「normal=1.0」より遅めに設定する。

| 値 | 意味 | デフォルト `speakingRate` | RuntimeConfig キー |
|---|---|---|---|
| `slow` | ゆっくり（感動・説明・強調場面） | `0.75` | `tts_speaking_rate_slow` |
| `normal` | 読み聞かせ標準速度 | `0.82` | `tts_speaking_rate_normal` |
| `fast` | 速め（テンポよい展開・緊張場面） | `0.92` | `tts_speaking_rate_fast` |

### `camera_motion` 固定 enum

| 値 | 意味 |
|---|---|
| `static` | 固定（動きなし） |
| `slow_pan_right` | ゆっくり右へパン |
| `slow_pan_left` | ゆっくり左へパン |
| `slow_zoom_in` | ゆっくりズームイン |
| `slow_zoom_out` | ゆっくりズームアウト |
| `ken_burns` | ケンバーンズ効果（ズーム＋パンの組み合わせ） |

### `transition_in` / `transition_out` 固定 enum

| 値 | 意味 |
|---|---|
| `cut` | 即時切り替え |
| `fade` | フェード（黒） |
| `fade_white` | ホワイトフェード |
| `dissolve` | ディゾルブ（重ねて切り替え） |

### `current_step` 設定値

| 実行状態 | `current_step` 値 |
|---|---|
| 成功（Full or Short いずれか1つ以上） | `STEP_08A_TTS_SUBTITLE` |
| 失敗 | 更新しない |

---

## 3. ファイル構成（新規作成対象）

```
src/
  steps/
    step08a-tts-subtitle-edit-plan.ts    # オーケストレーター

  lib/
    write-tts-subtitles.ts               # 08_TTS_Subtitles upsert
    write-edit-plan.ts                   # 09_Edit_Plan upsert
    load-tts-subtitles.ts                # 08_TTS_Subtitles 読み込み（再実行時の record_id 確認用）
    load-edit-plan.ts                    # 09_Edit_Plan 読み込み（再実行時の record_id 確認用）

  scripts/
    dry-run-step08a.ts                   # dry-run スクリプト

prompts/
  tts_subtitle_edit_plan_prompt_v1.md    # STEP_08A プロンプトテンプレート

schemas/
  tts_subtitle_schema_ai_v1.json         # AI 出力バリデーション用スキーマ（両シート共通）
  tts_subtitle_schema_full_v1.json       # 08_TTS_Subtitles GSS 書き込み行バリデーション用
  edit_plan_schema_full_v1.json          # 09_Edit_Plan GSS 書き込み行バリデーション用

examples/
  tts_subtitle_ai_response_example_v1.json    # AI 出力サンプル（桃太郎 / Full版）
  tts_subtitle_full_response_example_v1.json  # 08_TTS_Subtitles 書き込み行サンプル
  edit_plan_full_response_example_v1.json     # 09_Edit_Plan 書き込み行サンプル
```

### 既存ファイルへの追記対象

```
src/
  types.ts                          # TtsSubtitleAiRow / TtsSubtitleRow / TtsSubtitleReadRow
                                    # EditPlanAiRow / EditPlanRow / EditPlanReadRow 追加
  index.ts                          # STEP_08A ルーティング追加

  lib/
    load-assets.ts                  # loadStep08aAssets() 追加
    build-prompt.ts                 # buildStep08aFullPrompt() / buildStep08aShortPrompt() 追加
    call-gemini.ts                  # buildGeminiOptionsStep08a() 追加
    write-app-log.ts                # buildStep08aSuccessLog() / buildStep08aFailureLog() 追加
```

---

## 4. 処理フロー（オーケストレーター）

```
1. 00_Project から ProjectRow を取得
2. video_format を検証（"full" | "short" | "short+full"）
3. 02_Scenes から全 scene を取得（generation_status = "GENERATED"）
4. 既存の 08_TTS_Subtitles / 09_Edit_Plan を取得（再実行時の重複チェック用）
5. video_format に応じて以下を実行:

   [full または short+full の場合]
   5a-1. full_use=Y の scene をフィルタ
   5a-2. 04_Script_Full から narration_tts / subtitle_short_1/2 / emphasis_word /
          pause_hint / duration_sec を取得（scene_record_id で突合）
   5a-3. Full プロンプトを組み立て → Gemini 呼び出し
   5a-4. AJV スキーマ検証（tts_subtitles[] + edit_plan[]）
   5a-5. 06_Image_Prompts から asset_image を取得（任意: STEP_07 完了時のみ）
   5a-6. 08_TTS_Subtitles に upsert（related_version="full"、upsert キー: record_id + related_version）
   5a-7. 09_Edit_Plan に upsert（related_version="full"、同上）

   [short または short+full の場合]
   5b-1. short_use=Y の scene をフィルタ
   5b-2. 03_Script_Short から narration_tts / subtitle_short_1/2 / emphasis_word /
          duration_sec を取得（pause_hint は Short に存在しないため除外）
   5b-3. Short プロンプトを組み立て（short+full の場合は Full 生成結果も参照情報として含める）
   5b-4. Gemini 呼び出し
   5b-5. AJV スキーマ検証
   5b-6. 08_TTS_Subtitles に upsert（related_version="short"）
   5b-7. 09_Edit_Plan に upsert（related_version="short"）

   ※ short+full の場合、Full が失敗したら Short もスキップ（依存関係あり）

6. 00_Project を最小更新（current_step = "STEP_08A_TTS_SUBTITLE"）
7. 100_App_Logs にログ記録
```

---

## 5. record_id 採番方針

### 08_TTS_Subtitles

- **record_id は `03_Script_Short` / `04_Script_Full` の record_id をそのまま引き継ぐ**
  - 例: `PJT-001-SCN-001`（`02_Scenes` 由来の形式）
  - 新規採番は行わない
- **upsert キー: `record_id + related_version` の複合キー**
  - 同一シートに Full/Short 両バージョンが共存するため record_id 単体では衝突する
  - 例: `(PJT-001-SCN-001, "full")` と `(PJT-001-SCN-001, "short")` は別行として管理
- 再実行時: 同一 `record_id + related_version` の行を UPDATE（存在しなければ INSERT）
- 余剰行は残置（DELETE 禁止）

### 09_Edit_Plan

- **record_id 引き継ぎ・upsert キー**は 08_TTS_Subtitles と同一ルール
- TTS と Edit Plan は同一シーン・同一 related_version で 1:1 対応

---

## 6. GSS フィールドマッピング

### 08_TTS_Subtitles

| フィールド | role | 値の設定元 |
|---|---|---|
| `project_id` | SYSTEM_CONTROL | オーケストレーターがセット |
| `record_id` | SYSTEM_CONTROL | Script（03 or 04）の `record_id` を引き継ぎ |
| `generation_status` | SYSTEM_CONTROL | `"GENERATED"` 固定 |
| `approval_status` | HUMAN_REVIEW | `"PENDING"` 固定 |
| `step_id` | SYSTEM_CONTROL | `"STEP_08A_TTS_SUBTITLE"` 固定 |
| `scene_no` | SYSTEM_CONTROL | `02_Scenes.scene_no`（表示補助） |
| `line_no` | SYSTEM_CONTROL | `1` 固定 |
| `related_version` | SYSTEM_CONTROL | `"full"` or `"short"` |
| `tts_text` | AI_OUTPUT | Gemini が生成した SSML 文字列（`<speak>〜</speak>`）。`narration_tts` + `pause_hint` / `emphasis_word` / `emotion_hint` を素材として構築 |
| `voice_style` | AI_OUTPUT | Gemini 出力（固定 enum）。scene の emotion / 場面性から選択 |
| `speech_rate` | AI_OUTPUT | Gemini 出力（固定 enum）。場面テンポから選択 |
| `pitch_hint` | AI_OUTPUT | Gemini 出力（自由記述）。SSML 生成の意図説明。STEP_08B では TTS API に直接渡さない |
| `emotion_hint` | AI_OUTPUT | Gemini 出力（自由記述）。SSML 生成の意図説明。同上 |
| `audio_file` | REFERENCE | `""` 固定（STEP_08B で書き戻し） |
| `subtitle_text` | AI_OUTPUT | Gemini 出力（主字幕テキスト・プレーンテキスト） |
| `subtitle_text_alt` | AI_OUTPUT | Gemini 出力（副字幕テキスト・空文字可） |
| `tc_in` | REFERENCE | `""` 固定（STEP_08B で書き戻し） |
| `tc_out` | REFERENCE | `""` 固定（STEP_08B で書き戻し） |
| `subtitle_style` | AI_OUTPUT | Gemini 出力（自由記述: 例 `"white_bold_bottom"`） |
| `reading_check` | HUMAN_REVIEW | `""` 固定（手動入力用） |
| `lip_sync_note` | HUMAN_REVIEW | `""` 固定（手動入力用） |
| `updated_at` | SYSTEM_CONTROL | `new Date().toISOString()` |
| `updated_by` | SYSTEM_CONTROL | `"github_actions"` 固定 |
| `notes` | HUMAN_REVIEW | `""` 固定（手動入力用） |

> `tc_in` / `tc_out` は GSS_field_master 上 `AI_OUTPUT` 区分だが、本システムでは
> STEP_08B（TTS 実測値）で書き戻すため `REFERENCE` として扱う。

### 09_Edit_Plan

| フィールド | role | 値の設定元 |
|---|---|---|
| `project_id` | SYSTEM_CONTROL | オーケストレーターがセット |
| `record_id` | SYSTEM_CONTROL | Script の `record_id` を引き継ぎ |
| `generation_status` | SYSTEM_CONTROL | `"GENERATED"` 固定 |
| `approval_status` | HUMAN_REVIEW | `"PENDING"` 固定 |
| `step_id` | SYSTEM_CONTROL | `"STEP_08A_TTS_SUBTITLE"` 固定 |
| `scene_no` | SYSTEM_CONTROL | `02_Scenes.scene_no`（表示補助） |
| `related_version` | SYSTEM_CONTROL | `"full"` or `"short"` |
| `asset_image` | REFERENCE | `06_Image_Prompts.image_take_1`（STEP_07 完了時のみ、なければ `""`） |
| `asset_audio` | REFERENCE | `""` 固定（STEP_08B で書き戻し） |
| `duration_sec` | AI_OUTPUT | Gemini 出力（推定秒数）。STEP_08B で実測値に上書きされる |
| `camera_motion` | AI_OUTPUT | Gemini 出力（固定 enum） |
| `transition_in` | AI_OUTPUT | Gemini 出力（固定 enum） |
| `transition_out` | AI_OUTPUT | Gemini 出力（固定 enum） |
| `bgm_section` | AI_OUTPUT | Gemini 出力（自由記述: 例 `"intro"`, `"verse_1"`, `"climax"`） |
| `sfx` | AI_OUTPUT | Gemini 出力（自由記述・空文字可） |
| `subtitle_on` | AI_OUTPUT | Gemini 出力（`"Y"` or `"N"`） |
| `text_overlay_on` | AI_OUTPUT | Gemini 出力（`"Y"` or `"N"`） |
| `qa_insert_after` | AI_OUTPUT | Gemini 出力（`"Y"` or `"N"`） |
| `note` | HUMAN_REVIEW | `""` 固定（手動入力用） |
| `updated_at` | SYSTEM_CONTROL | `new Date().toISOString()` |
| `updated_by` | SYSTEM_CONTROL | `"github_actions"` 固定 |
| `notes` | HUMAN_REVIEW | `""` 固定（手動入力用） |

---

## 7. AI 出力スキーマ（概要）

1回の Gemini 呼び出しで `tts_subtitles[]` と `edit_plan[]` の両配列を返す。
各配列の要素数はフィルタ後のシーン数と必ず一致させること（AI への制約指示あり）。

### `tts_text` の SSML 生成ルール（Gemini へのプロンプト指示）

Gemini は以下の素材を使い `<speak>〜</speak>` 形式の SSML を生成する:

| 素材フィールド | SSML への反映 |
|---|---|
| `narration_tts` | SSML のベーステキスト |
| `pause_hint`（Full 版のみ） | `<break time="Xms"/>` に変換 |
| `emphasis_word` | `<emphasis level="moderate">word</emphasis>` に変換 |
| `emotion_hint` | `<prosody>` 全体のトーン設定の意図情報（Gemini が解釈） |
| `pitch_hint` | `<prosody pitch="+Nst">` への変換ヒント（Gemini が解釈） |

**擬音語・擬態語・固有名詞への対応**（日本語アクセント問題の予防）:
- Gemini は `narration_tts` 中に擬音語（例: どんぶらこ・ドカーン）・擬態語・珍しい固有名詞が含まれる場合、
  標準的な日本語ピッチアクセントに基づいた SSML 読み指示（`<sub>` または `<phoneme>` タグ）を付与する
- 例: `<sub alias="どんぶらこ">どんぶらこ</sub>` や読み補助のフリガナ挿入

```json
{
  "tts_subtitles": [
    {
      "scene_record_id": "PJT-001-SCN-002",
      "tts_text": "<speak><prosody rate=\"0.80\">大きな桃が、<break time=\"300ms\"/><sub alias=\"どんぶらこ\">どんぶらこ</sub>、<emphasis level=\"moderate\">どんぶらこ</emphasis>と流れてきました。</prosody></speak>",
      "voice_style": "narrator",
      "speech_rate": "normal",
      "pitch_hint": "やや落ち着いたトーン。どんぶらこは擬音として強調",
      "emotion_hint": "穏やかな驚き・発見の場面。子どもが想像しやすい語り口で",
      "subtitle_text": "大きな桃が、どんぶらこと",
      "subtitle_text_alt": "流れてきました。",
      "subtitle_style": "white_bold_bottom"
    }
  ],
  "edit_plan": [
    {
      "scene_record_id": "PJT-001-SCN-002",
      "duration_sec": 5.5,
      "camera_motion": "slow_zoom_in",
      "transition_in": "dissolve",
      "transition_out": "dissolve",
      "bgm_section": "verse_1",
      "sfx": "water_stream",
      "subtitle_on": "Y",
      "text_overlay_on": "N",
      "qa_insert_after": "N"
    }
  ]
}
```

> `scene_record_id` は AI 出力の照合用のみ（GSS には書き込まない）。
> 詳細は `schemas/tts_subtitle_schema_ai_v1.json` を参照。

---

## 8. Gemini 設定

| 設定 | 値 |
|---|---|
| primary model | `gemini-2.5-flash`（`94_Runtime_Config` key: `step_08a_model_role`） |
| fallback model | `model_role_text_flash`（`94_Runtime_Config` 同名キー） |
| `maxOutputTokens` | `8192` |

> `buildGeminiOptionsStep08a()` を `src/lib/call-gemini.ts` に追加する。

---

## 9. エラーハンドリング方針

| エラー種別 | 挙動 |
|---|---|
| project not found | `100_App_Logs` にエラー記録。当該 project をスキップ |
| video_format 不正 | 同上 |
| scenes 0件（full_use=Y または short_use=Y） | 同上 |
| Script シート 0件（対象シーンに Script 未生成） | 同上 |
| Gemini 呼び出し失敗 | 同上 |
| スキーマ検証失敗 | 同上 |
| `tts_subtitles` と `edit_plan` の件数不一致 | 検証エラーとして記録。upsert せずにスキップ |
| scene_record_id の照合失敗 | 検証エラーとして記録。当該バージョンの upsert をスキップ |
| upsert 失敗（行単位） | 失敗行のみ記録。成功行は確定 |
| short+full で Full 失敗 | Short もスキップ（依存関係）。両方をエラー記録 |
| GeminiSpendingCapError | 全プロジェクト停止（上位に throw） |

---

## 10. dry-run スクリプト

`src/scripts/dry-run-step08a.ts` を追加する（実装フェーズで作成）。

- `DRY_RUN=true`: プロンプトアセンブルのみ（Gemini 呼び出しなし）
- `DRY_RUN=false`: Gemini 呼び出し + スキーマ検証（GSS 書き込みなし）
- モック: `PJT-001`（桃太郎）を使用

---

## 11. 型定義設計（`src/types.ts` 追記）

### 11.1 `StepId`（更新）

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
  | "STEP_07_IMAGE_PROMPTS"
  | "STEP_08A_TTS_SUBTITLE"    // ← 追加
  | "STEP_09_QA_BUILD";
```

### 11.2 `TtsSubtitleVersion`（新規）

```typescript
/** 08_TTS_Subtitles / 09_Edit_Plan の related_version 固定 enum */
export type TtsSubtitleVersion = "full" | "short";
```

### 11.3 `TtsSubtitleAiRow`（新規）

```typescript
/**
 * STEP_08A TTS Subtitle — AI が返す 1 scene 分の TTS 字幕 row
 * スキーマ: tts_subtitle_schema_ai_v1.json
 *
 * record_id / line_no / tc_in / tc_out は AI 出力に含めない（システム側で付与 or 空欄固定）。
 * scene_record_id は 02_Scenes.record_id と照合するためのキー（GSS には書き込まない）。
 * tts_text は narration_tts を素材として Gemini が生成した SSML 文字列（<speak>〜</speak>）。
 * pitch_hint / emotion_hint は SSML 生成意図の説明文。STEP_08B では TTS API に渡さない。
 */
export interface TtsSubtitleAiRow {
  scene_record_id:  string;   // 照合用: Script.record_id（GSS 書き込み対象外）
  tts_text:         string;   // SSML 文字列（<speak>〜</speak>）
  voice_style:      "narrator" | "gentle" | "excited" | "tense" | "whisper" | "cheerful";
  speech_rate:      "slow" | "normal" | "fast";
  pitch_hint:       string;   // SSML 生成意図の説明（例: "やや高め"）
  emotion_hint:     string;   // SSML 生成意図の説明（例: "優しく温かく"）
  subtitle_text:    string;   // 主字幕テキスト（プレーンテキスト）
  subtitle_text_alt: string;  // 副字幕テキスト（空文字可）
  subtitle_style:   string;   // 自由記述（例: "white_bold_bottom"）
  [key: string]: unknown;     // AJV バリデーション互換
}
```

### 11.4 `TtsSubtitleRow`（新規）

```typescript
/**
 * Google Sheets 08_TTS_Subtitles 書き込み行（tts_subtitle_schema_full_v1）
 *
 * record_id は 03_Script_Short / 04_Script_Full から引き継ぐ（新規採番なし）。
 * upsert キー: record_id + related_version の複合キー。
 * tc_in / tc_out / audio_file は STEP_08B で書き戻す → 本ステップでは "" 固定。
 */
export interface TtsSubtitleRow {
  project_id:        string;
  record_id:         string;    // Script から引き継ぎ（例: PJT-001-SCN-001）
  generation_status: "GENERATED" | "FAILED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;    // 固定: "STEP_08A_TTS_SUBTITLE"
  scene_no:          string;    // 表示補助: 02_Scenes.scene_no
  line_no:           number;    // 固定: 1
  related_version:   TtsSubtitleVersion;
  tts_text:          string;    // SSML 文字列
  voice_style:       string;
  speech_rate:       string;
  pitch_hint:        string;
  emotion_hint:      string;
  audio_file:        "";        // STEP_08B で書き戻し
  subtitle_text:     string;
  subtitle_text_alt: string;
  tc_in:             "";        // STEP_08B で書き戻し
  tc_out:            "";        // STEP_08B で書き戻し
  subtitle_style:    string;
  reading_check:     "";        // 手動入力用
  lip_sync_note:     "";        // 手動入力用
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}
```

### 11.5 `TtsSubtitleReadRow`（新規）

```typescript
/** 08_TTS_Subtitles から読み込む参照用 row（再実行時の重複チェック用） */
export interface TtsSubtitleReadRow {
  project_id:      string;
  record_id:       string;
  related_version: TtsSubtitleVersion;
}
```

### 11.6 `EditPlanAiRow`（新規）

```typescript
/**
 * STEP_08A Edit Plan — AI が返す 1 scene 分の編集計画 row
 * スキーマ: tts_subtitle_schema_ai_v1.json（TTS と同一レスポンスに含まれる）
 *
 * scene_record_id は照合用（GSS には書き込まない）。
 */
export interface EditPlanAiRow {
  scene_record_id: string;   // 照合用: Script.record_id（GSS 書き込み対象外）
  duration_sec:    number;   // 推定秒数（小数点1桁）。STEP_08B の実測値で上書きされる
  camera_motion:   "static" | "slow_pan_right" | "slow_pan_left" | "slow_zoom_in" | "slow_zoom_out" | "ken_burns";
  transition_in:   "cut" | "fade" | "fade_white" | "dissolve";
  transition_out:  "cut" | "fade" | "fade_white" | "dissolve";
  bgm_section:     string;   // 自由記述（例: "intro", "verse_1", "climax"）
  sfx:             string;   // 自由記述・空文字可
  subtitle_on:     "Y" | "N";
  text_overlay_on: "Y" | "N";
  qa_insert_after: "Y" | "N";
  [key: string]: unknown;    // AJV バリデーション互換
}
```

### 11.7 `EditPlanRow`（新規）

```typescript
/**
 * Google Sheets 09_Edit_Plan 書き込み行（edit_plan_schema_full_v1）
 *
 * record_id は Script から引き継ぐ（新規採番なし）。
 * upsert キー: record_id + related_version の複合キー。
 */
export interface EditPlanRow {
  project_id:        string;
  record_id:         string;    // Script から引き継ぎ（例: PJT-001-SCN-001）
  generation_status: "GENERATED" | "FAILED" | "PENDING";
  approval_status:   "PENDING" | "APPROVED" | "REJECTED";
  step_id:           string;    // 固定: "STEP_08A_TTS_SUBTITLE"
  scene_no:          string;    // 表示補助: 02_Scenes.scene_no
  related_version:   TtsSubtitleVersion;
  asset_image:       string;    // 06_Image_Prompts.image_take_1（なければ ""）
  asset_audio:       "";        // STEP_08B で書き戻し
  duration_sec:      number;    // AI 推定値（STEP_08B で実測値に上書き）
  camera_motion:     string;
  transition_in:     string;
  transition_out:    string;
  bgm_section:       string;
  sfx:               string;
  subtitle_on:       string;    // "Y" | "N"
  text_overlay_on:   string;    // "Y" | "N"
  qa_insert_after:   string;    // "Y" | "N"
  note:              "";        // 手動入力用
  updated_at:        string;
  updated_by:        string;
  notes:             string;
}
```

### 11.8 `EditPlanReadRow`（新規）

```typescript
/** 09_Edit_Plan から読み込む参照用 row（再実行時の重複チェック用） */
export interface EditPlanReadRow {
  project_id:      string;
  record_id:       string;
  related_version: TtsSubtitleVersion;
}
```

---

## 12. モジュール設計

### 12.1 `src/steps/step08a-tts-subtitle-edit-plan.ts`

```typescript
export async function runStep08aTtsSubtitleEditPlan(
  payload: WorkflowPayload
): Promise<void>
```

主要なヘルパー:

```typescript
// scene_record_id → AI 出力 item の Map を構築（照合用）
function buildAiOutputMap<T extends { scene_record_id: string }>(
  items: T[]
): Map<string, T>

// 06_Image_Prompts から scene の record_id → image_take_1 のマップを生成
function buildAssetImageMap(
  imagePromptRows: ImagePromptReadRow[]
): Map<string, string>
```

### 12.2 `src/lib/write-tts-subtitles.ts`

```typescript
/**
 * upsert キー: record_id + related_version の複合キー
 */
export async function upsertTtsSubtitles(
  rows: TtsSubtitleRow[],
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<void>
```

### 12.3 `src/lib/write-edit-plan.ts`

```typescript
/**
 * upsert キー: record_id + related_version の複合キー
 */
export async function upsertEditPlan(
  rows: EditPlanRow[],
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<void>
```

### 12.4 `src/lib/load-tts-subtitles.ts`

```typescript
export async function loadTtsSubtitlesByProjectId(
  projectId: string,
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<TtsSubtitleReadRow[]>
```

### 12.5 `src/lib/load-edit-plan.ts`

```typescript
export async function loadEditPlanByProjectId(
  projectId: string,
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<EditPlanReadRow[]>
```

---

## 13. INPUT_DATA 仕様（プロンプト注入 JSON）

### Full 版（04_Script_Full 使用）

```json
{
  "project_id": "PJT-001",
  "version": "full",
  "scenes": [
    {
      "scene_record_id": "PJT-001-SCN-002",
      "scene_no": "2",
      "scene_title": "桃が流れてくる",
      "scene_summary": "川で洗濯をしていたおばあさんが大きな桃が流れてくるのを見つける",
      "emotion": "gentle_surprise",
      "visual_focus": "川・大きな桃",
      "narration_tts": "大きな桃が、どんぶらこ、どんぶらこと流れてきました。",
      "emphasis_word": "どんぶらこ",
      "pause_hint": "「どんぶらこ」の後に間を入れる",
      "subtitle_short_1": "大きな桃が、どんぶらこと",
      "subtitle_short_2": "流れてきました。",
      "est_duration_full": 6
    }
  ]
}
```

### Short 版（03_Script_Short 使用）

`pause_hint` は Short に存在しないため除外。Gemini が scene_summary / emotion から pause 位置を推定する。

```json
{
  "project_id": "PJT-001",
  "version": "short",
  "scenes": [
    {
      "scene_record_id": "PJT-001-SCN-002",
      "scene_no": "2",
      "scene_title": "桃が流れてくる",
      "scene_summary": "川で洗濯をしていたおばあさんが大きな桃が流れてくるのを見つける",
      "emotion": "gentle_surprise",
      "visual_focus": "川・大きな桃",
      "narration_tts": "大きな桃がどんぶらこと流れてきました。",
      "emphasis_word": "どんぶらこ",
      "subtitle_short_1": "大きな桃がどんぶらこと",
      "subtitle_short_2": "流れてきました。",
      "est_duration_short": 4
    }
  ],
  "full_reference": [
    {
      "scene_record_id": "PJT-001-SCN-002",
      "tts_text": "<speak>...</speak>",
      "voice_style": "narrator",
      "duration_sec": 5.5
    }
  ]
}
```

---

## 14. 100_App_Logs Upsert 仕様

| タイミング | `error_type` | `app_log` 形式 |
|---|---|---|
| project not found | `PROJECT_NOT_FOUND` | `[ERROR][PROJECT_NOT_FOUND] project_id={id}` |
| video_format 不正 | `INVALID_VIDEO_FORMAT` | `[ERROR][INVALID_VIDEO_FORMAT] value={val}` |
| scenes 0件 | `NO_SCENES` | `[ERROR][NO_SCENES] version={full\|short}` |
| Script 0件 | `NO_SCRIPT` | `[ERROR][NO_SCRIPT] version={full\|short}` |
| Gemini 失敗 | `GEMINI_ERROR` | `[ERROR][GEMINI_ERROR] version={val} msg={e.message}` |
| スキーマ検証失敗 | `SCHEMA_VALIDATION_ERROR` | `[ERROR][SCHEMA_VALIDATION_ERROR] version={val} errors={json}` |
| 件数不一致 | `COUNT_MISMATCH` | `[ERROR][COUNT_MISMATCH] tts={n} ep={m}` |
| upsert 失敗 | `UPSERT_ERROR` | `[ERROR][UPSERT_ERROR] sheet={name} record_id={id}` |
| 成功 | — | `[INFO][SUCCESS] version={val} tts_count={n} ep_count={m}` |

- `record_id` には `{project_id}-STEP08A` を使用（プロジェクト単位のログ）
- `current_step` には `"STEP_08A_TTS_SUBTITLE"` を使用

---

## 15. オーケストレーター設計詳細

```
runStep08aTtsSubtitleEditPlan(payload)
│
├─ for each project_id in payload.project_ids
│   │
│   ├─ [PREFLIGHT]
│   │   ├─ loadProject(project_id) → ProjectRow
│   │   ├─ validate video_format ∈ {"full","short","short+full"}
│   │   └─ loadScenes(project_id) → SceneReadRow[]
│   │
│   ├─ [FULL BLOCK] (video_format ∈ {"full","short+full"})
│   │   ├─ filter scenes: full_use=Y
│   │   ├─ loadScriptFull(project_id) → ScriptFullReadRow[]
│   │   │   └─ 0件 → error log + skip Full
│   │   ├─ buildStep08aFullPrompt(scenes, scriptRows) → string
│   │   ├─ callGemini(prompt, options) → raw JSON
│   │   ├─ validateTtsAiResponse(raw) → { tts_subtitles[], edit_plan[] }
│   │   │   └─ 失敗 → error log + skip Full（short+full は Short もスキップ）
│   │   ├─ 件数一致確認: tts_subtitles.length === edit_plan.length === scenes.length
│   │   ├─ buildAssetImageMap(imagePromptRows) → Map（任意: STEP_07 完了時のみ）
│   │   ├─ upsertTtsSubtitles(rows, related_version="full")
│   │   │   upsert キー: record_id + related_version
│   │   └─ upsertEditPlan(rows, related_version="full")
│   │       upsert キー: record_id + related_version
│   │
│   ├─ [SHORT BLOCK] (video_format ∈ {"short","short+full"})
│   │   ├─ [short+full かつ Full 失敗] → skip + error log
│   │   ├─ filter scenes: short_use=Y
│   │   ├─ loadScriptShort(project_id) → ScriptShortRow[]
│   │   ├─ buildStep08aShortPrompt(scenes, scriptRows, fullResults?) → string
│   │   │   ※ pause_hint は Short 非対応。Gemini が文脈判断
│   │   ├─ callGemini(prompt, options) → raw JSON
│   │   ├─ validateTtsAiResponse(raw)
│   │   ├─ 件数一致確認
│   │   ├─ upsertTtsSubtitles(rows, related_version="short")
│   │   └─ upsertEditPlan(rows, related_version="short")
│   │
│   ├─ updateProjectCurrentStep("STEP_08A_TTS_SUBTITLE")  ← 1件以上成功時のみ
│   └─ writeAppLog(successLog or failureLog)
```

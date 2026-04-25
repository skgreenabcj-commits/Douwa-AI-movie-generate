# STEP_04_05_COMBINED 実装設計書 v0.3

> **ステータス**: 設計確定（オーナー判断反映済み 2026-04-24）
> **改訂履歴**:
> - v0.1 (2026-04-04): 初版ドラフト（オーナー判断反映版）
> - v0.2 (2026-04-04): クロスレビュー前確認版。Fix #1〜#9 をすべて反映。
> - v0.3 (2026-04-24): `narration_tts` 表記ルール変更。漢字仮名交じり文を採用（TTS ピッチアクセント品質向上のため）。§4.3/4.4 型コメント・§7.1/7.2 生成ルール更新。
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
| **v0.3追加** | `narration_tts` 表記 | **漢字仮名交じり文**（TTS ピッチアクセント品質向上） | プロンプトのルール7を更新。助詞・語尾はひらがな。難読漢字は平易な表記を使用。 |

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

v0.2 から変更なし。詳細は `step04_05_implementation_spec_v0.1.md` §3 を参照。

---

## 4. 型定義設計（`src/types.ts` 追記）

### 4.1〜4.2

v0.2 から変更なし。

### 4.3 `ScriptFullAiRow`（AI 出力 Full）

```typescript
export interface ScriptFullAiRow {
  record_id:        string;   // 02_Scenes.record_id をそのまま返させる（紐付け用）
  narration_draft:  string;   // 読み聞かせ向けの自然な日本語ナレーション文
  narration_tts:    string;   // TTS 向け漢字仮名交じり文。助詞・語尾はひらがな。難読漢字は避ける。
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
  narration_draft:  string;   // 読み聞かせ向けの自然な日本語ナレーション文
  narration_tts:    string;   // TTS 向け漢字仮名交じり文。助詞・語尾はひらがな。難読漢字は避ける。
  subtitle_short_1: string;   // required・空文字不可
  subtitle_short_2: string;   // required・空文字可（Fix #4: "" は valid）
  emphasis_word:    string;   // optional / 空文字可
  transition_note:  string;
}
```

### 4.5〜4.7

v0.2 から変更なし。

---

## 5〜6. モジュール設計・オーケストレーター設計

v0.2 から変更なし。詳細は `step04_05_implementation_spec_v0.1.md` §5〜§6 を参照。

---

## 7. Prompt 設計

### 7.1 STEP_05 Full プロンプト（`prompts/script_full_prompt_v1.md`）

v0.2 から変更なし（プレースホルダー構成・INPUT_DATA 構造は同一）。

**ルール7（v0.3 更新）**:

```
7. `narration_tts` はTTS（音声合成）向けに最適化した漢字仮名交じり文のテキスト
   - 漢字仮名交じり文で記述すること（TTS ピッチアクセント品質のため）
   - 助詞・語尾・接続詞はひらがなのまま（は、が、の、〜ます、〜でした 等）
   - 読みが難しい固有名詞・難読漢字は避けるか、読みが明確な表記を使用
   - 約物（「。」「、」「！」「？」）を適切に残し、読みやすさを確保
```

> **変更前**: `漢字は target_age に合わせて平仮名・易しい漢字に変換`
> **変更後**: `漢字仮名交じり文で記述すること（TTS ピッチアクセント品質のため）`
>
> **理由**: ひらがなのみの入力では Google Cloud TTS のピッチアクセント辞書が
> 同音異義語の解決に失敗しフラットアクセントに fallback する問題が確認されたため。
> 例: `もも`（hiragana）→ アクセント未解決 / `桃`（kanji）→ HLL アクセント適用

### 7.2 STEP_04 Short プロンプト（`prompts/script_short_prompt_v1.md`）

ルール7 は STEP_05 と同一ルールを適用。その他は v0.2 から変更なし。

---

## 8〜16.

v0.2 から変更なし。詳細は `step04_05_implementation_spec_v0.1.md` §8〜§16 を参照。

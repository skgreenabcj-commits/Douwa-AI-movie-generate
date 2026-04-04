# STEP_04_05 実装仕様 v1.1

> **ステータス**: 確定版（実装完了・コードレビュー完了 2026-04-04）
> **改訂履歴**:
> - v0.1 (2026-04-04): ドラフト（オーナー合意反映版）
> - v1.0 (2026-04-04): 確定版。不明点1〜6 / 論点1〜4 のオーナー判断を本文に統合。
>   実装済みコードとの整合を確認済み。
> - v1.1 (2026-04-04): 実装完了後の確定版。全成果物の実装完了を確認。
>   §17 partial success 補足を実際のコード挙動に合わせて修正。
>   §4.4 実行フロー §23 に両方失敗時の current_step 更新なし動作を明記。
>   load-script.ts の scene_no ソート実装上の注記を §26 に追記。
> **対象**: STEP_04 / STEP_05 Combined Spec
> **対象シート**:
> - `03_Script_Short`
> - `04_Script_Full`
> **前提**:
> - `91_Field_Master.field_name` を GSS 実在列の正本とする
> - 実在しない列は仕様前提にしない
> - `scene_no` は通し番号であり、キーには使わない
> - `02_Scenes.record_id` を scene master 側の参照元 row 識別子として扱う
> - `00_Project.video_format` により `short / full / short+full` の実行分岐を行う
> **実装ファイル**:
> - `src/steps/step04-05-script-build.ts` (オーケストレーター)
> - `src/lib/load-scenes.ts`, `src/lib/load-script.ts`
> - `src/lib/write-script-full.ts`, `src/lib/write-script-short.ts`
> - `prompts/script_full_prompt_v1.md`, `prompts/script_short_prompt_v1.md`
> - `schemas/script_full_schema_ai_v1.json`, `schemas/script_short_schema_ai_v1.json`
> - `schemas/script_full_schema_full_v1.json`, `schemas/script_short_schema_full_v1.json`

---

## 1. 目的

本ドキュメントは、GitHub Actions 上で実行する
**STEP_04 / STEP_05（Script Build）** の実装仕様を定義する。

- **STEP_05** は `04_Script_Full` を生成する
- **STEP_04** は `03_Script_Short` を生成する
- ただし両者は密接に関連するため、**1つの combined spec** として管理する

本STEPの目的は、STEP_03 で生成された `02_Scenes` を scene master として参照し、
後工程で再利用可能な script row を scene 単位で生成することである。

後工程とは主に以下を指す。
- `STEP_06` Visual Bible
- `STEP_07` Image Prompts
- `STEP_08` Audio / Subtitle / Edit Plan
- `STEP_09` Q&A Build

---

## 2. STEP_04 / STEP_05 の位置づけ

### 2.1 基本役割
- `02_Scenes` は scene master である
- STEP_04 / STEP_05 は、その scene master を壊さずに script 化する工程である
- scene 構造の
  - 分割
  - 統合
  - 並び替え
  は禁止する

### 2.2 Short版 / Full版 の関係
- **Full版を主系統**とする
- Short版は `02_Scenes` を主入力としつつ、必要に応じて生成済み Full版 script を参照して凝縮版を作る
- ただし `video_format = short` のみで実行される場合は、Full版を参照しない

### 2.3 1 scene = 1 row
- `03_Script_Short` / `04_Script_Full` は **1 scene = 1 row**
- narration / subtitle / line 単位で複数 row に分割しない

---

## 3. スコープ

### 3.1 対象
- 起動: GAS → GitHub Actions `workflow_dispatch`
- 入力:
  - `00_Project`
  - `02_Scenes`
  - 必要に応じて `04_Script_Full`（Short生成時の任意参照）
  - `94_Runtime_Config`
- AI 実行:
  - STEP_05: Full script 生成（Gemini 1 回呼び出し、全 scene 一括生成）
  - STEP_04: Short script 生成（Gemini 1 回呼び出し、全 short_use=Y scene 一括生成）
- 出力:
  - `04_Script_Full`
  - `03_Script_Short`
  - `00_Project` の最小更新
  - `100_App_Logs` へのログ追記

### 3.2 スコープ外（初期実装）
- scene 構造の再定義
- scene の増減・統合・並び替え
- scene 単位の部分再実行
- subtitle を複数行 row として保持する設計
- Full / Short の別 scene master 化
- Full + Short を 1 回の Gemini 呼び出しで同時生成（将来最適化候補 §24 参照）

---

## 4. 実行方式

### 4.1 実行単位
- 基本は **`project_id` 単位**
- 実行対象 version は `00_Project.video_format` により分岐
  - `short`
  - `full`
  - `short+full`

### 4.2 実行順
- `video_format = full` → STEP_05 のみ
- `video_format = short` → STEP_04 のみ
- `video_format = short+full` → **STEP_05 → STEP_04**

### 4.3 Gemini 呼び出し方式（確定: 不明点2）
- **全 scene を 1 回の Gemini 呼び出しで一括生成**（STEP_03 踏襲）
- `maxOutputTokens = 32768`（STEP_03 の 2 倍）
- `step_04_model_role` / `step_05_model_role` を `94_Runtime_Config` から取得
- fallback: primary → 1st fallback（pro系）→ 2nd fallback（flash系）

### 4.4 実行フロー
1. GAS が GitHub Actions を起動
2. GitHub Actions が `00_Project` を読み、対象 `project_id` と `video_format` を取得
3. `video_format` の妥当性チェック（不正値はエラー停止 + ログ）
4. `02_Scenes` を読み込む（0件はエラー停止 + ログ）
5. `video_format` に応じて Full / Short / 両方を分岐
6. Full生成時（STEP_05）:
   - `full_use=Y` の scene のみを AI 入力として渡す
   - `02_Scenes` を入力に Full script を一括生成
   - `04_Script_Full` に upsert
7. Short生成時（STEP_04）:
   - `short_use=Y` の scene のみを AI 入力として渡す（`short_use=N` は行を生成しない）
   - `video_format=short+full` かつ `04_Script_Full` が存在する場合は参照して凝縮可（任意）
   - `video_format=short` のみの場合は `04_Script_Full` を参照しない
   - `03_Script_Short` に upsert
8. `00_Project` を最小更新（`current_step` は §17 の状態表に従う）
   - STEP_05 成功時点で `STEP_05_FULL_SCRIPT_BUILD` に更新
   - STEP_04 成功時点で `video_format=short+full` かつ Full 成功済みなら `STEP_04_05_COMBINED`、そうでなければ `STEP_04_SHORT_SCRIPT_BUILD` に更新
   - 両方失敗時は `current_step` を更新しない
9. `100_App_Logs` に成功 / 失敗 / partial success を記録

### 4.5 `video_format = short` のみ指定時のプロセス分岐
- STEP_05 Full Script Build は実行しない
- STEP_04 Short Script Build は `02_Scenes` を主入力として単独実行する
- `04_Script_Full` は参照しない（`hasFullScript = false` 固定）
- `100_App_Logs` には short only execution であることが分かるログを残す

---

## 5. 入力

### 5.1 主入力シート
- `00_Project`
- `02_Scenes`（`generation_status = "GENERATED"` の行のみ使用）

### 5.2 条件付き参照入力（確定: 不明点1）
- `04_Script_Full`
  - STEP_04 実行時、`video_format = short+full` かつ Full Script が存在する場合のみ参照
  - `video_format = short` 単独時は参照しない
  - 存在チェックは `generation_status = "GENERATED"` の行数で判定（0件 = 参照なし）
  - `hasFullScript: boolean` フラグでオーケストレーター内制御

### 5.3 `00_Project` から使う主な入力列
| field_name | 用途 |
|---|---|
| `project_id` | 案件識別 |
| `title_jp` | タイトル |
| `target_age` | 文体・語彙・理解負荷の調整 |
| `short_target_sec` | Short版の目標尺 |
| `full_target_sec` | Full版の目標尺 |
| `video_format` | `short / full / short+full` の分岐 |
| `visual_style` | 演出方針補足 |
| `notes` | 補足情報 |

### 5.4 `02_Scenes` から使う主な入力列
| field_name | 用途 |
|---|---|
| `project_id` | 案件識別 |
| `record_id` | scene row 識別（参照元 row ID）。upsert キーとして引き継ぐ |
| `scene_no` | 表示用通し番号（キーには使わない） |
| `chapter` | 章立て |
| `scene_title` | scene 見出し |
| `scene_summary` | scene 内容要約 |
| `scene_goal` | scene の物語機能 |
| `visual_focus` | 映像上の注目点 |
| `emotion` | scene 感情トーン。コード側でそのまま引き継ぐ（論点1） |
| `short_use` | Short採用フラグ。`short_use=N` は Short生成から除外（不明点6） |
| `full_use` | Full採用フラグ |
| `est_duration_short` | Short版 rough estimate（参考値） |
| `est_duration_full` | Full版 rough estimate（参考値） |
| `difficult_words` | 難語（AI入力として渡す: 論点3） |
| `easy_rewrite` | 言い換え候補（AI入力として渡す: 論点3） |
| `qa_seed` | QA種 |
| `continuity_note` | 接続・連続性メモ |

### 5.5 Full参照時に使う主な列（STEP_04のみ、`hasFullScript=true` 時）
| field_name | 用途 |
|---|---|
| `record_id` | 対応 scene の識別 |
| `narration_draft` | 凝縮元の読み物テキスト |
| `narration_tts` | 凝縮元の読み上げテキスト |
| `pause_hint` | 間・余白の参考 |
| `emotion` | 参考（コード側はすでに 02_Scenes.emotion を使用） |

---

## 6. 実行前チェック

### 6.1 `02_Scenes` 存在チェック
- `project_id` に対応する `02_Scenes` row（`generation_status=GENERATED`）がない場合はエラー停止

### 6.2 `video_format` の妥当性
- 許容値: `short` / `full` / `short+full`
- それ以外はエラー停止 + ログ（運用補正は行わない）

### 6.3 scene master 前提
- `02_Scenes` は scene master として確定済みであること
- scene 構造の変更は禁止

---

## 7. キー設計・識別ルール

### 7.1 GSS 実在列の正本
- `91_Field_Master.field_name`

### 7.2 `scene_no` の扱い（確定）
- `scene_no` は **表示用通し番号**
- キーには使わない
- `scene_no` の数値順（昇順）で `02_Scenes` を読み込む

### 7.3 `record_id` の扱い（確定: 不明点4）
- STEP_03 の `02_Scenes.record_id` を、STEP_04 / STEP_05 の対応 row に **そのまま流用**する
- 新規採番は行わない
- `record_id` により scene master のどの row に対応する script row かを明確にする
- **シート名固定 + `record_id` 単体キー**で一意性を担保する

### 7.4 upsert キー
- 各シート内の upsert キーは **`record_id`**
- `scene_id` は使わない（GSS 実在列ではないため）
- upsert 方針: `record_id` 一致行があれば UPDATE、なければ末尾次空行に INSERT

### 7.5 `related_version`
- `03_Script_Short.related_version = "short"`
- `04_Script_Full.related_version = "full"`

### 7.6 AI 出力の `record_id` 突合ルール
- AI 出力の各要素の `record_id` と `02_Scenes.record_id` を突合する
- 件数不一致・record_id 不一致を検出し警告ログを出す
- 突合失敗時は配列インデックス順のフォールバック紐付けを行う

---

## 8. 出力シート仕様

### 8.1 `03_Script_Short` 列定義整理表

| field_name | 必須 | role | 説明 | 備考 |
|---|---|---|---|---|
| `project_id` | Y | SYSTEM_CONTROL | 案件ID | `00_Project.project_id` |
| `record_id` | Y | SYSTEM_CONTROL | scene master 対応 row ID | `02_Scenes.record_id` を流用 |
| `generation_status` | Y | SYSTEM_CONTROL | 生成状態 | 初期値 `GENERATED` |
| `approval_status` | Y | HUMAN_REVIEW | 承認状態 | 初期値 `PENDING` |
| `step_id` | Y | SYSTEM_CONTROL | ステップID | 固定 `STEP_04_SHORT_SCRIPT_BUILD` |
| `scene_no` | N | REFERENCE | 通し番号 | 表示用。キーに使わない |
| `related_version` | N | SYSTEM_CONTROL | version 識別 | 固定 `short` |
| `duration_sec` | N | SYSTEM補完 | script 実体ベース秒数 | コード側計算: `Math.ceil(narration_tts.length / 5.5)` |
| `narration_draft` | Y | AI_OUTPUT | 読み物として自然な文章 | 必須。AI が生成 |
| `narration_tts` | Y | AI_OUTPUT | 読み上げ最適化版 | 必須。AI が生成 |
| `subtitle_short_1` | Y | AI_OUTPUT | 字幕表示ブロック1 | 必須 |
| `subtitle_short_2` | Y | AI_OUTPUT | 字幕表示ブロック2 | 空文字可（空文字 `""` で返す） |
| `emphasis_word` | N | AI_OUTPUT | 強調語 | 任意。空文字可 |
| `transition_note` | Y | AI_OUTPUT | scene切替・接続メモ | 必須 |
| `emotion` | Y | SYSTEM補完 | script 向け感情トーン | **コード側が `02_Scenes.emotion` をそのままコピー**（論点1）。AI は出力しない |
| `hook_flag` | N | AI_OUTPUT | hook 判定 | 任意 |
| `tts_ready` | N | AI_OUTPUT | TTS 利用準備フラグ | 任意 |
| `updated_at` | Y | SYSTEM_CONTROL | 更新日時 | GitHub 補完 |
| `updated_by` | Y | SYSTEM_CONTROL | 更新者 | `github_actions` |
| `notes` | N | HUMAN_REVIEW | 補足メモ | 任意 |

### 8.2 `04_Script_Full` 列定義整理表

| field_name | 必須 | role | 説明 | 備考 |
|---|---|---|---|---|
| `project_id` | Y | SYSTEM_CONTROL | 案件ID | `00_Project.project_id` |
| `record_id` | Y | SYSTEM_CONTROL | scene master 対応 row ID | `02_Scenes.record_id` を流用 |
| `generation_status` | Y | SYSTEM_CONTROL | 生成状態 | 初期値 `GENERATED` |
| `approval_status` | Y | HUMAN_REVIEW | 承認状態 | 初期値 `PENDING` |
| `step_id` | Y | SYSTEM_CONTROL | ステップID | 固定 `STEP_05_FULL_SCRIPT_BUILD` |
| `scene_no` | N | REFERENCE | 通し番号 | 表示用。キーに使わない |
| `related_version` | N | SYSTEM_CONTROL | version 識別 | 固定 `full` |
| `duration_sec` | N | SYSTEM補完 | script 実体ベース秒数 | コード側計算: `Math.ceil(narration_tts.length / 5.5)` |
| `narration_draft` | Y | AI_OUTPUT | 読み物として自然な文章 | 必須。AI が生成 |
| `narration_tts` | Y | AI_OUTPUT | 読み上げ最適化版 | 必須。AI が生成 |
| `subtitle_short_1` | Y | AI_OUTPUT | scene の主要短文字幕ブロック1 | 命名整理候補だが現状使用（論点4） |
| `subtitle_short_2` | Y | AI_OUTPUT | scene の主要短文字幕ブロック2 | 命名整理候補だが現状使用（論点4） |
| `visual_emphasis` | N | AI_OUTPUT | 映像上の強調点 | 任意。空文字可 |
| `pause_hint` | Y | AI_OUTPUT | 間・余白・感情の溜め | 必須 |
| `emotion` | Y | SYSTEM補完 | script 向け感情トーン | **コード側が `02_Scenes.emotion` をそのままコピー**（論点1）。AI は出力しない |
| `hook_flag` | N | AI_OUTPUT | hook 判定 | 任意 |
| `tts_ready` | N | AI_OUTPUT | TTS 利用準備フラグ | 任意 |
| `updated_at` | Y | SYSTEM_CONTROL | 更新日時 | GitHub 補完 |
| `updated_by` | Y | SYSTEM_CONTROL | 更新者 | `github_actions` |
| `notes` | N | HUMAN_REVIEW | 補足メモ | 任意 |

---

## 9. AI 出力フィールド方針

### 9.1 AI が **出力するフィールド**（AI_OUTPUT）

**Short（STEP_04）**:
- `record_id`（02_Scenes の値をそのまま返す、紐付けキー）
- `narration_draft`（必須）
- `narration_tts`（必須）
- `subtitle_short_1`（必須）
- `subtitle_short_2`（必須、空文字可）
- `emphasis_word`（任意、空文字可）
- `transition_note`（必須）

**Full（STEP_05）**:
- `record_id`（02_Scenes の値をそのまま返す、紐付けキー）
- `narration_draft`（必須）
- `narration_tts`（必須）
- `subtitle_short_1`（必須）
- `subtitle_short_2`（必須、空文字可）
- `visual_emphasis`（任意、空文字可）
- `pause_hint`（必須）

### 9.2 AI が **出力しないフィールド**（コード側付与）

| フィールド | 付与方法 | 根拠 |
|---|---|---|
| `emotion` | `02_Scenes.emotion` をコード側でそのままコピー | 論点1: 重複生成を排除、scene master との一貫性を担保 |
| `duration_sec` | `Math.ceil(narration_tts.length / 5.5)` | 不明点3: コード計算の方が安定（5.5文字/秒）|

---

## 10. 尺設計ルール

### 10.1 基本方針
- `target_sec` は重要な目標値
- ただし **厳密一致より物語品質を優先**
- 最大 **+15% まで許容**

### 10.2 `duration_sec` の計算方法（確定: 不明点3）
- **コード側で計算**: `Math.ceil(narration_tts.length / 5.5)`
- 読み速度: 5.5 文字/秒（日本語音読の一般的な平均）
- AI 出力には含めない
- `02_Scenes.est_duration_short / est_duration_full` は rough estimate であり、`duration_sec` は script 実体に基づく再計算値

### 10.3 Full版
- Full版の narrative richness を優先
- scene の情報量・感情の流れ・読みやすさを保つ

### 10.4 Short版
- 物語の理解・感情曲線・満足感を損なわないように圧縮
- `short_use=N` の scene は入力に含めず、出力行も生成しない（不明点6）
- `short_use=Y` の scene のみを AI 入力とする

---

## 11. `short_use` / `full_use` の扱い（確定: 不明点6）

### 11.1 基本
- `02_Scenes.short_use = "Y"` の scene のみを Short Script Build の AI 入力とする
- `02_Scenes.full_use = "Y"` の scene のみを Full Script Build の AI 入力とする
- `short_use = "N"` の scene は `03_Script_Short` に行を生成しない

### 11.2 禁止事項
- scene master 構造そのものを壊す変更
- 分割・統合・並び替え

---

## 12. `narration_draft` / `narration_tts` 設計方針

### 12.1 `narration_draft`
- 読み物として自然な文章
- script の基準文

### 12.2 `narration_tts`
- 読み上げ最適化版
- 句読点、語のほどき方、音読テンポに配慮
- `narration_draft` と意味同一を原則とする
- TTS 文字数が `duration_sec` の計算基準になる

---

## 13. `subtitle_short_1` / `subtitle_short_2` 設計方針

- scene 内の**自然な表示ブロック**
- 機械的等分ではなく、意味・感情・読みやすさを優先する
- 1行あたり 12〜18文字程度を目安

### Full版での扱い（確定: 論点4）
- 列名は `subtitle_short_*` だが、Field_Master 実在列を尊重してそのまま使用
- 意味としては「scene の主要短文字幕ブロック」として扱う
- 将来の命名整理候補として記録

---

## 14. `emotion` 設計方針（確定: 論点1）

- STEP_04 / STEP_05 の `emotion` は、**コード側が `02_Scenes.emotion` をそのままコピーする**
- AI の出力スキーマには `emotion` を含めない
- AI による再生成・微修正は行わない（重複生成の排除、scene master との一貫性担保）

---

## 15. `transition_note` / `pause_hint` 設計方針

### 上位概念
- 接続 / 間 の演出補助

### Short
- `transition_note`
- scene切替の勢い・接続・テンポを支える

### Full
- `pause_hint`
- 間・余白・感情の溜め・読みのリズムを支える

---

## 16. `difficult_words` / `easy_rewrite` の扱い（確定: 論点3）

- `02_Scenes.difficult_words` と `02_Scenes.easy_rewrite` は、AI 入力 INPUT_DATA の scenes 配列に含める
- 重複処理ではあるが、AI が入力として受け取ることで narration 生成時の語彙選択を明示的にコントロールできるため許容範囲とする

---

## 17. `current_step` 設定値（確定: 不明点5）

| 実行状態 | `current_step` 値 |
|---|---|
| Full のみ成功（`video_format=full`） | `STEP_05_FULL_SCRIPT_BUILD` |
| Short のみ成功（`video_format=short`） | `STEP_04_SHORT_SCRIPT_BUILD` |
| 両方成功（`video_format=short+full`） | `STEP_04_05_COMBINED` |
| partial success（片方失敗） | 成功した方のステップ値 ※下記補足 |
| 両方失敗 | 更新しない |

> **partial success 補足**:
> - Full成功 / Short失敗: `current_step = STEP_05_FULL_SCRIPT_BUILD`（STEP_05 成功時点で設定済み）
> - Full失敗 / Short成功: `current_step = STEP_04_SHORT_SCRIPT_BUILD`（STEP_04 成功時点で設定済み）
> - いずれも `100_App_Logs` に `[WARN][partial_success] Full=success/fail, Short=success/fail` を記録する。
> - ⚠️ `STEP_04_05_PARTIAL` という値は使用しない（§17 旧草案から変更）。

---

## 18. エラーハンドリング

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

### partial success
- 許容する
- 成功した方は書き込む
- `100_App_Logs` と `00_Project` に partial success が分かる記録を残す

---

## 19. `00_Project` 更新方針

最小更新対象:
- `current_step`（§17 の状態表に従う）
- `approval_status`（`PENDING`）
- `updated_at`
- `updated_by`（`github_actions`）

---

## 20. `100_App_Logs` 方針

最低限記録する:
- `project_id`
- `record_id`
- `current_step`
- `timestamp`
- `app_log`（`[LEVEL][event_type] message` 形式）

### ログに残すべきイベント

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

## 21. Prompt 設計方針

### 21.1 プロンプトファイル
- `prompts/script_full_prompt_v1.md`（STEP_05）
- `prompts/script_short_prompt_v1.md`（STEP_04）

### 21.2 プレースホルダー構成

**STEP_05 Full**:

| プレースホルダー | 内容 |
|---|---|
| `{{INPUT_DATA}}` | project 情報 + 02_Scenes 行配列（full_use=Y のみ） |
| `{{OUTPUT_JSON_SCHEMA}}` | `script_full_schema_ai_v1.json` |
| `{{OUTPUT_FIELD_GUIDE}}` | `script_output_field_guide_full_v1.md` |
| `{{OUTPUT_EXAMPLE}}` | `script_full_ai_response_example_v1.json` |

**STEP_04 Short**:

| プレースホルダー | 内容 |
|---|---|
| `{{INPUT_DATA}}` | project 情報 + 02_Scenes 行配列（short_use=Y のみ）+ Full 参照（任意） |
| `{{HAS_FULL_SCRIPT}}` | `"true"` または `"false"` |
| `{{OUTPUT_JSON_SCHEMA}}` | `script_short_schema_ai_v1.json` |
| `{{OUTPUT_FIELD_GUIDE}}` | `script_output_field_guide_short_v1.md` |
| `{{OUTPUT_EXAMPLE}}` | `script_short_ai_response_example_v1.json` |

### 21.3 INPUT_DATA 構造

Full版 scenes 配列の各要素:
```json
{
  "record_id": "PJT-001-SCN-001",
  "scene_no": "1",
  "chapter": "導入",
  "scene_title": "...",
  "scene_summary": "...",
  "scene_goal": "...",
  "visual_focus": "...",
  "emotion": "ふしぎ、わくわく",
  "est_duration_full": 35,
  "difficult_words": "どんぶらこ",
  "easy_rewrite": "ぷかぷか流れてくる",
  "continuity_note": "..."
}
```

Short版 scenes 配列（`hasFullScript=true` 時は `full_script_ref` を追加）:
```json
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
```

---

## 22. Schema 設計方針

- `script_full_schema_ai_v1.json`（STEP_05 AI 出力）
- `script_short_schema_ai_v1.json`（STEP_04 AI 出力）
- `script_full_schema_full_v1.json`（04_Script_Full GSS 書き込み行）
- `script_short_schema_full_v1.json`（03_Script_Short GSS 書き込み行）

### AI 出力スキーマの共通前提
- `{ "scripts": [...] }` 形式（`scenes` ではなく `scripts` キー）
- `additionalProperties: false`
- `emotion` / `duration_sec` は AI 出力に含めない
- `record_id` は required（紐付けキー）

---

## 23. 実装上の注意
- `91_Field_Master.field_name` を正本として扱う
- 実在しない列を仕様前提にしない
- `scene_no` はキーに使わない
- upsert は各シート内で `record_id` 単体キー
- `record_id` は STEP_03 由来 row をそのまま引き継ぐ
- partial success を許容する
- Full参照は optional であり、Short単独生成を妨げない
- `maxOutputTokens = 32768`（全 scene 一括生成のため STEP_03 の 2 倍）
- GitHub Actions の環境変数 `STEP_ID = "STEP_04_05"` で起動

---

## 24. 将来最適化メモ（論点2 記録）

> **FUTURE_OPTIMIZATION_C**: `video_format = short+full` 時に Full / Short を
> 1 回の Gemini 呼び出しで同時生成する。
> プロンプトで `{ "scripts_full": [...], "scripts_short": [...] }` の 2 配列を
> 1 回の応答で返させる方式。
>
> **採用条件**: Full と Short の narration 品質差が実運用上問題にならないと確認できた場合。
>
> **未解決課題**: 1 プロンプトの複雑化、出力トークン数のさらなる増大、
> Full/Short の個別 schema バリデーションの難化。
>
> **初期実装**: 2 回呼び出し（A案）を採用。

---

## 25. 成果物一覧（実装済み）

本仕様をもとに作成・実装済みの成果物。全件 `npm run build` ビルド確認済み・dry-run 動作確認済み。

### 新規作成ファイル

| ファイル | 種別 | ステータス |
|---|---|---|
| `src/steps/step04-05-script-build.ts` | オーケストレーター | ✅ 実装済み |
| `src/lib/load-scenes.ts` | 02_Scenes 読み込み | ✅ 実装済み |
| `src/lib/load-script.ts` | 04_Script_Full 読み込み | ✅ 実装済み |
| `src/lib/write-script-full.ts` | 04_Script_Full upsert | ✅ 実装済み |
| `src/lib/write-script-short.ts` | 03_Script_Short upsert | ✅ 実装済み |
| `src/scripts/dry-run-step04-05.ts` | dry-run テスト | ✅ 実装済み |
| `prompts/script_full_prompt_v1.md` | STEP_05 プロンプト | ✅ 実装済み |
| `prompts/script_short_prompt_v1.md` | STEP_04 プロンプト | ✅ 実装済み |
| `prompts/fragments/script_output_field_guide_full_v1.md` | Full フィールドガイド | ✅ 実装済み |
| `prompts/fragments/script_output_field_guide_short_v1.md` | Short フィールドガイド | ✅ 実装済み |
| `schemas/script_full_schema_ai_v1.json` | Full AI 出力スキーマ | ✅ 実装済み |
| `schemas/script_short_schema_ai_v1.json` | Short AI 出力スキーマ | ✅ 実装済み |
| `schemas/script_full_schema_full_v1.json` | Full GSS 書き込み行スキーマ | ✅ 実装済み |
| `schemas/script_short_schema_full_v1.json` | Short GSS 書き込み行スキーマ | ✅ 実装済み |
| `examples/script_full_ai_response_example_v1.json` | Full AI 出力サンプル | ✅ 実装済み |
| `examples/script_short_ai_response_example_v1.json` | Short AI 出力サンプル | ✅ 実装済み |

### 既存ファイル更新

| ファイル | 追記内容 | ステータス |
|---|---|---|
| `src/types.ts` | ScriptFullAiRow, ScriptShortAiRow, ScriptFullRow, ScriptShortRow, ScriptFullReadRow | ✅ 完了 |
| `src/lib/validate-json.ts` | validateScriptFullAiResponse, validateScriptShortAiResponse（空文字チェック含む） | ✅ 完了 |
| `src/lib/load-assets.ts` | Step04Assets, Step05Assets, loadStep04Assets, loadStep05Assets | ✅ 完了 |
| `src/lib/call-gemini.ts` | buildGeminiOptionsStep04, buildGeminiOptionsStep05 | ✅ 完了 |
| `src/lib/build-prompt.ts` | buildStep04Prompt, buildStep05Prompt | ✅ 完了 |
| `src/lib/write-app-log.ts` | buildStep04/05 SuccessLog, FailureLog | ✅ 完了 |
| `src/index.ts` | STEP_04_05 ルーティングケース | ✅ 完了 |
| `package.json` | build エントリ追加、dry-run:step04-05 スクリプト追加 | ✅ 完了 |

---

## 26. 実装上の補足メモ（v1.1 追記）

### 26.1 load-script.ts の scene_no ソート

`load-script.ts` の `loadFullScriptByProjectId` は、`ScriptFullReadRow` 型に `scene_no` フィールドが
定義されていないため、ソート時に型キャストによるアクセスを行っている。

```typescript
// 実装上の対処: scene_no が ScriptFullReadRow の型定義外のため unknown 経由でアクセス
const sceneNoA = parseInt((a as unknown as Record<string, string>)["scene_no"] ?? "0", 10);
```

**改善候補**: `ScriptFullReadRow` に `scene_no?: string` をオプションとして追加することで型安全にできる。
初期実装では動作上問題ないため現状のままとし、将来のリファクタリング対象とする。

### 26.2 partial success 時の current_step 遷移

実際のオーケストレーターコードでは `STEP_04_05_PARTIAL` という current_step 値は使用していない。
成功した方のステップ値がそのまま `current_step` になる。仕様の §17 の状態表と整合している。

### 26.3 dry-run 動作確認済み内容

- `video_format = short+full` の 3-scene プロジェクトで Full / Short の scene カウント・record_id・est_duration が
  正しく表示されることを確認。
- Gemini 呼び出しスキップ・プロンプトプレビュー出力が正常に動作することを確認。
- TypeScript ビルド（`npm run build`）がエラーなく完了することを確認（dist/ に全ファイル生成済み）。

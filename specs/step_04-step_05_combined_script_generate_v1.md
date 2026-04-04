# STEP_04_05 実装仕様 v0.1

> **ステータス**: ドラフト（オーナー合意反映版）
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
  - 必要に応じて `04_Script_Full`（Short生成時の参照）
  - `94_Runtime_Config`
- AI 実行:
  - STEP_05: Full script 生成
  - STEP_04: Short script 生成
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

### 4.3 実行フロー
1. GAS が GitHub Actions を起動
2. GitHub Actions が `00_Project` を読み、対象 `project_id` と `video_format` を取得
3. `02_Scenes` を読み込む
4. `video_format` に応じて Full / Short / 両方を分岐
5. Full生成時:
   - `02_Scenes` を入力に Full script を生成
   - `04_Script_Full` に upsert
6. Short生成時:
   - `02_Scenes` を主入力に Short script を生成
   - 生成済み `04_Script_Full` が存在する場合は参照して凝縮可
   - `03_Script_Short` に upsert
7. `00_Project` を最小更新
8. `100_App_Logs` に成功 / 失敗 / partial success を記録

### 4.4 `video_format = short` のみ指定時のプロセス分岐
- `00_Project.video_format = short` の場合は、**STEP_05 Full Script Build は実行しない**
- この場合、STEP_04 Short Script Build は `02_Scenes` を主入力として**単独で実行**する
- `04_Script_Full` は参照しない
- scene 採用判断は `02_Scenes.short_use` を原則参照しつつ、物語のわかりやすさ・楽しさを高める範囲で限定的な微修正を許容する
- 出力先は `03_Script_Short` のみとし、`04_Script_Full` には書き込みを行わない
- `100_App_Logs` には、**short only execution** であることが分かるログを残す

---

## 5. 入力

### 5.1 主入力シート
- `00_Project`
- `02_Scenes`

### 5.2 条件付き参照入力
- `04_Script_Full`
  - STEP_04 実行時に、すでに Full版が存在する場合のみ参照可
  - `video_format = short` 単独時は参照しない

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
| `record_id` | scene row 識別（参照元 row ID） |
| `chapter` | 章立て |
| `scene_title` | scene 見出し |
| `scene_summary` | scene 内容要約 |
| `scene_goal` | scene の物語機能 |
| `visual_focus` | 映像上の注目点 |
| `emotion` | scene 感情トーン |
| `short_use` | Short採用原則 |
| `full_use` | Full採用原則 |
| `est_duration_short` | Short版 rough estimate |
| `est_duration_full` | Full版 rough estimate |
| `difficult_words` | 難語 |
| `easy_rewrite` | 言い換え候補 |
| `qa_seed` | QA種 |
| `continuity_note` | 接続・連続性メモ |

### 5.5 Full参照時に使う主な列（STEP_04のみ）
| field_name | 用途 |
|---|---|
| `record_id` | 対応 scene の識別 |
| `narration_draft` | 凝縮元の読み物テキスト |
| `narration_tts` | 凝縮元の読み上げテキスト |
| `subtitle_short_1` | 表示ブロック参考 |
| `subtitle_short_2` | 表示ブロック参考 |
| `emotion` | script 感情補足 |
| `pause_hint` | 間・余白の参考 |

---

## 6. 実行前チェック

### 6.1 `02_Scenes` 存在チェック
- `project_id` に対応する `02_Scenes` row がない場合はエラー停止

### 6.2 `video_format` の妥当性
- 許容値:
  - `short`
  - `full`
  - `short+full`
- それ以外はエラー停止または運用定義に従い補正

### 6.3 scene master 前提
- `02_Scenes` は scene master として確定済みであること
- scene 構造の変更は禁止

---

## 7. キー設計・識別ルール

### 7.1 GSS 実在列の正本
- `91_Field_Master.field_name`

### 7.2 `scene_no` の扱い
- `scene_no` は **通し番号**
- キーには使わない

### 7.3 `record_id` の扱い
- STEP_03 の `02_Scenes.record_id` を、STEP_04 / STEP_05 の対応 row に **そのまま流用**する
- これにより、scene master のどの row に対応する script row かを明確にする

### 7.4 upsert キー
- 各シート内の upsert キーは **`record_id`**
- `scene_id` は使わない（GSS 実在列ではないため）

### 7.5 `related_version`
初期実装では以下を採用する。
- `03_Script_Short.related_version = short`
- `04_Script_Full.related_version = full`

※ `related_version` は系統識別列として保持するが、各シートが分かれているため upsert の主キーには使わない

---

## 8. 出力シート仕様

---

## 8.1 `03_Script_Short` 列定義整理表

| field_name | 必須 | role | 説明 | 備考 |
|---|---|---|---|---|
| `project_id` | Y | SYSTEM_CONTROL | 案件ID | `00_Project.project_id` |
| `record_id` | Y | SYSTEM_CONTROL | scene master 対応 row ID | `02_Scenes.record_id` を流用 |
| `generation_status` | Y | SYSTEM_CONTROL | 生成状態 | 初期値 `GENERATED` |
| `approval_status` | Y | HUMAN_REVIEW | 承認状態 | 初期値 `PENDING` |
| `step_id` | Y | SYSTEM_CONTROL | ステップID | 固定 `STEP_04_SHORT_SCRIPT_BUILD` などで定義 |
| `scene_no` | N | REFERENCE | 通し番号 | 表示用・参照用。キーに使わない |
| `related_version` | N | SYSTEM_CONTROL | version 識別 | 固定 `short` |
| `duration_sec` | N | AI_OUTPUT | scene の script 実体ベース秒数 | STEP_03 の estimate ではなく再計算値 |
| `narration_draft` | Y | AI_OUTPUT | 読み物として自然な文章 | 必須 |
| `narration_tts` | Y | AI_OUTPUT | 読み上げ最適化版 | 必須 |
| `subtitle_short_1` | Y | AI_OUTPUT | 字幕表示ブロック1 | 必須 |
| `subtitle_short_2` | Y | AI_OUTPUT | 字幕表示ブロック2 | 必須 |
| `emphasis_word` | N | AI_OUTPUT | 強調語 | 任意 |
| `emotion` | Y | AI_OUTPUT | script 向け感情トーン | STEP_03 参照 + 微修正可 |
| `transition_note` | Y | AI_OUTPUT | scene切替・接続メモ | 必須 |
| `hook_flag` | N | AI_OUTPUT | hook 判定 | 任意 |
| `tts_ready` | N | AI_OUTPUT | TTS 利用準備フラグ | 任意 |
| `updated_at` | Y | SYSTEM_CONTROL | 更新日時 | GitHub 補完 |
| `updated_by` | Y | SYSTEM_CONTROL | 更新者 | `github_actions` |
| `notes` | N | HUMAN_REVIEW | 補足メモ | 任意 |

---

## 8.2 `04_Script_Full` 列定義整理表

| field_name | 必須 | role | 説明 | 備考 |
|---|---|---|---|---|
| `project_id` | Y | SYSTEM_CONTROL | 案件ID | `00_Project.project_id` |
| `record_id` | Y | SYSTEM_CONTROL | scene master 対応 row ID | `02_Scenes.record_id` を流用 |
| `generation_status` | Y | SYSTEM_CONTROL | 生成状態 | 初期値 `GENERATED` |
| `approval_status` | Y | HUMAN_REVIEW | 承認状態 | 初期値 `PENDING` |
| `step_id` | Y | SYSTEM_CONTROL | ステップID | 固定 `STEP_05_FULL_SCRIPT_BUILD` などで定義 |
| `scene_no` | N | REFERENCE | 通し番号 | 表示用・参照用。キーに使わない |
| `related_version` | N | SYSTEM_CONTROL | version 識別 | 固定 `full` |
| `duration_sec` | N | AI_OUTPUT | scene の script 実体ベース秒数 | STEP_03 estimate ではなく再計算値 |
| `narration_draft` | Y | AI_OUTPUT | 読み物として自然な文章 | 必須 |
| `narration_tts` | Y | AI_OUTPUT | 読み上げ最適化版 | 必須 |
| `subtitle_short_1` | Y | AI_OUTPUT | scene の主要短文字幕ブロック1 | 命名整理候補だが現状使用 |
| `subtitle_short_2` | Y | AI_OUTPUT | scene の主要短文字幕ブロック2 | 命名整理候補だが現状使用 |
| `visual_emphasis` | N | AI_OUTPUT | 映像上の強調点 | 任意 |
| `pause_hint` | Y | AI_OUTPUT | 間・余白・感情の溜め | 必須 |
| `emotion` | Y | AI_OUTPUT | script 向け感情トーン | STEP_03 参照 + 微修正可 |
| `tts_ready` | N | AI_OUTPUT | TTS 利用準備フラグ | 任意 |
| `updated_at` | Y | SYSTEM_CONTROL | 更新日時 | GitHub 補完 |
| `updated_by` | Y | SYSTEM_CONTROL | 更新者 | `github_actions` |
| `notes` | N | HUMAN_REVIEW | 補足メモ | 任意 |

---

## 9. 必須フィールド方針

### 9.1 Short 必須
- `narration_draft`
- `narration_tts`
- `subtitle_short_1`
- `subtitle_short_2`
- `emotion`
- `transition_note`

### 9.2 Full 必須
- `narration_draft`
- `narration_tts`
- `subtitle_short_1`
- `subtitle_short_2`
- `emotion`
- `pause_hint`

---

## 10. 尺設計ルール

### 10.1 基本方針
- `target_sec` は重要な目標値
- ただし **厳密一致より物語品質を優先**
- 最大 **+15% まで許容**

### 10.2 STEP_03 との関係
- `02_Scenes.est_duration_short / est_duration_full` は rough estimate
- STEP_04 / STEP_05 の `duration_sec` は、script 実体に基づく再計算値

### 10.3 Full版
- Full版の narrative richness を優先
- scene の情報量・感情の流れ・読みやすさを保つ

### 10.4 Short版
- 物語の理解・感情曲線・満足感を損なわないように圧縮
- `short_use` を原則参照
- 必要に応じて script 段階で限定調整可

---

## 11. `short_use` / `full_use` の扱い

### 11.1 基本
- `02_Scenes.short_use` / `full_use` を原則参照

### 11.2 許容される調整
- script 化に伴う限定的な微修正は可
- 目的:
  - 物語のわかりやすさ
  - 子どもにとっての楽しさ
  - narrative flow の改善

### 11.3 禁止事項
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

---

## 13. `subtitle_short_1` / `subtitle_short_2` 設計方針

- scene 内の**自然な表示ブロック**
- 機械的等分ではなく、
  - 意味
  - 感情
  - 読みやすさ
を優先する

### Full版での扱い
- 列名は `subtitle_short_*` だが、現時点では Field_Master 実在列を尊重してそのまま使う
- 意味としては「scene の主要短文字幕ブロック」として扱う
- 将来、命名整理候補とする

---

## 14. `emotion` 設計方針
- STEP_03 の `emotion` を参照
- STEP_04 / STEP_05 では narration / tts / subtitle に適した表現へ微修正可
- ただし scene master と矛盾しないこと

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

## 16. エラーハンドリング

| エラー種別 | 対処 |
|---|---|
| `02_Scenes` が存在しない | エラー停止 + ログ |
| `video_format` 不正 | エラー停止 + ログ |
| Full生成失敗 / Short成功 | Shortのみ書き込み、partial success をログ |
| Short生成失敗 / Full成功 | Fullのみ書き込み、partial success をログ |
| 両方失敗 | `approval_status=UNKNOWN` 相当でログ |
| schema validation 失敗 | 当該 version を失敗扱いにする |
| GSS 書き込み失敗 | ログ出力 |

### partial success
- 許容する
- 成功した方は書き込む
- `100_App_Logs` と `00_Project` に partial success が分かる記録を残す

---

## 17. `00_Project` 更新方針

最低限更新する候補:
- `current_step`
- `approval_status`
- `updated_at`
- `updated_by`

### 方針
- Full成功時 / Short成功時 / partial success 時でログは分ける
- `approval_status` は運用ルールに応じて `PENDING` / `UNKNOWN` を使用

---

## 18. `100_App_Logs` 方針
最低限記録する:
- `project_id`
- `record_id`
- `current_step`
- `timestamp`
- `app_log`

### ログに残すべき内容
- STEP_05 実行開始
- STEP_05 成功 / 失敗
- STEP_04 実行開始
- STEP_04 成功 / 失敗
- Full参照あり / なし
- short only execution
- partial success 発生
- validation failure
- write failure

---

## 19. Prompt / Schema 設計前提メモ

### 19.1 Prompt 設計前提
STEP_04 / STEP_05 の prompt では、少なくとも以下を明記する。

#### STEP_05 Full
- `02_Scenes` は scene master であり変更不可
- 1 scene = 1 row
- `record_id` ごとに対応する Full script を生成する
- `narration_draft` / `narration_tts` / `subtitle_short_1/2` / `emotion` / `pause_hint` を生成する
- `full_target_sec` を意識しつつ、物語品質優先、+15% 許容
- `emotion` は scene master を参照しつつ具体化可

#### STEP_04 Short
- `02_Scenes` は scene master であり変更不可
- 1 scene = 1 row
- `short_use` を原則参照する
- `04_Script_Full` がある場合は凝縮元として参照可
- ない場合は `02_Scenes` のみで生成する
- `video_format = short` のみの場合は、`04_Script_Full` を参照しない
- `narration_draft` / `narration_tts` / `subtitle_short_1/2` / `emotion` / `transition_note` を生成する
- `short_target_sec` を意識しつつ、物語品質優先、+15% 許容

### 19.2 Schema 設計前提
- GSS 実在列以外を schema の必須列にしない
- `scene_id` は含めない
- `scene_no` は持っていても key として扱わない
- `record_id` を row 識別の中心にする
- `subtitle_short_1` / `subtitle_short_2` は string
- `duration_sec` は number/integer
- `emotion` は string
- `related_version` は
  - Short: `short`
  - Full: `full`

### 19.3 Example 設計前提
- `record_id` は STEP_03 の `02_Scenes.record_id` を引き継ぐ
- Short / Full の sample は同一 `record_id` に対応する別シート row の形で示す
- Full の方が narrative density が高いこと
- Short は Full の凝縮版でありうること
- ただし `video_format = short` 単独時は Full 非参照で成立すること

---

## 20. 実装上の注意
- `91_Field_Master.field_name` を正本として扱う
- 実在しない列を仕様前提にしない
- `scene_no` はキーに使わない
- upsert は各シート内で `record_id`
- `record_id` は STEP_03 由来 row をそのまま引き継ぐ
- partial success を許容する
- Full参照は optional であり、Short単独生成を妨げない

---

## 21. 今後の関連成果物
本仕様をもとに、次に以下を作成する。

- `step04_05_prompt_short_v1.md`
- `step04_05_prompt_full_v1.md`
- `step04_script_short_schema_ai_v1.json`
- `step05_script_full_schema_ai_v1.json`
- `step04_script_short_schema_full_v1.json`
- `step05_script_full_schema_full_v1.json`
- `examples/step04_script_short_example_v1.json`
- `examples/step05_script_full_example_v1.json`

---

## 22. オーナー確認済みの主要判断（要約）
- combined spec で管理
- `video_format` で `short / full / short+full` 分岐
- 1 scene = 1 row
- `short_use / full_use` は原則参照、限定微修正可
- 物語品質優先、+15% 許容
- Full → Short の順
- Short は必要に応じて Full参照可
- ただし `video_format = short` のみなら Full は参照しない
- `scene_id` は使わない
- `scene_no` はキーに使わない
- `record_id` を引き継ぐ
- upsert キーは各シート内 `record_id`
- `duration_sec` は script 実体ベース再計算
- `emotion` は微修正可
- `transition_note` / `pause_hint` は上位概念共通・列は別
- Full でも `subtitle_short_1/2` を使う
- partial success 許容
- `field_name` を正本とし、意味は spec で再定義する

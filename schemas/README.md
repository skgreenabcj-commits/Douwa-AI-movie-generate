# Schemas

JSON schema files for Gemini AI outputs and Google Sheets full row definitions.

## ファイル一覧

| ファイル | 用途 |
|---|---|
| `rights_validation_schema_ai_v1.json` | STEP_01 AI出力スキーマ |
| `rights_validation_schema_full_v1.json` | STEP_01 GSS書き込み full rowスキーマ |
| `source_build_schema_ai_v1.json` | STEP_02 AI出力スキーマ |
| `source_build_schema_full_v1.json` | STEP_02 GSS書き込み full rowスキーマ |
| `scene_build_schema_ai_v1.json` | STEP_03 AI出力スキーマ（scene配列のみ、scene_no/scene_orderはシステム付与のため含まない） |
| `scene_build_schema_full_v1.json` | STEP_03 GSS書き込み full rowスキーマ（02_Scenes 実際の列順に準拠） |
| `script_short_schema_ai_v1.json` | STEP_04 AI出力スキーマ（emotion/duration_secはシステム補完のため含まない） |
| `script_full_schema_ai_v1.json` | STEP_05 AI出力スキーマ（emotion/duration_secはシステム補完のため含まない） |
| `script_short_schema_full_v1.json` | STEP_04 GSS書き込み full rowスキーマ（03_Script_Short 実際の列順に準拠） |
| `script_full_schema_full_v1.json` | STEP_05 GSS書き込み full rowスキーマ（04_Script_Full 実際の列順に準拠） |

## scene_build_schema_full_v1.json の列構成

GSS `02_Scenes` シートの実際のヘッダー列順に対応。

| 列名 | 区分 | 備考 |
|---|---|---|
| `project_id` | SYSTEM | 案件ID |
| `record_id` | SYSTEM | PJT-001-SCN-001 形式 |
| `generation_status` | SYSTEM | GENERATED / FAILED / SKIPPED / PENDING |
| `approval_status` | HUMAN | PENDING / APPROVED / REJECTED |
| `step_id` | SYSTEM | 固定: STEP_03_SCENES_BUILD |
| `scene_no` | SYSTEM | project_id ごとの通し番号（`"1"`, `"2"`, `"3"`...）。文字列型で GSS に書き込む。旧 `scene_id`（SC-001-01 形式）+ `scene_order` 2カラムを廃止し1カラムに統合済み。 |
| `chapter` | AI出力 | 物語上の章・大区分 |
| `scene_title` | AI出力 | 場面名称 |
| `scene_summary` | AI出力 | 場面要約 |
| `scene_goal` | AI出力 | 物語上の役割 |
| `visual_focus` | AI出力 | 映像化の主焦点 |
| `emotion` | AI出力 | 感情トーン |
| `short_use` | AI出力 | Y/N フラグ |
| `full_use` | AI出力 | Y/N フラグ（初期実装では原則 Y） |
| `est_duration_short` | AI出力 | Short版概算秒数（rough estimate） |
| `est_duration_full` | AI出力 | Full版概算秒数（rough estimate） |
| `difficult_words` | AI出力 | 難語（全角「、」区切り） |
| `easy_rewrite` | AI出力 | 言い換え候補（全角「、」区切り対応） |
| `qa_seed` | AI出力 | QA生成の種 |
| `continuity_note` | AI出力 | 前後scene接続メモ |
| `updated_at` | SYSTEM | ISO8601形式 |
| `updated_by` | SYSTEM | 固定: github_actions |
| `notes` | HUMAN | 補足メモ（生成直後は空文字） |

> **注**: `scene_no` は以前の仕様では `scene_id`（SC-001-01 形式）と `scene_order`（整数）の 2 カラムだったが、
> GSS 02_Scenes の実ヘッダーに合わせて `scene_no` 1 カラムに統合済み。
> さらに、`scene_id` の値形式も SC-001-01 形式からシンプルな **project_id ごとの通し番号**（`"1"`, `"2"`, `"3"`...）に変更。
> 内部管理用 `scene_order`（1始まり整数）はコード内部では保持するが GSS には出力しない。

---

## script_short_schema_full_v1.json の列構成

GSS `03_Script_Short` シートの実際のヘッダー列順に対応。

| 列名 | 区分 | 備考 |
|---|---|---|
| `project_id` | SYSTEM | 案件ID |
| `record_id` | SYSTEM | `02_Scenes.record_id` をそのまま流用（新規採番なし）。upsert キー。|
| `generation_status` | SYSTEM | GENERATED / FAILED / SKIPPED / PENDING |
| `approval_status` | HUMAN | PENDING / APPROVED / REJECTED |
| `step_id` | SYSTEM | 固定: STEP_04_SHORT_SCRIPT_BUILD |
| `scene_no` | 参照用 | 02_Scenes.scene_no の通し番号。表示用。upsert キーには使わない。 |
| `related_version` | SYSTEM | 固定: short |
| `duration_sec` | SYSTEM補完 | narration_tts 文字数 ÷ 5.5（切り上げ整数）。AI は出力しない。 |
| `narration_draft` | AI出力 | Short版 script 基準文 |
| `narration_tts` | AI出力 | 読み上げ最適化版 |
| `subtitle_short_1` | AI出力 | 字幕ブロック1 |
| `subtitle_short_2` | AI出力 | 字幕ブロック2（空文字可） |
| `emphasis_word` | AI出力 | 強調語（任意） |
| `transition_note` | AI出力 | scene 切替・接続メモ |
| `emotion` | SYSTEM補完 | `02_Scenes.emotion` をコード側でコピー。AI は出力しない。 |
| `hook_flag` | AI出力 | Y/N フラグ（任意） |
| `tts_ready` | AI出力 | Y/N フラグ（任意） |
| `updated_at` | SYSTEM | ISO8601形式 |
| `updated_by` | SYSTEM | 固定: github_actions |
| `notes` | HUMAN | 補足メモ |

---

## script_full_schema_full_v1.json の列構成

GSS `04_Script_Full` シートの実際のヘッダー列順に対応。

| 列名 | 区分 | 備考 |
|---|---|---|
| `project_id` | SYSTEM | 案件ID |
| `record_id` | SYSTEM | `02_Scenes.record_id` をそのまま流用（新規採番なし）。upsert キー。 |
| `generation_status` | SYSTEM | GENERATED / FAILED / SKIPPED / PENDING |
| `approval_status` | HUMAN | PENDING / APPROVED / REJECTED |
| `step_id` | SYSTEM | 固定: STEP_05_FULL_SCRIPT_BUILD |
| `scene_no` | 参照用 | 02_Scenes.scene_no の通し番号。表示用。upsert キーには使わない。 |
| `related_version` | SYSTEM | 固定: full |
| `duration_sec` | SYSTEM補完 | narration_tts 文字数 ÷ 5.5（切り上げ整数）。AI は出力しない。 |
| `narration_draft` | AI出力 | Full版 script 基準文（narrative richness 優先） |
| `narration_tts` | AI出力 | 読み上げ最適化版 |
| `subtitle_short_1` | AI出力 | scene 主要短文字幕ブロック1（列名が short でも Full版で使用） |
| `subtitle_short_2` | AI出力 | scene 主要短文字幕ブロック2（列名が short でも Full版で使用） |
| `visual_emphasis` | AI出力 | 映像上の強調点（任意） |
| `pause_hint` | AI出力 | 間・余白・感情の溜めメモ |
| `emotion` | SYSTEM補完 | `02_Scenes.emotion` をコード側でコピー。AI は出力しない。 |
| `hook_flag` | AI出力 | Y/N フラグ（任意） |
| `tts_ready` | AI出力 | Y/N フラグ（任意） |
| `updated_at` | SYSTEM | ISO8601形式 |
| `updated_by` | SYSTEM | 固定: github_actions |
| `notes` | HUMAN | 補足メモ |

> **注**: `subtitle_short_1/2` は列名に "short" が含まれるが、`04_Script_Full` でも同列を使用する（GSS `91_Field_Master` 実在列を尊重）。将来の列名整理候補。

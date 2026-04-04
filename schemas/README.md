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

## scene_build_schema_full_v1.json の列構成

GSS `02_Scenes` シートの実際のヘッダー列順に対応。

| 列名 | 区分 | 備考 |
|---|---|---|
| `project_id` | SYSTEM | 案件ID |
| `record_id` | SYSTEM | PJT-001-SCN-001 形式 |
| `generation_status` | SYSTEM | GENERATED / FAILED / SKIPPED / PENDING |
| `approval_status` | HUMAN | PENDING / APPROVED / REJECTED |
| `step_id` | SYSTEM | 固定: STEP_03_SCENES_BUILD |
| `scene_no` | SYSTEM | SC-001-01 形式。旧 scene_id + scene_order 2カラムを廃止し1カラムに統合済み。 |
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
> 内部管理用 `scene_order` はコード内部では保持するが GSS には出力しない。

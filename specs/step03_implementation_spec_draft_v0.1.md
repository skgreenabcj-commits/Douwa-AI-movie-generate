# STEP_03 実装仕様 draft v0.1

> **ステータス**: ドラフト（ユーザー確認待ち）  
> **作成日**: 2026-04-03  
> **前提**: STEP_01 / STEP_02 実装仕様 v0.2 の構造・パターンを継承する

---

## 0. ユーザー確認事項

本仕様を確定する前に、以下の点についてユーザーの判断を仰ぐ。  
各項目に **選択肢** と **推奨** を明記する。

---

### 確認事項 A — `scene` の総数設計方針

**背景**  
scene 数は後工程（Short Script / Full Script / Visual / Q&A）の構造を直接規定する。  
現在 `00_Project` には `short_target_sec` と `full_target_sec` が存在するが、  
STEP_03 が受け取るこれらの値（実際の数値）がどのような範囲になるか、GSS 側で確認が必要。

**選択肢**

| 案 | scene 数の決め方 | 説明 |
|---|---|---|
| **A-1（推奨）** | AI が `target_age` と `full_target_sec` から自動算出 | AI が適切な粒度で分割。GSS 設定不要。 |
| A-2 | `short_target_sec` / `full_target_sec` から固定換算式で算出 | 例: 1 scene = 20〜30 秒で除算。GSS 設定不要。 |
| A-3 | `94_Runtime_Config` にデフォルト scene 数を設定 | 例: `step_03_default_scene_count = 5`。GSS 設定で調整可能。 |

**推奨**: **A-1**。AI が `target_age`・動画尺・物語の内容を総合的に判断できるため、品質上最も望ましい。ただし AI 出力のばらつきが懸念される場合は A-2 または A-3 を補完的に設ける。

**確認事項**  
- `short_target_sec` / `full_target_sec` の典型値（例: Short = 60〜90秒、Full = 3〜5分 等）を共有してください。
- scene 数の上限・下限を設けますか？（例: 最小 3 scene、最大 10 scene）

---

### 確認事項 B — `02_Scenes` シートの upsert 単位

**背景**  
STEP_03 は 1 project につき複数の scene 行を生成する（例: 5〜8 件）。  
これをシートにどう書き込むか方針が必要。

**選択肢**

| 案 | upsert 単位 | 説明 |
|---|---|---|
| **B-1（推奨）** | `project_id` 単位で全 scene を一括置換 | 再実行時に前回の scene を全削除し再挿入。STEP_02 の `01_Source` と同様の設計。 |
| B-2 | `project_id` + `scene_id` の複合キーで個別 upsert | 一部 scene の差し替えが可能。実装が複雑になる。 |
| B-3 | 追記のみ（再実行時は新しい scene を末尾に追加） | シンプルだが再実行時に重複が生じるリスクあり。 |

**推奨**: **B-1**。初期実装として最もシンプルで、後工程（STEP_04 以降）との整合性が保ちやすい。  
再実行時の一貫性確保のため、`project_id` 単位で全 scene を置換する。

---

### 確認事項 C — `scene_type` の要否

**背景**  
scene にタイプ区分（例: `intro` / `main` / `climax` / `ending`）を設けると  
後工程（Script / Visual / Q&A）での条件処理が容易になる。

**選択肢**

| 案 | scene_type | 説明 |
|---|---|---|
| **C-1（推奨）** | あり（enum で固定） | AI が各 scene に `scene_type` を付与。後工程の条件分岐に使う。 |
| C-2 | なし | `scene_order` と `scene_title` のみで識別。シンプル。 |

**推奨**: **C-1**。`scene_type` があると STEP_04〜09 のプロンプト設計が大幅に容易になる。  
enum 案: `intro` / `development` / `climax` / `resolution` / `ending`

---

### 確認事項 D — `02_Scenes` シートの事前準備

**背景**  
STEP_02 では `01_Source` に事前 999 空行が必要だった。  
STEP_03 の `02_Scenes` も同様の事前準備が必要か。

**選択肢**

| 案 | 説明 |
|---|---|
| **D-1（推奨）** | 事前に 999 空行を挿入する（STEP_02 と同一方式） |
| D-2 | appendRow 方式（空行不要。ただし STEP_02 では使わなかった方式） |

**推奨**: **D-1**。既存パターンと統一し、sheets-client.js の upsert ロジックをそのまま再利用できる。  
実装着手前にユーザーが GSS で `02_Scenes` に 999 空行を挿入する。

---

### 確認事項 E — STEP_03 の `approval_status` 承認フロー

**背景**  
STEP_01 / STEP_02 では、AI 生成直後は `approval_status = PENDING` とし、  
人がレビュー・承認してから後工程に進む設計になっている。  
STEP_03 も同様のフローか、あるいは scene は自動的に後工程へ流れるか。

**選択肢**

| 案 | 説明 |
|---|---|
| **E-1（推奨）** | 生成後 `approval_status = PENDING` → 人が確認して `APPROVED` → STEP_04/05 が起動可 |
| E-2 | 生成後 `approval_status = AUTO_APPROVED` として即時後工程可 |

**推奨**: **E-1**。scene は後工程全体の基準となるため、必ず人がレビューするフローを推奨する。

---

## 1. 目的

本ドキュメントは、GitHub Actions 上で実行する STEP_03（Scenes Build）の初期実装仕様を定義する。

**STEP_03 の役割**:  
STEP_02 で生成した `01_Source`（底本・脚色方針）をもとに、AI が物語を scene 単位に分割し、  
後工程（STEP_04 Short Script / STEP_05 Full Script / STEP_06 Visual Bible / STEP_07 Image Prompts / STEP_08 TTS・Edit Plan / STEP_09 Q&A）が参照する **scene master** を生成する。

**設計原則**:
- scene は `target_age` と動画尺（`short_target_sec` / `full_target_sec`）を前提に設計する
- scene の粒度は「年齢適合性・理解しやすさ・映像化しやすさ・脚本化しやすさ」を満たすこと
- 初期実装では、後工程側での scene 分割・統合・並べ替えは行わない（STEP_03 が正本）

---

## 2. スコープ

### 対象
- 起動: GAS → GitHub Actions `workflow_dispatch`（STEP_01 / STEP_02 と同一経路）
- 入力:
  - `00_Project`（主入力: `target_age`, `short_target_sec`, `full_target_sec`, `title_jp`, `visual_style` 等）
  - `01_Source`（参照入力: `adaptation_policy`, `language_style`, `difficult_terms`, `credit_text`, `base_text_notes`）
- AI 実行: Gemini API を利用して scene 分割を行う
- 出力:
  - `02_Scenes` に scene 行を書き込む（project_id 単位の一括置換）
  - `00_Project` の `current_step` を `STEP_03_SCENES_BUILD` に更新
  - `100_App_Logs` に成功・失敗ログを書き出す

### スコープ外（初期実装）
- scene の分割・統合・並べ替え（後工程側では禁止、STEP_03 が正本）
- Short / Full の scene 数を別々に設計すること（同一 scene 構成を両方で再利用）
- 大量バッチ最適化
- fast-pass（STEP_03 では適用なし）

---

## 3. 実行方式

STEP_01 / STEP_02 と同一の実行経路を採用する。

1. GAS が `workflow_dispatch` で GitHub Actions を起動
2. GitHub Actions が `94_Runtime_Config` を読む
3. payload に基づき `00_Project` から対象案件を読む
4. **`current_step` が `STEP_02_SOURCE_BUILD` でない場合は警告（エラー停止 or 続行はユーザー確認事項）**
5. `01_Source` から当該 `project_id` の行を読む
6. **`01_Source` の `approval_status` が `APPROVED` でない場合はエラー停止**
7. Prompt / Schema / Example / Field Guide を読み込む
8. Gemini を実行する
9. AI 出力を schema 検証する
10. `02_Scenes` に scene 行を一括 upsert する（project_id 単位）
11. `00_Project` の `current_step` 等を最小更新する
12. `100_App_Logs` に成功・失敗ログを書き出す

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 参照入力シート
- `01_Source`（`project_id` をキーに 1 行取得）

### 4.3 主キー
- `project_id`

### 4.4 AI に渡す入力列（案）

**`00_Project` から渡す列**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `project_id` | **Mandatory** | 案件識別 |
| `title_jp` | **Mandatory** | 作品タイトル |
| `target_age` | **Mandatory** | scene 粒度・語彙・尺に直結 |
| `short_target_sec` | **Mandatory** | Short 動画尺（scene 総数の根拠） |
| `full_target_sec` | **Mandatory** | Full 動画尺（scene 総数の根拠） |
| `visual_style` | Optional | 映像化方針の補足 |

**`01_Source` から渡す列**:

| フィールド | 必須 | 用途 |
|---|---|---|
| `adaptation_policy` | **Mandatory** | 現代語化・脚色方針（scene 設計の最重要入力） |
| `language_style` | **Mandatory** | 言語スタイル方針 |
| `difficult_terms` | Optional | 難語リスト（scene 内で回避・注意する語） |
| `credit_text` | Optional | クレジット文（scene 内では参照のみ） |
| `base_text_notes` | Optional | 底本注記（scene 設計の補足） |

### 4.5 事前チェック

```
if 01_Source row が見つからない:
  → エラー停止 + approval_status=UNKNOWN + ログ

if 01_Source.approval_status != "APPROVED":
  → エラー停止 + approval_status=UNKNOWN + ログ（STEP_02 完了・承認を要求）
```

> **注**: `01_Source.approval_status` チェックは STEP_02 の `00_Rights_Validation.rights_status` チェックに相当する。

---

## 5. 出力

### 5.1 `02_Scenes` の列定義（案）

| フィールド | role | AI出力 | 後続AI入力 | 説明 |
|---|---|---|---|---|
| `project_id` | SYSTEM_CONTROL | N | — | 案件ID（GH補完） |
| `record_id` | SYSTEM_CONTROL | N | — | GH採番（後述）|
| `generation_status` | SYSTEM_CONTROL | N | — | 固定: `GENERATED` |
| `approval_status` | HUMAN_REVIEW | N | — | 固定: `PENDING` |
| `step_id` | SYSTEM_CONTROL | N | — | 固定: `STEP_03_SCENES_BUILD` |
| `scene_id` | AI_OUTPUT | Y | **Y** | scene 識別子（例: `SC-001-01`） |
| `scene_order` | AI_OUTPUT | Y | **Y** | scene の順序（1始まり整数） |
| `scene_title` | AI_OUTPUT | Y | **Y** | scene タイトル（短く端的に） |
| `scene_summary` | AI_OUTPUT | Y | **Y** | scene の内容サマリー（2〜4文） |
| `scene_purpose` | AI_OUTPUT | Y | **Y** | scene の物語的役割・目的 |
| `scene_type` | AI_OUTPUT | Y | **Y** | scene 種別（enum: `intro` / `development` / `climax` / `resolution` / `ending`） |
| `scene_target_sec` | AI_OUTPUT | Y | **Y** | この scene の推奨尺（秒）|
| `key_characters` | AI_OUTPUT | Y | **Y** | 登場する主要キャラクター（全角「、」区切り） |
| `key_events` | AI_OUTPUT | Y | **Y** | scene 内で起こる主要な出来事（1〜3文） |
| `visual_notes` | AI_OUTPUT | Y | **Y** | 映像化の方向性ヒント（STEP_06 Visual Bible 用） |
| `narration_style` | AI_OUTPUT | Y | **Y** | このsceneのナレーション・語りのトーン |
| `updated_at` | SYSTEM_CONTROL | N | — | GH補完（ISO8601） |
| `updated_by` | SYSTEM_CONTROL | N | — | 固定: `github_actions` |
| `notes` | HUMAN_REVIEW | N | N | 補足メモ（空文字） |

> **補足**: `scene_id` は `record_id` とは別に AI が命名する scene 固有 ID。  
> 例: `SC-001-01`（project 001 の scene 1）

### 5.2 `record_id` 採番規則（案）

- 形式: `PJT-001-SCN-001`
- `SCN` サフィックス（STEP_02 の `SC` と区別）
- 連番部分は `scene_order` から算出（例: scene_order=1 → `PJT-001-SCN-001`）

### 5.3 `00_Project` の更新対象列

| フィールド | 更新値 |
|---|---|
| `current_step` | `STEP_03_SCENES_BUILD`（上書き） |
| `approval_status` | 成功: `PENDING` / 失敗: `UNKNOWN` |
| `updated_at` | 実行完了時刻 |
| `updated_by` | `github_actions` |

---

## 6. scene 設計ルール（STEP_03 Scene Definition Rule）

### 6.1 基本原則
- STEP_03 は後工程（STEP_04〜09）の基準となる **scene master** を定義する
- scene 設計時は `target_age` と動画尺（`short_target_sec` / `full_target_sec`）を前提条件とする
- scene は「年齢適合性・理解しやすさ・映像化しやすさ・脚本化しやすさ」を満たす粒度で分割する
- 各 scene は `scene_id`, `scene_order`, `scene_title`, `scene_summary`, `scene_purpose` を必ず保持する
- 初期実装では STEP_03 の scene 構造を正本とし、**後工程側での scene 分割・統合・並べ替えは禁止**

### 6.2 target_age 別の scene 設計指針（案）

| target_age | 推奨 scene 数（Full） | scene の特徴 |
|---|---|---|
| 2-3歳 | 3〜5 scene | 1 scene = 単純な動作・繰り返し中心。場面転換は最小限。 |
| 4-6歳 | 4〜6 scene | 1 scene = 物語の 1 イベント。起承転結を意識。 |
| 6-8歳 | 5〜8 scene | 1 scene = より細かい場面。心情変化を含む。 |

> Short 動画は Full scene の一部（通常 1〜3 scene）を使用するか、Full scene を圧縮する（後工程で処理）。

### 6.3 scene と動画尺の関係（案）
- `scene_target_sec` の合計が `full_target_sec` の ±20% 以内に収まるよう AI に指示する
- Short 用の scene_target_sec は Full とは別に設けない（Short は Full scene を参照・再利用する）

---

## 7. エラーハンドリング

| エラー種別 | 対処 |
|---|---|
| `01_Source` 行が見つからない | エラー停止 + `approval_status=UNKNOWN` + ログ |
| `01_Source.approval_status != APPROVED` | エラー停止 + `approval_status=UNKNOWN` + ログ |
| Gemini API 失敗（primary） | secondary fallback |
| Gemini API 失敗（secondary） | `approval_status=UNKNOWN` + ログ |
| schema validation 失敗 | `approval_status=UNKNOWN` + ログ |
| scene 数が上限/下限を外れる | 警告ログ + 続行（scene 数のバリデーションは soft check） |
| GSS 書き込み失敗 | ログ出力（処理続行） |

---

## 8. ランタイム設定

| key | 内容 | 備考 |
|---|---|---|
| `gemini_api_key` | Gemini API Key | STEP_01/02 と共通 |
| `step_03_model_role` | STEP_03 primary model | **独立キー**、未設定時: `gemini-2.5-pro` |
| `model_role_text_flash_seconday` | secondary model | STEP_02 と共通キー |

> **GSS 対応**: `94_Runtime_Config` に `step_03_model_role` キーを実装着手前に追加すること。

---

## 9. 利用アセットファイル一覧（案）

| ファイルパス | 状態 | 内容 |
|---|---|---|
| `prompts/scene_build_prompt_v1.md` | **本仕様と同時作成** | STEP_03 メインプロンプト |
| `prompts/fragments/scene_build_output_field_guide_v1.md` | **本仕様と同時作成** | 出力フィールドガイド |
| `schemas/scene_build_schema_ai_v1.json` | **本仕様と同時作成** | AI出力スキーマ |
| `schemas/scene_build_schema_full_v1.json` | **本仕様と同時作成** | GSS書き込み full スキーマ |
| `examples/scene_build_ai_response_example_v1.json` | **本仕様と同時作成** | AI出力サンプル（1案件・複数 scene） |

---

## 10. 実装フェーズ計画（案）

| フェーズ | 内容 | 新規/流用 |
|---|---|---|
| Phase 1 | `src/types.ts` に `SceneFullRow`, `SceneAiRow` 追加 | 既存拡張 |
| Phase 2 | `src/lib/write-scenes.ts`（02_Scenes 一括 upsert） | **新規** |
| Phase 3 | `src/lib/load-source.ts`（01_Source 読み込み） | **新規** |
| Phase 4 | `src/lib/build-prompt.ts` に `buildStep03Prompt` 追加 | 既存拡張 |
| Phase 5 | `src/lib/load-assets.ts` に `loadStep03Assets` 追加 | 既存拡張 |
| Phase 6 | `src/lib/validate-json.ts` に `validateSceneAiResponse` 追加 | 既存拡張 |
| Phase 7 | `src/steps/step03-scenes-build.ts`（オーケストレーター） | **新規** |
| Phase 8 | `src/index.ts` に STEP_03 ルーティング追加 | 既存拡張 |
| Phase 9 | `src/lib/write-app-log.ts` に STEP_03 ログビルダー追加 | 既存拡張 |

---

## 11. AI スキーマ（骨格案）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "scene_build_schema_ai_v1",
  "description": "STEP_03 Scenes Build の AI 出力スキーマ",
  "type": "object",
  "required": ["scenes"],
  "additionalProperties": false,
  "properties": {
    "scenes": {
      "type": "array",
      "minItems": 3,
      "maxItems": 10,
      "items": {
        "type": "object",
        "required": [
          "scene_id",
          "scene_order",
          "scene_title",
          "scene_summary",
          "scene_purpose",
          "scene_type",
          "scene_target_sec",
          "key_characters",
          "key_events",
          "visual_notes",
          "narration_style"
        ],
        "additionalProperties": false,
        "properties": {
          "scene_id":         { "type": "string", "maxLength": 50 },
          "scene_order":      { "type": "integer", "minimum": 1 },
          "scene_title":      { "type": "string", "maxLength": 100 },
          "scene_summary":    { "type": "string", "maxLength": 500 },
          "scene_purpose":    { "type": "string", "maxLength": 300 },
          "scene_type":       { "type": "string", "enum": ["intro", "development", "climax", "resolution", "ending"] },
          "scene_target_sec": { "type": "integer", "minimum": 5 },
          "key_characters":   { "type": "string", "maxLength": 300 },
          "key_events":       { "type": "string", "maxLength": 500 },
          "visual_notes":     { "type": "string", "maxLength": 500 },
          "narration_style":  { "type": "string", "maxLength": 300 }
        }
      }
    }
  }
}
```

---

## 12. AI 出力サンプル（骨格案）

```json
{
  "scenes": [
    {
      "scene_id": "SC-001-01",
      "scene_order": 1,
      "scene_title": "桃が流れてくる",
      "scene_summary": "おじいさんとおばあさんが川のそばで暮らしていました。ある日、川上から大きな桃がどんぶらこと流れてきました。",
      "scene_purpose": "物語の舞台と主要な出来事（桃の出現）を導入する",
      "scene_type": "intro",
      "scene_target_sec": 30,
      "key_characters": "おじいさん、おばあさん",
      "key_events": "川で大きな桃を発見する。桃を家に持ち帰る。",
      "visual_notes": "穏やかな川辺の風景。桃が流れてくるアニメーション。",
      "narration_style": "穏やかでゆっくりとした語り口。幼児が安心して聞けるトーン。"
    },
    {
      "scene_id": "SC-001-02",
      "scene_order": 2,
      "scene_title": "桃から赤ちゃんが生まれる",
      "scene_summary": "家に帰って桃を割ると、中から元気な赤ちゃんが生まれました。ふたりは桃太郎と名付けて大切に育てました。",
      "scene_purpose": "主人公・桃太郎の誕生と成長を描く",
      "scene_type": "development",
      "scene_target_sec": 25,
      "key_characters": "おじいさん、おばあさん、桃太郎（赤ちゃん）",
      "key_events": "桃を割ると赤ちゃんが出てくる。桃太郎と名付けて育てる。",
      "visual_notes": "桃が割れるシーン（明るく可愛らしく）。成長の時系列イラスト。",
      "narration_style": "喜びと驚きを込めた明るいトーン。"
    }
  ]
}
```

---

## 13. 実装着手前チェックリスト

**ユーザー確認事項（本仕様 §0 参照）**
- [ ] 確認事項 A: scene 数の設計方針（A-1 / A-2 / A-3）
- [ ] 確認事項 B: upsert 単位（B-1 / B-2 / B-3）
- [ ] 確認事項 C: scene_type の要否（C-1 / C-2）
- [ ] 確認事項 D: 02_Scenes シート事前準備方針（D-1 / D-2）
- [ ] 確認事項 E: approval_status フロー（E-1 / E-2）
- [ ] `short_target_sec` / `full_target_sec` の典型値の共有

**実装着手前に実施すること**
- [ ] GSS `94_Runtime_Config` に `step_03_model_role = gemini-2.5-pro` を追加
- [ ] `02_Scenes` シートの列構成を GSS_field_master に追加・確認
- [ ] `02_Scenes` シートに 999 行の空行を挿入（D-1 採用時）
- [ ] 確認事項 A〜E の回答完了

**実装フェーズ**
- [ ] Phase 1: `src/types.ts` に `SceneFullRow`, `SceneAiRow` 追加
- [ ] Phase 2: `src/lib/write-scenes.ts` 新規作成
- [ ] Phase 3: `src/lib/load-source.ts` 新規作成
- [ ] Phase 4: `src/lib/build-prompt.ts` に `buildStep03Prompt` 追加
- [ ] Phase 5: `src/lib/load-assets.ts` に `loadStep03Assets` 追加
- [ ] Phase 6: `src/lib/validate-json.ts` に `validateSceneAiResponse` 追加
- [ ] Phase 7: `src/steps/step03-scenes-build.ts` 新規作成
- [ ] Phase 8: `src/index.ts` に STEP_03 ルーティング追加
- [ ] Phase 9: `src/lib/write-app-log.ts` に STEP_03 ログビルダー追加
- [ ] アセットファイル群（prompt / schema / example）作成

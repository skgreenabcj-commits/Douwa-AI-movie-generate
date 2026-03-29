# STEP_01 実装仕様 v0.1

## 1. 目的
本ドキュメントは、GitHub 上で実行する STEP_01（Rights Validation）の初期実装仕様を定義するための合意用仕様書である。  
対象は、Google Sheets 上の案件情報を入力として、Gemini を用いた権利確認を実行し、結果を `00_Rights_Validation` および `00_Project` に書き戻す処理である。

本書は以下を目的とする。
- STEP_01 の初期実装範囲を明確化する
- GAS → GitHub Actions → Google Sheets API の実行経路を固定する
- AI 出力、GitHub 補完、fast-pass 適用の責務分担を明確化する
- 未確定論点を比較案付きで整理し、実装前に合意を取る

---

## 2. スコープ
本仕様の対象範囲は以下とする。
- 起動: GAS から GitHub Actions を `workflow_dispatch` で起動
- 入力: `00_Project` から 1 件または 2 件の案件を読み込む
- AI 実行: Gemini API を利用して rights validation を行う
- 出力: `00_Rights_Validation` に権利確認結果を書き込み、`00_Project` に案件側の状態更新を書き戻す
- fast-pass: `config/fast_pass_logic_v1.md` に基づき適用する
- ランタイム設定: `94_Runtime_Config` から取得する

本仕様では、複数ステップ連携、Webhook 受信、バッチ大量実行、履歴管理高度化は初期スコープ外とする。

---

## 3. 実行方式

### 3.1 基本方針
- 起動元は GAS とする
- 実行先は GitHub Actions とする
- GitHub Actions は Google Sheets API を直接利用して GSS を read/write する
- GitHub → GSS の戻しに Webhook は使わない
- 認証は Service Account を使用する

### 3.2 実行経路
1. GAS が `workflow_dispatch` で GitHub Actions を起動
2. GitHub Actions が `94_Runtime_Config` を読む
3. GitHub Actions が `00_Project` から対象案件を読む
4. Prompt / Policy / Schema / Example を読み込む
5. Gemini を実行する
6. AI 出力を schema 検証する
7. fast-pass を適用する
8. `00_Rights_Validation` に full row を書き戻す
9. `00_Project` に案件側の状態を反映する

---

## 4. 入力

### 4.1 主入力シート
- `00_Project`

### 4.2 初期実装での処理単位
- 1 案件または 2 案件

### 4.3 案件識別
- 主キー候補: `project_id`

### 4.4 参照予定情報
初期実装では最低限、`00_Project` から STEP_01 に必要な権利確認用情報を読み込む。  
具体的な AI 入力列は、`91_Field_Master` / `93_IO_Mapping` と整合する形で最終確定する。

想定入力項目例:
- `project_id`
- タイトル
- 原作名
- 著者名
- 翻訳者名
- source_url
- source_type
- jurisdiction
- 利用対象メモ
- その他 rights validation に必要な案件情報

---

## 5. 出力

### 5.1 主出力シート
- `00_Rights_Validation`

### 5.2 補助出力シート
- `00_Project`

### 5.3 出力責務の分担
#### AI が主に返すもの
- 著者・訳者情報
- 生没年
- public domain candidate 判定
- rights summary
- rights evidence URL
- rights_status の候補
- risk_level の候補
- review_required の候補

#### GitHub システムが補完・確定するもの
- `project_id`
- `record_id`
- `step_id`
- `generation_status`
- `approval_status`
- `updated_at`
- `updated_by`
- `notes`
- fast-pass による補正後の最終値
- 必要に応じて `go_next`

---

## 6. ランタイム設定

### 6.1 設定の取得元
- `94_Runtime_Config`

### 6.2 取得対象
- Gemini API Key
- Gemini model name
- 必要に応じて temperature, max_tokens, 実行フラグ等

### 6.3 方針
初期実装では、Gemini API Key と model は `94_Runtime_Config` を正本として取得する。  
将来的には GitHub Secrets fallback を許容する設計も検討可能だが、v0.1 では必須要件としない。

---

## 7. AI 実行方針

### 7.1 利用ファイル
想定する利用ファイルは以下。
- Prompt: `prompts/rights_validation_prompt_v1.md`
- Copyright Policy: `promptscopyright_policy_jp_v1.md`
- Review Policy: `prompts/rights_review_policy_v1.md`
- Output Field Guide: `prompts/fragments/rights_validation_output_field_guide_v1.md`
- AI Schema: `schemas/rights_validation_schema_ai_v1.json`
- Full Schema: `schemas/rights_validation_schema_full_v1.json`
- AI Example: `examples/rights_validation_ai_row_example_v1.json`
- Full Example: `examples/rights_validation_full_row_example_v1.json`
- Fast-pass Logic: `config/fast_pass_logic_v1.md`

### 7.2 出力原則
- AI には schema 準拠 JSON を返させる
- GitHub は JSON parse / schema validation を行う
- validation 失敗時は失敗ステータスを返し、必要に応じて `00_Project` に失敗反映を行う

---

## 8. fast-pass 適用方針

### 8.1 基本方針
- fast-pass は AI 出力を完全に置き換えるものではない
- GitHub 後段処理で限定的な補正候補として適用する
- 判定キーは `source_url` のドメインとする

### 8.2 ルール参照元
- `config/fast_pass_logic_v1.md`

### 8.3 初期実装対象
- `www.aozora.gr.jp`

### 8.4 適用タイミング
1. AI 出力取得
2. schema 検証
3. fast-pass 条件判定
4. 最終 row 組み立て
5. GSS 書き戻し

### 8.5 適用禁止条件
- AI が `BLOCKED` を返した場合
- AI が `risk_level=HIGH` を返した場合
- 翻訳者・編者・注釈者・挿絵等の別権利懸念がある場合
- 個別注意書きや特殊利用条件がある場合

---

## 9. 00_Project 更新方針（論点 A）

### 9.1 論点
STEP_01 の実行後に `00_Project` のどの列を更新するかを決める必要がある。  
更新しすぎると運用上の衝突が増え、更新しなさすぎると案件管理がしづらくなる。

### 9. 00_Project 更新方針（論点 A）の決定案

#### 00_Project　の列構成
- `project_id`
- `record_id`
- `project_status`
- `current_step`
- `run_enabled`
- `approval_status`
- `rights_status`
- `title_jp`
- `title_en`
- `series_name`
- `episode_no`
- `source_title`
- `source_url`
- `target_age`
- `video_format`
- `aspect_short`
- `aspect_full`
- `short_target_sec`
- `full_target_sec`
- `visual_style`
- `owner`
- `created_at`
- `updated_at`
- `updated_by`
- `notes`


#### 論点Aの決定案
- "案 A-1: 最小更新" で決定。
- データ範囲は以下とする
  - `project_id`　/* 更新の場合はinputと同一の値を返すが、ない場合は初番 */
  - `record_id`　/* 更新の場合はinputと同一の値を返すが、ない場合は初番 */
  - `current_step`　/* Step01_Rights_Validation と返す */
  - `approval_status`　/* PENDING を固定して返す */
  - `created_at`　/* 初回のトリガー日のみを返す、よって更新の場合はinputと同一の値を返す */
  - `updated_at`　/* 実行完了の日付で上書き */
  - `updated_by`　/* Github　として宣言 */

### 9.2 比較案

#### 案 A-1: 最小更新
更新対象を最低限に絞る。
- 例:
  - `generation_status`
  - `updated_at`
  - `updated_by`
  - `notes`

**メリット**
- 他ステップや人手運用との衝突が少ない
- 初期実装が簡単
- 誤更新リスクが低い

**デメリット**
- 案件の進行状態が `00_Project` だけでは見えにくい
- `go_next` やレビュー要否を親シートで即確認しづらい

---

#### 案 A-2: 状態更新をやや広げる
STEP_01 の案件進行に必要な列まで更新する。
- 例:
  - `generation_status`
  - `approval_status`
  - `go_next`
  - `updated_at`
  - `updated_by`
  - `notes`

**メリット**
- `00_Project` を案件ダッシュボードとして見やすい
- 次工程に進めるかを親シートでも把握しやすい
- 実務運用と相性が良い

**デメリット**
- `approval_status` など人手運用列と役割競合する可能性がある
- 更新ルールの明文化が必要

---

#### 案 A-3: 広めに更新
STEP_01 結果の要約も `00_Project` に反映する。
- 例:
  - `generation_status`
  - `approval_status`
  - `go_next`
  - `rights_status`
  - `risk_level`
  - `review_required`
  - `updated_at`
  - `updated_by`
  - `notes`

**メリット**
- `00_Project` だけでも案件状況がかなり分かる
- 一覧管理がしやすい

**デメリット**
- `00_Rights_Validation` と責務が重複しやすい
- 同一情報の二重管理になる
- 将来の同期ズレリスクが高い

### 9.3 推奨案
**推奨: 案 A-2**

#### 推奨理由
- 初期実装として十分実務的
- `00_Project` を案件管理の親シートとして使いやすい
- `00_Rights_Validation` の主責務は維持しつつ、最低限の進行状態を親側に出せる

### 9.4 v0.1 推奨更新列
- `generation_status`
- `approval_status`
- `go_next`
- `updated_at`
- `updated_by`
- `notes`

### 9.5 補足
- `rights_status`, `risk_level`, `review_required` は主として `00_Rights_Validation` に保持する
- `00_Project` には必要最小限の進行管理情報のみを反映する

---

## 10. 00_Rights_Validation upsert 方針（論点 B）

### 10.1 論点
`00_Rights_Validation` に対して、再実行時に上書きするか、追記するか、履歴化するかを決める必要がある。


### 10. 00_Rights_Validation upsert 方針（論点 B）の決定案

#### 論点Bの決定案
- "案 B-1: 1 project = 1 row の上書き" で決定。

### 10.2 比較案

#### 案 B-1: 1 project = 1 row の上書き
`project_id` を実質キーとして、既存行があれば更新、なければ新規作成する。

**メリット**
- 実装が簡単
- GSS が見やすい
- 初期運用に向く

**デメリット**
- 実行履歴が残りにくい
- 再実行差分の追跡が弱い

---

#### 案 B-2: 実行ごとに append
毎回新規 row を追加する。

**メリット**
- 実行履歴が自然に残る
- デバッグしやすい

**デメリット**
- 同一案件の重複行が増える
- 現在の最新値が分かりにくい
- シート運用が煩雑になりやすい

---

#### 案 B-3: project 固定 + version 管理
`project_id` に加え version / run_id を持ち、最新版フラグ管理を行う。

**メリット**
- 履歴も最新値も管理しやすい
- 将来拡張に強い

**デメリット**
- 初期実装としては複雑
- version 設計や最新判定が必要

### 10.3 推奨案
**推奨: 案 B-1**

### 10.4 推奨理由
- STEP_01 の動作検証段階では最もシンプル
- GSS 運用負荷が低い
- 権利確認の初期実装として十分

### 10.5 v0.1 推奨 upsert ルール
- キー: `project_id`
- 既存 row がある場合: update
- 無い場合: insert
- `record_id` は初回作成時に発番し、再実行時は既存値を維持する

### 10.6 record_id の方針
- 初回 insert 時に GitHub が生成する
- 再実行時は同じ `record_id` を保持する
- v0.1 では履歴分岐は持たない

---

## 11. GAS → GitHub payload 方針（論点 C）

### 11.1 論点
GAS から GitHub Actions に渡す payload は、最小構成にするか、将来拡張を見込んで少し広めに持つかを決める必要がある。

### 11. GAS → GitHub payload 方針（論点 C）の決定案

#### 論点Cの決定案
- "案 C-2: 小さめの拡張 payload" を方針としたいが、input=payloadの認識であるが、C-2案では`00_Project`の引き渡し情報が不足しすぎGeminiが適切に処理できないのではないか？
- それともAPIをCallしたのうち必要情報をGithub側がReadしにくる想定か？

### 11.2 比較案

#### 案 C-1: 最小 payload
- `project_id` のみ渡す

例:
```json
{
  "project_id": "PJT-001"
}

** メリット **
- 実装が最も簡単
- ミスが少ない
- 初期検証向き

** デメリット **

- 2件実行や dry-run などに弱い
- 将来拡張時に payload 変更が必要

#### 案 C-2: 小さめの拡張 payload
- `project_ids`
- `max_items`
- `dry_run`
を持つ
例:
```json{
  "project_ids": ["PJT-001"],
  "max_items": 1,
  "dry_run": false
}

**メリット **
- 1件/2件切替に対応しやすい
- 動作検証から本実装への移行が楽
- 後方互換を保ちやすい

**デメリット**
- 最小構成より少し複雑


#### 案 C-3: 詳細 payload
- `project_ids`
-`step_id`
- `spreadsheet_id`
- `input_sheet`
- `output_sheet`
- `dry_run`
- `force`
などを持つ

**メリット**
- 汎用性が高い
- 将来のマルチステップ化に強い
- デメリット

v0.1 には過剰
設定責任が増える
GAS 側負荷が高い
11.3 推奨案
推奨: 案 C-2

11.4 推奨理由
初期検証と将来拡張のバランスが良い
1件運用にも 2件運用にも対応しやすい
dry-run を持たせやすい
11.5 v0.1 推奨 payload
Copy{
  "project_ids": ["PJT-001"],
  "max_items": 1,
  "dry_run": false
}
11.6 解釈ルール
project_ids が指定されている場合はその案件を優先処理する
max_items は上限件数とする
dry_run=true の場合は AI 実行や書き戻しを抑制または限定実行できる余地を残す
12. 初期実装の推奨まとめ
12.1 v0.1 推奨仕様
起動: GAS → GitHub Actions (workflow_dispatch)
入力: 00_Project
対象件数: 1 件または 2 件
主キー: project_id
主出力: 00_Rights_Validation
補助出力: 00_Project
Gemini API / model: 94_Runtime_Config から取得
fast-pass: 有効
fast-pass 参照元: config/fast_pass_logic_v1.md
00_Project 更新方針: 案 A-2
00_Rights_Validation upsert 方針: 案 B-1
GAS payload 方針: 案 C-2
13. Kashi に確認・記入してほしいこと
以下だけ決めれば、v0.1 実装に入りやすい。

13.1 確認事項
 00_Project の更新列は、推奨案 A-2 でよいか
 00_Rights_Validation の upsert は、推奨案 B-1 でよいか
 GAS payload は、推奨案 C-2 でよいか
 00_Rights_Validation の実シート名表記はこれで正しいか
 94_Runtime_Config にある API key 名 / model 名の field 名は何か
13.2 記入してほしい最小情報
Copy## STEP_01 確定メモ
- 00_Project 更新列:
- 00_Rights_Validation upsert 方式:
- GAS payload:
- Runtime Config の API key field 名:
- Runtime Config の model field 名:
- 実シート名（Rights Validation）:
14. 今後の拡張候補
00_Rights_Validation の履歴管理導入
fast-pass 対象ドメイン追加
93_IO_Mapping と完全同期した動的入出力
dry-run の正式実装
GitHub Secrets fallback 導入
batch 実行の高度化
失敗時の再試行戦略追加

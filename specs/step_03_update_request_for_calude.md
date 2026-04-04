# Claude向け修正指示書（STEP_03 Scene Build 関連 / 改訂版）

## 1. この文書の目的
本書は、Claude が作成した以下の成果物に対して、これまでの協議内容およびオーナー判断済みの論点を反映した修正指示を与えるための文書である。

対象ファイル:
- `step03_implementation_spec_v0.2.md`
- `scene_build_prompt_v1.md`
- `scene_build_schema_ai_v1.json`
- `scene_count_and_duration_policy_v1.md`

追加で正本として扱うファイル:
- `step03_implementation_ai_requirement.md`

本指示の方針は以下の通り。
- Claude 側の構成・粒度・運用上優れている点は活かす
- 一方で、これまでの合意内容と不整合がある箇所は修正する
- すでにオーナー判断が済んだ論点は確定仕様として反映する
- なお、未解決論点が残る場合のみ、選択肢を整理して確認を求める
- 最終的に、Claude がそのままプログラム設計へ落とし込めるレベルの、矛盾の少ない STEP_03 関連仕様に揃える

---

## 2. まず Claude に伝えるべき前提
以下を修正前提として必ず理解したうえで反映してください。

### 2.1 STEP_03 の役割
- STEP_03 は `02_Scenes` を生成する工程である
- `02_Scenes` は後工程の基準となる **scene master** である
- 後工程とは主に以下を指す
  - `STEP_04_05_COMBINED` Short + Full Script Build
  - `STEP_06` Visual Bible
  - `STEP_07` Image Prompts
  - `STEP_08` Audio / Subtitle / Edit Plan
  - `STEP_09` Q&A Build
- よって STEP_03 の scene 定義は、単なる要約ではなく、後工程が再利用できる構造化データである必要がある

### 2.2 STEP_03 は target_age と動画尺を前提に scene 設計する
- STEP_03 は `target_age` と `full_target_sec` を前提に scene を設計する
- 年齢帯は以下の 3 区分
  - `2-3`
  - `4-6`
  - `6-8`
- 各年齢帯の 1 scene 最大秒数は `94_Runtime_Config` の以下 key を参照する
  - `scene_max_sec_2-3 = 15`
  - `scene_max_sec_4-6 = 25`
  - `scene_max_sec_6-8 = 40`
- `required_scene_count_base` は原則として以下で算出する
  - `ceil(full_target_sec / scene_max_sec)`
- ただし最終的な scene 数は、上記基準値の **±15% 程度を許容範囲** とし、その範囲内で物語構造・導入の短さ・感情展開・理解負荷を考慮して AI が調整してよい
- つまり、scene 数は「完全固定値」ではなく、「尺から算出した基準値に対し、一定範囲内で柔軟に調整する」仕様とする

### 2.3 STEP_04/05 との同期性は必須
- `STEP_04_05_COMBINED` は、STEP_03 の scene master に同期して Short / Full script を生成する
- 初期実装では、Short / Full ともに **scene の分割・統合・並び替えは禁止**
- 同一の `scene_id` / `scene_order` セットを前提とする
- Short / Full の差は、scene 構造ではなく、各 scene の採否・密度・尺・記述量で調整する
- GitHub 側では後段バリデーションとして以下を検証する
  - scene count の一致
  - `scene_id` 集合の整合
  - `scene_order` の整合
  - 重複の有無

### 2.4 Short / Full 時間運用の考え方
- STEP_03 では `est_duration_short` は rough estimate とする
- STEP_03 における `est_duration_short` は、Short 版の scene 採否と大まかな時間感を示すための目安値である
- 最終的な Short script の尺調整は、物語としての一貫性、子どもが楽しむための強調・脚色を行う `STEP_04_05_COMBINED` で行う
- `short_target_sec` および `full_target_sec` は重要な入力だが、機械的に厳守することよりも、物語としての品質を優先する
- ただし無制限な超過は許容せず、STEP_04_05_COMBINED においてもユーザー指定秒数に対して **最大 +15% まで** を許容上限とする

---

## 3. Claude成果物のうち活かしたい方針
以下は Claude 側で優れている可能性があるため、原則として活かしてください。

- STEP_03 専用 prompt / schema / spec / policy を分けている構成
- scene 出力を構造化 JSON にしている方針
- 実装仕様と AI requirement を別レイヤで持つ考え方
- duration policy を別ファイルに切り出している点
- Scene Build を独立した設計単位として扱っている点

ただし、これらは「構成として活かす」ものであり、内容そのものは本指示書の合意内容に合わせて修正してください。

---

## 4. オーナー判断済み事項（確定）
以下は、すでにオーナー判断が済んでいるため、Claude 側で再提案せず確定仕様として反映してください。

### 4.1 論点1: scene 数の最終決定ロジック
採用案:
- 案 A

確定内容:
- `required_scene_count_base = ceil(full_target_sec / scene_max_sec)` を scene 数設計の基準とする
- 最終的な scene 数は、その基準値から **±15% 程度を許容** する
- その範囲内で、物語構造・導入の短さ・感情展開・理解負荷を考慮して AI が scene 数を調整してよい

### 4.2 論点2: `full_use` の扱い
採用案:
- 案 A

確定内容:
- 初期実装では Full 用 scene master であるため、原則として `full_use = Y` を前提とする
- ただし schema 上は `Y/N` を保持する
- また運用上、制作指示が Short 版中心で来る可能性があるため、`short_use` を軸にした分岐運用を許容する
- そのため `full_use` は将来拡張や例外運用に備えたフィールドとして残す

### 4.3 論点3: `scene_id`, `scene_order` の付与責務
採用案:
- 案 B

確定内容:
- `scene_id`, `scene_order` は AI が自由生成するのではなく、GitHub / システム側で正規付与する
- これにより、後工程との同期性・安定性・再実行時の整合性を担保する
- AI 出力は scene 内容に集中し、識別子の責務はシステムに持たせる

### 4.4 論点4: Short 240 秒の内訳調整方法
採用案:
- 案 A をベースとしつつ、STEP_04_05_COMBINED 側で最終調整する

確定内容:
- STEP_03 では `short_use = Y` の scene 群と rough な `est_duration_short` を出す
- STEP_03 の `est_duration_short` はあくまで目安であり、最終的な script 秒数は STEP_04_05_COMBINED で調整する
- `short_target_sec` / `full_target_sec` は参考基準として強く意識するが、物語の質を優先する
- ただし STEP_04_05_COMBINED においても、指定秒数に対する超過許容は **最大 +15%** とする

---

## 5. 必須修正事項
以下は、今回の協議を踏まえて必ず反映してください。

### 5.1 STEP_03 の出力は scene master であることを明文化する
以下の趣旨を spec / requirement / prompt に明記してください。

- `02_Scenes` は後工程の基準データである
- STEP_03 は後工程を想定して、再利用しやすい scene 定義を行う
- 各 scene は script / visual / QA / edit planning で再利用される
- scene の粒度は、映像化しやすく、脚本化しやすく、QA 化しやすい単位にする

### 5.2 年齢帯別 scene 最大秒数を固定反映する
以下の値を policy / prompt / spec に反映してください。

- `scene_max_sec_2-3 = 15`
- `scene_max_sec_4-6 = 25`
- `scene_max_sec_6-8 = 40`

また、`target_age` から対応 key を引く前提を明記してください。

### 5.3 scene 数の考え方を「基準値 + 許容幅」にする
以下を反映してください。

- `required_scene_count_base = ceil(full_target_sec / scene_max_sec)` を基準とする
- 最終的な scene 数はその基準値の ±15% 程度を許容する
- AI はその範囲内で物語構造、導入の短さ、理解負荷、感情変化の自然さを考慮して調整してよい
- ただし出力結果は duration policy と age band guideline を満たす必要がある

### 5.4 02_Scenes の主要フィールド定義を修正する
以下の項目について、AI に求める役割・定義補足・例示・他 STEP での用途が明確になるように、spec または requirement に反映してください。

対象フィールド:
- `chapter`
- `scene_title`
- `scene_summary`
- `scene_goal`
- `visual_focus`
- `emotion`
- `short_use`
- `full_use`
- `est_duration_short`
- `est_duration_full`
- `difficult_words`
- `easy_rewrite`
- `qa_seed`
- `continuity_note`

特に以下は厳守してください。
- `short_use` は `Y/N` のみ
- `full_use` は `Y/N` のみ
- 説明文や自由記述を入れない
- `full_use` は原則 Y 前提だが、schema 上は Y/N を保持する
- `short_use` は Short 版で採用する scene の厳選用フラグ
- `est_duration_short` は rough estimate であることを明記する

### 5.5 Short / Full の扱いを 480秒 / 240秒前提に合わせる
以下を prompt / sample / spec に反映してください。

- サンプルデータは「桃太郎」をベースにする
- Full 版は約 480 秒想定
- Short 版は約 240 秒想定
- `02_Scenes` は Full 版基準で scene master を構成する
- その上で `short_use = Y` の scene を厳選し、Short 版で利用する
- Full 版の scene master を壊さず、Short 版は採用フラグで圧縮する

### 5.6 STEP_04_05_COMBINED との同期ルールを明文化する
以下の趣旨を spec / requirement / prompt に反映してください。

- STEP_04_05_COMBINED は STEP_03 の `02_Scenes` を scene master として参照する
- 初期実装では scene の増減・分割・統合・並び替えは禁止
- 各 script row は少なくとも `project_id`, `scene_id`, `scene_order` を保持する
- Short / Full の違いは scene 構造ではなく、採用可否・記述密度・尺配分で調整する

### 5.7 target_sec の扱いを品質優先 + 上限超過許容に修正する
以下を spec / requirement / prompt に反映してください。

- `short_target_sec` / `full_target_sec` は重要入力である
- ただし、機械的な厳守を最優先にはしない
- 子どもが楽しめること、物語として自然であること、一貫性があることを優先する
- 一方で、運用可能性のために上限超過は制御する
- STEP_04_05_COMBINED では、ユーザー指定秒数に対して **最大 +15% まで** を許容する

---

## 6. ファイル別の修正指示

### 6.1 `step03_implementation_spec_v0.2.md`
以下を重点修正してください。

#### 必須反映
- STEP_03 の責務を「Scene Build」ではなく「後工程を支える scene master 生成」として明確化
- 入力として `target_age`, `full_target_sec`, `short_target_sec` を明記
- 年齢帯別 `scene_max_sec` の runtime config 参照ルールを明記
- `required_scene_count_base` と ±15% 許容の考え方を追記
- `STEP_04_05_COMBINED` との同期ルールを追記
- `short_use` / `full_use` を Y/N に固定
- `est_duration_short` は rough estimate と明記
- `target_sec` は品質優先だが +15% まで許容と明記
- `02_Scenes` の各主要フィールド定義を補足する
- Full 基準 480 秒 / Short 基準 240 秒のサンプル前提を記載する

#### 活かしてよい点
- 章立てやシーン生成の構成
- 実装フェーズの切り方
- schema / prompt / validation 前提の分離

---

### 6.2 `scene_build_prompt_v1.md`
以下を重点修正してください。

#### 必須反映
- STEP_03 の出力は後工程の正本となる scene master であると指示する
- 入力条件として `target_age`, `full_target_sec`, `short_target_sec` を必須扱いにする
- 年齢帯別 `scene_max_sec` を守るよう指示する
- scene 数は `ceil(full_target_sec / scene_max_sec)` を基準にしつつ、±15% 程度の範囲で物語に応じて調整してよいと指示する
- `short_use`, `full_use` は必ず `Y` または `N` のみ出力するよう強制する
- `full_use` は原則 Y 前提だが、schema 準拠のため Y/N 出力とする
- scene は後工程で同期利用されるため、scene の分割・統合・並べ替え前提の設計にしない
- `qa_seed` や `continuity_note` が後工程利用されることを意識させる
- `est_duration_short` は rough estimate であり、最終調整は STEP_04_05_COMBINED で行うことを示す
- `target_sec` は目標値だが、物語品質を優先し、最終的に +15% まで許容される運用思想に合わせる
- Full 480 秒、Short 240 秒前提の桃太郎サンプルに整合するよう調整する

#### 活かしてよい点
- Claude がすでに持っている narrative guidance
- JSON 厳守の出力指示
- age-aware narrative の書き分け

---

### 6.3 `scene_build_schema_ai_v1.json`
以下を重点修正してください。

#### 必須反映
- `short_use` を enum `["Y", "N"]`
- `full_use` を enum `["Y", "N"]`
- 数値項目は数値として定義
  - `est_duration_short`
  - `est_duration_full`
- 必須項目の見直し
  - `chapter`
  - `scene_title`
  - `scene_summary`
  - `scene_goal`
  - `visual_focus`
  - `emotion`
  - `short_use`
  - `full_use`
  - `est_duration_short`
  - `est_duration_full`
  - `difficult_words`
  - `easy_rewrite`
  - `qa_seed`
  - `continuity_note`
- 可能であれば description に後工程用途を追記する
- `scene_id`, `scene_order` は AI 出力ではなく、システム側付与前提で schema 記述を整理する
- 必要に応じて、後段付与フィールドとして注記だけ残してよい

#### 活かしてよい点
- 既存 schema の overall structure
- scenes 配列ベースの設計
- バリデーション可能な JSON schema 化

---

### 6.4 `scene_count_and_duration_policy_v1.md`
以下を重点修正してください。

#### 必須反映
- 年齢帯別の `scene_max_sec` を以下で明記
  - `2-3` → 15
  - `4-6` → 25
  - `6-8` → 40
- key 名を明記
  - `scene_max_sec_2-3`
  - `scene_max_sec_4-6`
  - `scene_max_sec_6-8`
- `required_scene_count_base = ceil(full_target_sec / scene_max_sec)` を明記
- 許容範囲として ±15% を明記
- これは scene 数の固定値ではなく、基準値であることを明記
- AI は物語構造に応じて適切に scene を設計してよいが、基準値から大きく外れないこと
- 年齢帯ガイドラインを反映し、理解負荷・説明密度・場面転換負荷への配慮を追記する

#### 活かしてよい点
- policy ファイルとして独立している構成
- duration と scene count をまとめている方針

---

### 6.5 `step03_implementation_ai_requirement.md`
このファイルは今回の協議で最も重要な正本の一つです。Claude に渡した際に混乱しないよう、用語ズレや表記の揺れを是正してください。

#### 用語・表記の統一方針
以下のように統一してください。

- `STEP_04/05` と `STEP_04_05_COMBINED` を混在させない
  - 正: `STEP_04_05_COMBINED`
- `Scene Build` と `scene master 生成` が競合する場合
  - 正: `Scene Build（後工程を支える scene master 生成）`
- `required_scene_count` と `required_scene_count_base` が混在する場合
  - 正: `required_scene_count_base`
- `目標秒数` と `厳守秒数` が混在する場合
  - 正: `target_sec は品質優先の目標値であり、最大 +15% を許容する`
- `scene_id` / `scene_order` の責務が曖昧な場合
  - 正: `システム側で付与`
- `short_use` / `full_use`
  - 正: `Y/N フラグ`
- `est_duration_short`
  - 正: `rough estimate`
- `Full版` / `Full`
  - 文書内でどちらかに寄せる。推奨は `Full版`
- `Short版` / `Short`
  - 文書内でどちらかに寄せる。推奨は `Short版`

#### 必須記載
- STEP_03 は scene master を生成する
- target_age と full_target_sec / short_target_sec を前提とする
- scene_max_sec は runtime config 参照
- scene 数は `required_scene_count_base` を基準に ±15% を許容して決める
- STEP_04_05_COMBINED は STEP_03 に同期する
- short_use / full_use は Y/N
- Full版 480 秒 / Short版 240 秒の運用サンプル
- 後工程用途を意識したフィールド定義
- target_sec は品質優先の目標値であり、最大 +15% 超過まで許容する
- scene_id / scene_order はシステム側で付与する

---

## 7. 追加の実装判断ルール
以下は、Claude が設計時に迷いやすいため、補足ルールとして明記してください。

### 7.1 scene 数の丸め
- `required_scene_count_base` から ±15% の範囲を scene 数候補レンジとする
- scene 数は整数で扱う
- 小数処理時は、実装側で安全な整数丸めルールを採用してよい
- ただし、丸めによってレンジから不自然に外れないようにする

### 7.2 Short版の採用戦略
- `short_use = Y` は、Short版で採用すべき主要 scene を示す
- 単に時間を削るためだけではなく、物語の理解・感情曲線・満足感を保てるよう厳選する
- そのため、説明重複 scene や補助的 scene は `N` にしてよい
- ただし、導入・転換点・山場・結びの欠落で物語が崩れないようにする

### 7.3 Full版の基本方針
- 初期実装では、Full版の scene master を主系統とする
- そのため、原則 `full_use = Y`
- ただし schema 上は Y/N を保持し、将来の例外運用に備える

---

## 8. Claude への依頼方法
Claude には、以下の進め方で修正を依頼してください。

### 依頼手順
1. まず既存 4 ファイルを読み、現行構成のうち活かせる点を整理する
2. 次に `step03_implementation_ai_requirement.md` を正本要求として扱う
3. 本指示書に記載した確定事項を優先して反映する
4. 4 ファイルとの差分を洗い出す
5. 必須修正事項を反映した改訂版を作成する
6. 未解決論点がある場合のみ、勝手に決めず選択肢つきで確認を返す
7. 最後に、修正版ファイル一覧と修正要約を出す

---

## 9. Claude にそのまま渡せる依頼文
以下を Claude に渡してください。

### Claude への依頼文
以下の STEP_03 関連ファイルについて、既存の良い構成は活かしつつ、別紙の合意事項に沿って修正してください。

対象:
- `step03_implementation_spec_v0.2.md`
- `scene_build_prompt_v1.md`
- `scene_build_schema_ai_v1.json`
- `scene_count_and_duration_policy_v1.md`

正本要求:
- `step03_implementation_ai_requirement.md`

修正方針:
- STEP_03 は後工程の基準となる scene master を生成する工程として再定義してください
- `target_age`, `full_target_sec`, `short_target_sec` を前提に scene 設計を行うよう統一してください
- 年齢帯別 scene 最大秒数は runtime config の以下 key / value を使ってください
  - `scene_max_sec_2-3 = 15`
  - `scene_max_sec_4-6 = 25`
  - `scene_max_sec_6-8 = 40`
- `required_scene_count_base = ceil(full_target_sec / scene_max_sec)` を scene 数設計の基準としてください
- 最終的な scene 数は、上記基準値の ±15% 程度を許容範囲として調整してください
- STEP_04_05_COMBINED は STEP_03 と同期する前提とし、初期実装では scene の分割・統合・並び替えは禁止としてください
- `short_use` と `full_use` は `Y/N` のみ受け入れる仕様に修正してください
- `full_use` は原則 Y 前提ですが、schema 上は Y/N を保持してください
- `02_Scenes` の主要フィールドについて、定義補足・例示・後工程用途が分かるようにしてください
- 桃太郎をサンプルに、Full版 480 秒 / Short版 240 秒前提に整合する例を用意してください
- `est_duration_short` は rough estimate とし、最終調整は STEP_04_05_COMBINED で行う前提にしてください
- `short_target_sec` / `full_target_sec` は重要な目標値ですが、厳密一致より物語品質を優先してください
- ただし最終 script は、ユーザー指定秒数に対し最大 +15% までを許容上限としてください
- `scene_id`, `scene_order` は AI ではなくシステム側で付与する前提にしてください
- 既存案と相反する点や、未解決論点が残る場合のみ、勝手に決めず「論点」「選択肢」「推奨案」を明示して確認を求めてください

期待する返答:
1. 現行ファイルのうち活かす点
2. 修正が必要な点
3. 未解決論点がある場合の論点一覧
4. 修正版ドラフト一式

---

## 10. 補足アドバイス
今回の修正の核心は以下です。

- STEP_03 を「シーン要約生成」ではなく「後工程が依存する scene master 生成」に格上げすること
- age / duration / downstream sync の 3 点を仕様の中心に置くこと
- `short_use` / `full_use` のような運用フラグは自由記述にせず、厳格に型制約すること
- `target_sec` は重要だが、厳密一致より物語品質を優先すること
- ただし運用崩壊を防ぐため、+15% の許容上限を明記すること
- Claude の構成力は活かしつつ、用語ズレを減らして誤実装を防ぐこと

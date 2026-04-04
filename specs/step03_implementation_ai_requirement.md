# step03_implementation_ai_requirement.md 改訂案

## 1. 目的
本書は STEP_03 Scene Build の AI 要求定義である。  
STEP_03 は単なる scene 要約生成ではなく、後工程を支える `02_Scenes` の scene master を生成する工程として扱う。

本書は以下の目的で利用する。
- prompt 設計時の上位要求
- schema 設計時の判断基準
- implementation spec の解釈ぶれ防止
- STEP_04_05_COMBINED 以降との同期性担保

---

## 2. STEP_03 の位置づけ
- STEP_03 は `02_Scenes` を生成する
- `02_Scenes` は後工程の基準データである
- 後工程は以下を含む
  - `STEP_04_05_COMBINED`
  - `STEP_06`
  - `STEP_07`
  - `STEP_08`
  - `STEP_09`
- よって、STEP_03 の出力は、後工程で再利用しやすい structured scene master でなければならない

---

## 3. 入力前提
STEP_03 は少なくとも以下を前提入力として扱う。

- `target_age`
- `full_target_sec`
- `short_target_sec`
- source/story context（元となる物語情報）
- 必要に応じた style / tone / policy 情報

### 3.1 年齢帯
`target_age` は以下のいずれかとする。
- `2-3`
- `4-6`
- `6-8`

### 3.2 Runtime Config 参照
年齢帯ごとの 1 scene 最大秒数は `94_Runtime_Config` の以下 key を参照する。

- `scene_max_sec_2-3 = 15`
- `scene_max_sec_4-6 = 25`
- `scene_max_sec_6-8 = 40`

---

## 4. scene 数の設計原則

### 4.1 基準値
scene 数の基準値は以下で算出する。

- `required_scene_count_base = ceil(full_target_sec / scene_max_sec)`

ここでの `scene_max_sec` は `target_age` に対応する runtime config 値を用いる。

### 4.2 許容幅
最終的な scene 数は、`required_scene_count_base` の ±15% 程度を許容範囲とする。

### 4.3 設計思想
scene 数は固定除算で機械的に決めるのではなく、以下も加味して決定する。
- 物語構造
- 導入の短さ
- 感情変化の自然さ
- 年齢帯に対する理解負荷
- 後工程での再利用しやすさ

---

## 5. STEP_03 の責務
STEP_03 の責務は以下である。

- 後工程の正本となる scene master を生成する
- 年齢帯と尺に応じた scene 粒度を定義する
- Short版 / Full版 の両方に再利用できる構造をつくる
- Visual / Script / QA / Edit Plan に流用可能な scene 情報を用意する
- 後工程と同期可能な scene 構造を維持する

---

## 6. STEP_04_05_COMBINED との同期原則
- `STEP_04_05_COMBINED` は STEP_03 の scene master を参照する
- 初期実装では scene の分割・統合・並び替えは禁止する
- Short版 / Full版 の違いは、scene 構造ではなく、採否・密度・尺・描写量で調整する
- 各 script row は少なくとも `project_id`, `scene_id`, `scene_order` を保持する
- `scene_id`, `scene_order` は AI が自由生成せず、システム側で付与する

---

## 7. target_sec の扱い
- `full_target_sec` および `short_target_sec` は重要な目標値である
- ただし、厳密一致を最優先しない
- 子どもが楽しめること、物語として自然であること、一貫性があることを優先する
- 一方で、運用崩れを防ぐため、最終 script の秒数超過は制限する
- `STEP_04_05_COMBINED` では、ユーザー指定秒数に対し最大 +15% までを許容上限とする

---

## 8. 02_Scenes の主要フィールド要件
STEP_03 の AI 出力は、少なくとも以下のフィールドを含むことを前提とする。

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

### 8.1 フィールド一覧サマリ
| field | 定義 | 出力形式 | 後工程での主用途 |
|---|---|---|---|
| `chapter` | 物語上の章・大区分 | 短いテキスト | 構成把握、Script/Visual の章整理 |
| `scene_title` | scene を一目で識別できる短い名称 | 短いテキスト | 人レビュー、Script 見出し、Visual 管理 |
| `scene_summary` | scene 内で何が起こるかの要約 | 1〜3文程度 | Script 化、内容把握、QA 文脈 |
| `scene_goal` | その scene が物語上果たす役割 | 1文程度 | 構成妥当性、脚色方針、QC |
| `visual_focus` | 映像上、何を主に見せるか | 具体的な名詞句/短文 | STEP_06, STEP_07 |
| `emotion` | scene の主感情・感情トーン | 短いテキスト | Script トーン、演出、音・色調整 |
| `short_use` | Short版で採用するか | `Y` / `N` | STEP_04_05_COMBINED の Short版分岐 |
| `full_use` | Full版で採用するか | `Y` / `N` | STEP_04_05_COMBINED の Full版分岐 |
| `est_duration_short` | Short版での概算秒数 | 数値 | Short版尺設計の rough guide |
| `est_duration_full` | Full版での概算秒数 | 数値 | Full版尺設計の rough guide |
| `difficult_words` | 対象年齢に難しい語彙 | 配列または区切り文字列 | 語彙平易化、字幕最適化 |
| `easy_rewrite` | 難語の言い換え候補 | 配列または区切り文字列 | STEP_04_05_COMBINED のやさしい表現化 |
| `qa_seed` | QA生成の種になる問い・観点 | 短い問い/論点 | STEP_09 |
| `continuity_note` | 前後 scene との接続メモ | 短文 | Script / Visual / Edit continuity |

### 8.2 AIに求める役割
AI には、各フィールドに対して以下の役割を求める。

- `chapter`
  - 物語全体の大きな流れが把握できるように scene を章レベルで整理する
- `scene_title`
  - 人と他AIが同じ scene をすぐ識別できる名前を付ける
- `scene_summary`
  - scene の内容を、後工程が script 化しやすい粒度で要約する
- `scene_goal`
  - その scene が必要な理由を物語機能として明示する
- `visual_focus`
  - 映像化時に何を中心に描くべきかを具体化する
- `emotion`
  - 子ども向け演出に必要な感情トーンを一貫して定義する
- `short_use`
  - Short版でも残すべき主要 scene かを判断する
- `full_use`
  - Full版で採用する scene かを示す
- `est_duration_short`
  - Short版の rough な尺感を示す
- `est_duration_full`
  - Full版の rough な尺感を示す
- `difficult_words`
  - 対象年齢に対して難しい語を抽出し、全角「、」区切りで列挙する（難語がない場合は空文字）
- `easy_rewrite`
  - `difficult_words` の各語に対応する言い換えを全角「、」区切り・順序対応で列挙する（`difficult_words` が空文字の場合は空文字）
- `qa_seed`
  - QA や理解確認に使える問いの種を置く
- `continuity_note`
  - 次工程で scene 間のつながりを壊さないための注意点を残す

### 8.3 フィールド要件
- `short_use` は厳密に `"Y"` または `"N"` のみ（他の値・説明文不可）
- `full_use` は厳密に `"Y"` または `"N"` のみ（初期実装では原則 `"Y"`）
- `est_duration_short` は rough estimate の整数。`short_use = N` の場合は必ず `0` を設定する
- `est_duration_full` は Full版 scene の rough estimate 秒数（整数・`scene_max_sec` 以内）。全 scene の合計が `full_target_sec` の ±15% 以内を目安とし、最終調整は STEP_04_05_COMBINED で行う
- `difficult_words` と `easy_rewrite` は全角「、」区切りの文字列型（配列型は不可）
  - `difficult_words` に複数語がある場合は全角「、」で区切って列挙する（例: `「どんぶらこ、家来、退治」`）
  - `easy_rewrite` は `difficult_words` の順序と対応させる（例: `「ぷかぷか流れてくる、なかま、やっつける」`）
  - 難語がない場合は両方とも空文字
- `qa_seed` は STEP_09 で再利用できる問いの種
- `continuity_note` は前後 scene の接続や持ち物・感情・構図の連続性を支える

---

## 9. Short版 / Full版 の基本設計
- `02_Scenes` は Full版基準の scene master として構成する
- Full版の想定サンプルは約 480 秒とする
- Short版の想定サンプルは約 240 秒とする
- Short版は `short_use = Y` の scene を厳選して構成する
- Short版の時間配分は STEP_03 で rough に見積もる
- 最終的な Short版 script の尺調整は `STEP_04_05_COMBINED` で行う

---

## 10. Short版採用方針
- `short_use = Y` は Short版で採用すべき主要 scene を示す
- 物語理解・感情曲線・満足感を保てるように厳選する
- 説明重複 scene や補助的 scene は `N` にしてよい
- ただし、導入・転換点・山場・結びの欠落で物語が崩れないようにする

---

## 11. Full版採用方針
- 初期実装では Full版を主系統とする
- そのため原則 `full_use = Y`
- ただし schema 上は Y/N を保持し、将来の例外運用に備える

---

## 12. サンプルデータ表（桃太郎 / Full版 480秒想定ベース）
以下は、桃太郎をベースにした `02_Scenes` のサンプルイメージである。  
Full版を基準に構成し、Short版は `short_use` により厳選する。

| chapter | scene_title | scene_summary | scene_goal | visual_focus | emotion | short_use | full_use | est_duration_short | est_duration_full | difficult_words | easy_rewrite | qa_seed | continuity_note |
|---|---|---|---|---|---|---|---|---:|---:|---|---|---|---|
| 導入 | 大きな桃が川から流れてくる | おばあさんが川で洗濯をしていると、とても大きな桃が流れてくる。 | 物語の始まりを印象づける導入をつくる。 | 川を流れる大きな桃と驚くおばあさん | ふしぎ、わくわく | Y | Y | 18 | 35 | どんぶらこ | ぷかぷか流れてくる | おばあさんは何を見つけたの？ | 桃の大きさと川辺の雰囲気を次 scene に引き継ぐ |
| 導入 | 桃から男の子が生まれる | 家に持ち帰った桃を割ると、中から元気な男の子が現れる。 | 桃太郎誕生という中核設定を示す。 | 桃が割れて男の子が現れる瞬間 | おどろき、よろこび | Y | Y | 20 | 40 | 誕生 | 生まれる | 桃の中から何が出てきたの？ | 桃太郎の衣装・年齢感を固定する |
| 動機形成 | 鬼のうわさを聞く | 村の人たちが鬼に困っている話を聞き、桃太郎は助けたいと思う。 | 主人公の目的を明確にする。 | 困っている村人と決意する桃太郎 | まじめ、やる気 | Y | Y | 18 | 35 | 退治 | やっつける | 桃太郎はなぜ旅に出るの？ | 村の不安な空気を次 scene へつなぐ |
| 出発 | きびだんごを持って旅立つ | おばあさんたちに見送られ、桃太郎はきびだんごを持って旅に出る。 | 冒険の開始を示す。 | きびだんご袋と旅立つ桃太郎 | 前向き、少し緊張 | Y | Y | 18 | 35 | きびだんご | おだんご | 桃太郎は何を持って出かけたの？ | きびだんご袋を以降も持ち続ける |
| 仲間集結 | 犬が仲間になる | 桃太郎は犬にきびだんごを分け、最初の仲間として迎える。 | 仲間集結の開始を示す。 | 桃太郎と犬、きびだんご | 心強い、親しみ | Y | Y | 15 | 35 | 家来 | なかま | 最初の仲間はだれ？ | 犬が以降ずっと同行する |
| 仲間集結 | 猿が仲間になる | 桃太郎は猿にもきびだんごを渡し、旅の仲間にする。 | 仲間を増やし冒険の厚みを出す。 | 木の上の猿と桃太郎 | にぎやか、楽しい | Y | Y | 5 | 35 | 家来 | なかま | 桃太郎はどうやって仲間を増やしたの？ | 猿の性格を軽快に保つ |
| 仲間集結 | きじが仲間になる | 桃太郎はきじとも出会い、空から助けてくれる仲間を得る。 | 仲間集結を完成させる。 | 羽ばたくきじと見上げる桃太郎たち | 頼もしい、わくわく | Y | Y | 5 | 35 | 家来 | なかま | 空を飛べる仲間はだれ？ | 犬・猿・きじの並びを固定する |
| 接近 | 鬼ヶ島へ向かう | 桃太郎たちは力を合わせながら鬼ヶ島へ進んでいく。 | 決戦前の高まりをつくる。 | 海と鬼ヶ島、進む仲間たち | どきどき、勇気 | Y | Y | 15 | 45 | 鬼ヶ島 | 鬼のいるしま | みんなはどこへ向かったの？ | 鬼ヶ島の外観を後続で統一する |
| 対決 | 鬼と向き合う | 鬼ヶ島に着いた桃太郎たちは鬼と向き合い、戦う覚悟を決める。 | クライマックス直前の緊張を高める。 | 鬼たちと向き合う桃太郎一行 | きんちょう、勇気 | Y | Y | 20 | 45 | 覚悟 | がんばる気もち | 桃太郎たちは何と向き合ったの？ | 鬼の人数・見た目を固定する |
| 対決 | 力を合わせて鬼に勝つ | 桃太郎と仲間たちは協力し、鬼を負かして宝物を取り戻す。 | クライマックスを成立させる。 | 協力して戦う桃太郎たち | はらはら、すっきり | Y | Y | 25 | 55 | 宝物 | たいせつなもの | どうして勝てたの？ | 勝利後に宝物を持つ状態へつなぐ |
| 帰還 | 宝物を持って村へ帰る | 桃太郎たちは宝物を持って帰り、村の人たちは安心して喜ぶ。 | 安心感のある結末をつくる。 | 宝物と笑顔の村人たち | ほっとする、うれしい | Y | Y | 20 | 45 | 持ち帰る | もって帰る | みんなは最後どうなったの？ | 明るい結末で締める |
| 結び | みんなで幸せに暮らす | 村は平和になり、桃太郎たちはみんなで仲良く暮らす。 | 余韻と安心感を残して物語を閉じる。 | 平和な村と仲良く過ごす仲間たち | 安心、あたたかい | Y | Y | 10 | 40 | 平和 | しずかで安心 | そのあと村はどうなったの？ | エンディングは穏やかな空気で統一する |

---

## 13. 実装上の注意
- `scene_id`, `scene_order` はシステム側で付与する
- AI には scene 内容の構造化に集中させる
- scene は後工程でそのまま参照されるため、曖昧すぎる summary や過剰に抽象的な field を避ける
- `visual_focus`, `qa_seed`, `continuity_note` は後工程用途を意識して具体性を持たせる
- duration は strict constraint ではなく quality-aware planning 値として扱う

---

## 14. 出力品質の期待
STEP_03 の出力には以下を期待する。

- 年齢帯に応じた理解しやすい scene 粒度
- 物語として自然な展開
- 後工程が再利用しやすい structured scene definition
- Short版 / Full版 への展開可能性
- Visual / QA / Edit / Script に流しやすい具体性
- 尺制約を意識しつつも、品質優先で設計された構成

---

## 15. 用語統一
本ファイルでは以下の表記に統一する。

- `STEP_04_05_COMBINED`
- `scene master`
- `required_scene_count_base`
- `Short版`
- `Full版`
- `target_sec は品質優先の目標値`
- `scene_id`, `scene_order` はシステム側付与
- `short_use`, `full_use` は `"Y"` / `"N"` のみ（厳密な文字列型 Y/N フラグ）
- `est_duration_short` は rough estimate（整数・`short_use = N` のとき 0）
- `difficult_words`, `easy_rewrite` は全角「、」区切りの文字列型（配列型不可）・順序対応必須

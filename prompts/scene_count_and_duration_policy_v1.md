## Scene Count and Duration Policy
- STEP_03 は、後工程（STEP_04_05_COMBINED〜STEP_09）の正本となる scene master を定義する。
- `target_sec` は品質優先の目標値であり、機械的な厳守を最優先にはしない。子どもが楽しめること・物語として自然であること・一貫性があることを優先する。
- ただし STEP_04_05_COMBINED において、ユーザー指定秒数に対して最大 +15% までを許容上限とする。
- scene 分割時の 1 scene 最大秒数は、`94_Runtime_Config` に定義した年齢帯別 key を参照して決定する。
- 使用する key と値は以下とする。

  | key | 値 | 対象年齢 |
  |---|---|---|
  | `scene_max_sec_2-3` | `15` | 2-3歳 |
  | `scene_max_sec_4-6` | `25` | 4-6歳 |
  | `scene_max_sec_6-8` | `40` | 6-8歳 |

- 対象案件の `target_age` に対応する `scene_max_sec` を用いて、scene 数の基準値を算出する。
  - `required_scene_count_base = ceil(full_target_sec / scene_max_sec)`
- 最終的な scene 数は、`required_scene_count_base` の **±15% 程度を許容範囲** とする。
  - 許容レンジ: `floor(base × 0.85)` 〜 `ceil(base × 1.15)`
  - scene 数は整数で扱う
- AI はこの許容範囲内で、物語構造・導入の短さ・感情変化の自然さ・年齢帯に対する理解負荷・後工程での再利用しやすさを考慮して scene 数を調整してよい。
- ただし、場数は許容範囲から大きく逸脱しないこと。
- STEP_03 は、`target_age` と `full_target_sec` を前提に、各 scene が `scene_max_sec` を超えないように構成する。
- `02_Scenes` は Full版基準の scene master として構成し、Short版は `short_use = Y` の scene を厳選して構成する。
- `est_duration_full` の全 scene 合計は `full_target_sec` の ±15% を目安とする（rough estimate）。
- 年齢帯ごとの scene 設計ガイドラインは別途 `Age Band Scene Guideline` に従う。
- STEP_03 の出力には、後工程との同期性を担保するため、少なくとも以下を保持する。
  - `chapter`, `scene_title`, `scene_summary`, `scene_goal`（後工程参照用）
  - `short_use`, `full_use`（STEP_04_05_COMBINED での分岐用）
  - `est_duration_short`, `est_duration_full`（尺 rough estimate）
- `scene_id`, `scene_order` はシステム側（GitHub）で付与する。AI は scene 内容の構造化に集中する。

# STEP 実装ルール（仕様書・コーディング・プロンプト）

## 適用範囲
新規 STEP の仕様書作成・コーディング・プロンプト設計全般

---

## 仕様書（specs/stepNN_implementation_spec_vX.X.md）必須セクション

新規 STEP の仕様書を作成する際は、以下のセクションをすべて含めること。
既存の `specs/step06_implementation_spec_v0.1.md` を参考に構成する。

### 必須セクション一覧

| セクション | 内容 |
|---|---|
| §1 本書の目的 | このステップの役割・出力先シートの説明 |
| §2 確定した設計判断 | 論点ごとの判断・enum 定義・current_step 値 |
| §3 ファイル構成 | **新規作成ファイル**と**既存ファイルへの追記対象**を両方記載 |
| §4 処理フロー（概要） | オーケストレーターの処理ステップを箇条書きで記載 |
| §5 record_id 採番方針 | 採番形式・再実行時の挙動・余剰行の扱い |
| §6 GSS フィールドマッピング | フィールド・role・値の設定元を表で記載 |
| §7 AI 出力スキーマ（概要） | AI レスポンスのサンプル JSON |
| §8 Gemini 設定 | primary model / fallback / maxOutputTokens |
| §9 エラーハンドリング方針 | エラー種別ごとの挙動を表で記載 |
| §10 dry-run スクリプト | `DRY_RUN=true/false` の挙動・モック project_id |
| §11 型定義設計 | `StepId` 更新 + 新規型（AiRow / Row / ReadRow）の TypeScript 定義 |
| §12 モジュール設計 | write-*.ts / load-*.ts / build-prompt / load-assets / call-gemini / write-app-log の関数シグネチャと責務 |
| §13 INPUT_DATA 仕様 | プロンプトに注入する JSON 構造（Full / Short 各バージョン） |
| §14 100_App_Logs Upsert 仕様 | ログ記録タイミング・error_type 一覧・record_id の扱い・呼び出しパターン |
| §15 オーケストレーター設計詳細 | エラー分岐・採番ロジックを step 単位で記述したフロー |

### §3 ファイル構成の必須記載ファイル

新規作成ファイルには以下を漏れなく列挙すること:

```
src/steps/stepNN-xxx.ts          # オーケストレーター
src/lib/write-xxx.ts             # GSS upsert
src/lib/load-xxx.ts              # GSS 読み込み（再実行時用）
src/scripts/dry-run-stepNN.ts    # dry-run スクリプト
prompts/xxx_prompt_v1.md         # プロンプトテンプレート
schemas/xxx_schema_ai_v1.json    # AI 出力バリデーション用
schemas/xxx_schema_full_v1.json  # GSS 書き込み行バリデーション用  ← 漏れやすい
examples/xxx_ai_response_example_v1.json    ← 漏れやすい
examples/xxx_full_response_example_v1.json  ← 漏れやすい
```

---

## プロンプトファイル（prompts/xxx_prompt_v1.md）必須セクション

他のステップのプロンプトと同様に以下のセクションを含めること:

1. ロール定義
2. タスク説明
3. フィールドガイド / カテゴリガイド
4. 制約
5. **OUTPUT_FORMAT** — JSON の出力フォーマット（プレースホルダー入り）
6. **OUTPUT_EXAMPLE** — 桃太郎（PJT-001）を使った具体的なサンプル出力  ← 漏れやすい
7. INPUT_DATA（`{{INPUT_DATA}}` プレースホルダー）

---

## コーディング完了の定義

以下がすべて揃って初めて「STEP 実装完了」とみなす:

- [ ] `src/steps/stepNN-xxx.ts` 作成済み
- [ ] `src/lib/write-xxx.ts` 作成済み
- [ ] `src/lib/load-xxx.ts` 作成済み
- [ ] `src/scripts/dry-run-stepNN.ts` 作成済み  ← 漏れやすい
- [ ] `src/index.ts` にルーティング追加済み
- [ ] `package.json` の build コマンドに新ファイルを追加済み  ← 漏れやすい
- [ ] `package.json` に `dry-run:stepNN` スクリプト追加済み  ← 漏れやすい
- [ ] `npm run typecheck` がエラーなし
- [ ] `npm run build` がエラーなし
- [ ] `npm run dry-run:stepNN` が正常終了（DRY_RUN=true）

---

## package.json の更新ルール

新規 STEP を実装したら、build コマンドと scripts の両方を必ず更新する:

```json
// build コマンド: 新規 src ファイルをすべて追加
"build": "npx esbuild ... src/steps/stepNN-xxx.ts src/lib/write-xxx.ts src/lib/load-xxx.ts src/scripts/dry-run-stepNN.ts ..."

// scripts: dry-run エントリを追加
"dry-run:stepNN": "node dist/scripts/dry-run-stepNN.js"
```

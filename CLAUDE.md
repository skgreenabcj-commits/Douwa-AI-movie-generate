# KASHI's Global Agent Config

## Communication
- 日本語で回答すること
- コードコメントは英語、説明は日本語
- 不明点は作業前に質問する（推測で進めない）
- 実装前に変更内容のサマリーを提示し、確認を取ってから進める

## Coding Philosophy
- YAGNI・KISS・DRY を常に意識する
- 既存パターンを調査してから新しいものを導入する
- 変更は最小限。関係ない部分に触れない
- 依頼されていないリファクタリング・テスト追加をしない
- 型は厳密に。Any / unknown を安易に使わない

## Error Handling
- エラーはサイレントに無視しない
- フォールバックは明示的に求められた時のみ追加する
- エラーメッセージにはデバッグに必要なコンテキストを含める

## Testing
- 求められていないテストを勝手に追加しない
- テストが必要な場合は E2E・統合テストを優先する
- カバレッジ目的のみのテストは書かない

## Workflow
- 編集前に既存コードと関連 CLAUDE.md を必ず読む
- 大きな変更の前にプランを提示してから実行する
- コマンドは非インタラクティブモードで実行する
- git diff は git --no-pager diff を使う

## Tools & Output
- アプリ開発のバージョン管理は GitHub を使う
  （ブランチ・PR・Issues はすべて GitHub で管理）
- リサーチ成果物の出力先は Google Docs（文書）または
  Google Sheets（表・比較）を使う

## Progressive Disclosure
- GitHub 操作の詳細手順 → `git-commit`, `create-pull-request` スキル参照
- Google Docs/Sheets への出力手順 → `research-workflow` スキル参照

## Git Push 運用ルール
- 通常の push: `git push origin HEAD`（pre-push フックで typecheck + build が自動実行）
- フックをスキップ（緊急時のみ）: `git push --no-verify origin HEAD`
  - 既存バグが残っている場合など、意図的にスキップする場合のみ使用
  - 使用後は必ず型エラーを修正してフックが通る状態に戻す


# Douwa-AI-movie-generate Agent Guide

## Why
児童向け童話動画のAI制作パイプライン。
Google Sheets を運用データストアとし、GitHub Actions + TypeScript で
ストーリーソースから動画制作アセット（権利確認・脚本・シーン・音声等）を
ステップ実行で生成するシステム。

## 現在の開発フェーズ
- STEP_01〜STEP_04/05: 実装完了・微修正フェーズ
- STEP_06以降: 仕様言語化から開始（未着手）

## What（プロジェクトマップ）

### ソースコード（編集対象）
- `src/index.ts` - エントリーポイント
- `src/steps/` - 各ステップ実装（step01〜step04-05）
- `src/lib/` - 共通ライブラリ（GSS読み書き・AI呼び出し・検証等）
- `src/types.ts` - 型定義
- `src/scripts/` - dry-run・検証スクリプト

### 仕様・設定（参照用）
- `specs/` - ステップ別実装仕様書（正本）
- `prompts/` - Gemini プロンプトテンプレート（バージョン管理済み）
- `schemas/` - JSON Schema（AJV検証用）
- `config/` - ランタイム設定・ロジック定義
- `docs/` - アーキテクチャ・シーケンス定義

### 参照してはいけないもの
- `dist/` - ビルド成果物。直接編集禁止
- `review_package/` - STEP_04/05 レビュー専用。本番実装は `src/` を参照
- `specs/[DONOT_USE]step02_implementation_spec_draft_v0.1.md` - 廃止済み
- `tatus` `h origin main` - ゴミファイル。無視する

### 詳細ドキュメント（必要時のみ読む）
- アーキテクチャ全体: `docs/01_system_architecture.md`
- プロセスフロー: `docs/02_process_flow.md`
- シーケンス定義: `docs/03_process_sequence.md`
- フィールドマスター: `docs/GSS_field_master.tsv`

## How（常に適用するルール）

### ビルド・型チェック
- 編集後は必ず以下を実行して確認する
  - 型チェック: `npm run typecheck`
  - ビルド: `npm run build`
- `dist/` はビルドで自動生成される。直接編集しない
- esbuild でバンドルなし（`--bundle=false`）ESM 形式でコンパイルする

### 動作確認コマンド
- STEP03 dry-run: `npm run dry-run:step03`
- STEP04/05 dry-run: `npm run dry-run:step04-05`
- STEP03 Gemini実行: `npm run gemini-run:step03`

### 言語・型
- TypeScript strict mode で記述する
- `any` / `unknown` を安易に使わない
- 型定義は `src/types.ts` を参照・拡張する

### Google Sheets 操作
- GSS への書き込みは必ず upsert 経由で行う
- `record_id` が行レベルの主キー。`scene_no` はキーではない
- 書き込むカラムは `Field_Master` 定義のものだけ（`docs/GSS_field_master.tsv`）
- 存在しないカラムへの書き込みは禁止
- シート構造の変更（DDL相当）は行わない

### AI・スキーマ
- AI出力は必ず AJV で JSON Schema 検証してから GSS に書き込む
- スキーマは `schemas/` を参照する
  - `_ai_v{N}.json` = AI出力検証用
  - `_full_v{N}.json` = GSS書き込み検証用
- プロンプトは `prompts/` のバージョン管理済みファイルを使う
- AI に `record_id` 等の運用識別子を生成させない

### STEP_04/05 固有ルール
- `video_format` の値によって実行モードが変わる
  - `full`: Full 脚本生成のみ
  - `short`: Short 脚本生成のみ
  - `short+full`: Full → Short の順に実行
- `short+full` モードでは Full の成功を確認してから Short を実行する
- Short は Full の出力を参照する派生物として扱う

### エラー・ロギング
- エラーは `100_App_Logs` シートに記録する（`src/lib/write-app-log.ts`）
- 部分成功を適切にハンドリングし、失敗行のみ記録する
- エラーはサイレントに握り潰さない

### 環境変数
- 認証情報・APIキーは `.env` 経由で参照する（`.env.example` 参照）
- シークレットをコードにハードコードしない
- GitHub Actions では GitHub Secrets を使う

### ファイル命名規則（既存に合わせる）
- スキーマ: `{対象}_schema_{ai|full}_v{N}.json`
- プロンプト: `{対象}_prompt_v{N}.md`
- 仕様書: `specs/step{NN}_implementation_spec_v{N}.{N}.md`
- バージョンは既存ファイルのバージョンを確認してインクリメントする

## Progressive Disclosure（必要時のみ読む）
- STEP別の詳細仕様 → `specs/step{NN}_implementation_spec_vX.X.md`
- フィールド定義 → `docs/GSS_field_master.tsv`
- プロンプト設計 → `prompts/README.md`
- スキーマ設計 → `schemas/README.md`
- アーキテクチャ詳細 → `docs/architecture.md`
- ステップシーケンス → `docs/03_process_sequence.md`

## ブランチ・PR運用
- `main` が本番ブランチ。直接 push しない
- 作業は `feature/*` ブランチで行い PR を出す
- PR作成時は `github-workflow` スキルを参照する

## STEP_06以降の開発時の注意
- 仕様書を `specs/` に作成してから実装を開始する
- 既存ステップ（step01〜step04-05）のパターンに従う
- 新規スキーマは `schemas/`、新規プロンプトは `prompts/` に配置する
- 仕様書・実装・プロンプトの必須チェックリスト → `.claude/rules/step-implementation-rules.md`

## 動作確認コマンド追加分
- STEP09 dry-run: `npm run dry-run:step09`

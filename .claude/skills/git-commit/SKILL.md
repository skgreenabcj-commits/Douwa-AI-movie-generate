---
name: git-commit
description: Stages, commits, and pushes changes to GitHub following
  Conventional Commits format. Use when committing and pushing code changes.
  Runs typecheck and build before push via pre-push hook.
  Trigger terms: commit, push, コミット, プッシュ, GitHub に上げて.
---

# Git Commit & Push Workflow

## 実行フロー

1. 変更内容を確認する
2. コミットメッセージを作成する
3. ステージングしてコミットする
4. push する（pre-push フックが自動で typecheck + build を実行）

## Step 1: 変更確認

```bash
git diff --staged
git status
ステージされていない変更がある場合は git add を実行する。

Step 2: コミットメッセージ形式
Copy<type>(<scope>): <subject>

[optional body]

[optional footer]
Types
Type	用途
feat	新機能
fix	バグ修正
refactor	動作変更なしのコード整理
docs	ドキュメントのみ
test	テスト追加・更新
chore	ビルド・依存関係・設定
perf	パフォーマンス改善
style	フォーマット（ロジック変更なし）
Subject ルール
命令形で書く（"add feature" ✅ "added feature" ❌）
50文字以内
末尾にピリオドなし
日本語プロジェクトは日本語サブジェクト可
Step 3: コミット実行
Copygit add -A
git commit -m "<type>(<scope>): <subject>"
Step 4: Push
Copygit push origin HEAD
pre-push フックが自動で以下を実行する:

npm run typecheck
npm run build
いずれかが失敗した場合は push を中止してエラーを報告する。

ブランチルール
main への直接 push 禁止
feature/* ブランチで作業して PR でマージ
現在のブランチを確認: git branch --show-current
使用例
Copyfeat(step06): add visual asset generation logic
fix(gss): prevent duplicate record_id on upsert
docs(claude): update CLAUDE.md with step06 notes
chore(deps): upgrade ajv to 8.18.0


## Push オプション

### 通常の push
Run: git push origin HEAD
pre-push フックが自動で typecheck + build を実行する。

### フックをスキップする push（緊急時のみ）
Run: git push --no-verify origin HEAD

使用条件:
- 既存の型エラーが残っており、意図的にスキップする場合
- 修正内容がビルドに影響しないドキュメント変更の場合
- 使用後は必ず型エラーを修正してフックが通る状態に戻す

## push できない場合のチェックリスト

1. Node.js が PATH に入っているか確認: which node
2. npm install 済みか確認: ls node_modules
3. 型エラーの内容を確認: npm run typecheck
4. 既知の型エラーは CLAUDE.md の Git Push 運用ルールセクションを参照

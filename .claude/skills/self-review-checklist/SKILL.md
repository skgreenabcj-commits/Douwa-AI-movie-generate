---
name: self-review-checklist
description: Quality gate checklist to verify before completing any task,
  committing code, or reporting work as done. Use when finishing
  implementation, before committing, or before requesting a review.
  Do not report completion until all items are checked.
---

# Self Review Checklist

作業完了を報告する前に、以下をすべて確認してチェックを入れること。
全項目がチェックされるまで「完了」と報告しない。

## コード品質
- [ ] lint がエラーなく通過している
- [ ] typecheck がエラーなく通過している
- [ ] `console.log` / デバッグコードを削除した
- [ ] 型が厳密で `any` / `unknown` を安易に使っていない
- [ ] 不要なコメントアウトを削除した

## 変更スコープ
- [ ] 依頼された変更のみを行った（余分なリファクタリングがない）
- [ ] 関係のないファイルを変更していない
- [ ] 依頼されていないテストを追加していない

## セキュリティ
- [ ] シークレット・APIキーがコードに含まれていない
- [ ] 環境変数は `.env` 経由で参照している
- [ ] ユーザー入力のバリデーションが適切にある（該当する場合）

## 動作確認
- [ ] 実装した機能がローカルで意図通りに動作する
- [ ] 既存の動作を破壊していない（関連する動作を確認した）
- [ ] エラーハンドリングが適切にある

## GitHub（コードの変更を伴う場合）
- [ ] コミットメッセージが Conventional Commits 形式に従っている
- [ ] 1コミットに無関係な変更が混在していない
- [ ] PR を出す場合は base branch が正しい（通常 `main`）

## 全項目チェック済みの場合のみ「完了」と報告すること

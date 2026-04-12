# Vertex AI Request/Response Logging

Vertex AI (Gemini) への全リクエスト・レスポンスを BigQuery に自動記録する設定のドキュメント。

---

## 実装方式

### 構成

```
GitHub Actions
  → Vertex AI (global endpoint)
      → gemini-2.5-pro / gemini-2.5-flash 等
          ↓ ログ自動記録（コード変更なし）
      BigQuery: vertex_ai_logs.gemini_logs
```

### 概要

- Vertex AI の `setPublisherModelConfig` API（v1beta1）でロギングを有効化
- 設定は**一度だけ**行えば永続化される（毎回の呼び出しコードへの変更は不要）
- 対象: `publishers/google/models/gemini-*` への `generateContent` / `streamGenerateContent` 呼び出し

### 設定済み内容

| 項目 | 値 |
|------|----|
| プロジェクト | `g-drive-api-for-towa-study` |
| ロケーション | `global` |
| サンプリングレート | `1.0`（全リクエストを記録） |
| BigQuery 出力先 | `g-drive-api-for-towa-study.vertex_ai_logs.gemini_logs` |

---

## 確認手順

### 1. 設定状態の確認（Cloud Shell）

現在の設定を確認する場合は、以下で `setPublisherModelConfig` を再実行してレスポンスを確認する。

```python
python3 - <<'EOF'
from google.auth import default
import google.auth.transport.requests
import requests

creds, project = default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
creds.refresh(google.auth.transport.requests.Request())

url = (
    "https://aiplatform.googleapis.com/v1beta1"
    "/projects/g-drive-api-for-towa-study"
    "/locations/global"
    "/publishers/google/models/gemini-2.5-pro"
    ":setPublisherModelConfig"
)
headers = {
    "Authorization": f"Bearer {creds.token}",
    "Content-Type": "application/json"
}
body = {
    "publisherModelConfig": {
        "loggingConfig": {
            "enabled": True,
            "samplingRate": 1.0,
            "bigqueryDestination": {
                "outputUri": "bq://g-drive-api-for-towa-study.vertex_ai_logs.gemini_logs"
            }
        }
    }
}
res = requests.post(url, headers=headers, json=body)
print("STATUS:", res.status_code)
print("BODY  :", res.text if res.text else "(empty)")
EOF
```

**期待レスポンス**: `STATUS: 200` + `operations/...` を含む JSON

### 2. BigQuery テーブルの確認

GCP Console → BigQuery → `g-drive-api-for-towa-study` → `vertex_ai_logs` → `gemini_logs`

テーブルが存在し、スキーマに `full_request` / `full_response` / `logging_time` が含まれていれば正常。

---

## クエリの例

### エラーを閲覧する

`full_response` に `error` キーが含まれるレコードを抽出する。

```sql
SELECT
  logging_time,
  model,
  JSON_VALUE(full_response, '$.error.code')    AS error_code,
  JSON_VALUE(full_response, '$.error.message') AS error_message,
  JSON_VALUE(full_response, '$.error.status')  AS error_status
FROM `g-drive-api-for-towa-study.vertex_ai_logs.gemini_logs`
WHERE JSON_VALUE(full_response, '$.error.code') IS NOT NULL
ORDER BY logging_time DESC
LIMIT 50;
```

---

### 直近1日のログを一覧表示する

```sql
SELECT
  logging_time,
  model,
  JSON_VALUE(full_request,  '$.contents[0].parts[0].text') AS prompt_head,
  JSON_VALUE(full_response, '$.candidates[0].content.parts[0].text') AS response_head
FROM `g-drive-api-for-towa-study.vertex_ai_logs.gemini_logs`
WHERE logging_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
ORDER BY logging_time DESC;
```

---

### 日別の呼び出し回数集計

```sql
SELECT
  DATE(logging_time) AS date,
  model,
  COUNT(*) AS call_count
FROM `g-drive-api-for-towa-study.vertex_ai_logs.gemini_logs`
GROUP BY date, model
ORDER BY date DESC;
```

---

### レイテンシ確認

```sql
SELECT
  logging_time,
  model,
  JSON_VALUE(metadata, '$.latency') AS latency_ms
FROM `g-drive-api-for-towa-study.vertex_ai_logs.gemini_logs`
ORDER BY logging_time DESC
LIMIT 100;
```

---

## 注意事項

- **10MB 制限**: リクエスト + レスポンスが 10MB を超える場合、そのレコードは BigQuery に記録されない（BigQuery Write API の制約）。画像生成リクエストでサイズが大きい場合に欠落する可能性がある。
- **反映遅延**: 設定変更後、ログが届き始めるまで数分かかる場合がある。
- **Preview 機能**: `v1beta1` API を使用しており、GA 前のため SLA なし。
- **サンプリングレート変更**: コスト削減が必要な場合は `samplingRate` を `0.1`（10%）等に変更して再実行する。

```md
# 04_step01_detailed_sequence
```
```mermaid
sequenceDiagram
    actor Human
    participant GAS as Google Apps Script
    participant GH as GitHub Actions
    participant GSS as Google Spreadsheet
    participant CFG as 94_Runtime_Config
    participant REPO as GitHub Repository Files
    participant AI as Gemini API

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_01 Rights Validation Detailed Sequence

    Human->>GAS: STEP_01 実行を指示
    GAS->>GSS: 00_Project から対象 project_id を確認
    GAS->>GH: workflow_dispatch(project_ids, max_items, dry_run)

    GH->>GSS: Read 94_Runtime_Config
    GSS-->>GH: Return runtime config rows
    GH->>GH: Resolve gemini_api_key / primary model / secondary model

    GH->>GSS: Read 00_Project by project_ids
    GSS-->>GH: Return target project rows
    GH->>GH: Extract AI input fields(title_jp, source_url)
    GH->>GH: Check required fields / normalize values

    GH->>REPO: Load prompt / policies / field guide / schemas / examples / fast-pass logic
    REPO-->>GH: Return file contents
    GH->>GH: Assemble STEP_01 prompt

    GH->>AI: Request rights validation JSON(primary model)
    alt Primary model success
        AI-->>GH: Return JSON
    else Primary model failed
        GH->>AI: Retry with secondary model
        AI-->>GH: Return JSON or error
    end

    GH->>GH: Parse AI response
    GH->>GH: Validate against AI schema
    alt Schema validation success
        GH->>GH: Normalize AI row
        GH->>GH: Apply fast-pass if source_url domain matches and conditions pass
        GH->>GH: Build full row for 00_Rights_Validation
        GH->>GSS: Read existing 00_Rights_Validation by project_id
        GSS-->>GH: Return existing row or empty
        alt Existing row found
            GH->>GH: Reuse existing record_id
            GH->>GSS: Update 00_Rights_Validation row
        else No existing row
            GH->>GH: Generate record_id (e.g. PJT-001-RV)
            GH->>GSS: Insert 00_Rights_Validation row
        end

        GH->>GH: Build 00_Project minimal update
        GH->>GSS: Update 00_Project(current_step, approval_status, created_at?, updated_at, updated_by)
        GH->>GSS: Append 100_App_Logs(success log)
    else Schema validation failed
        GH->>GH: Build failure summary
        GH->>GSS: Update 00_Project(approval_status=UNKNOWN, updated_at, updated_by)
        GH->>GSS: Append 100_App_Logs(schema validation failure)
    end

    alt Runtime / AI / write error
        GH->>GH: Build failure summary
        GH->>GSS: Update 00_Project(approval_status=UNKNOWN, updated_at, updated_by)
        GH->>GSS: Append 100_App_Logs(runtime failure)
    end

    GH-->>GAS: Return workflow result / status
    Human->>GSS: 結果確認・承認
    end

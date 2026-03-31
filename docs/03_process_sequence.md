```md
# 03_Process_Sequence
```
```mermaid
sequenceDiagram
    actor Human
    participant GSS as Google Spreadsheet
    participant GAS as Google Apps Script
    participant GH as GitHub Actions Runtime
    participant AI as AI API

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_00 Project Create
    Human->>GSS: 00_Project に案件情報を入力
    GSS->>GSS: 人 / シート運用側で project_id を採番済みにする
    Human->>GAS: 実行対象案件を選択
    GAS->>GSS: 対象案件を確認
    Human->>GSS: 内容を確認
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_01 Rights Validation
    Human->>GAS: STEP_01 実行を指示
    GAS->>GSS: 00_Project から対象 project_id を確認
    GAS->>GH: workflow_dispatch(payload: project_ids, max_items, dry_run)
    GH->>GSS: Read 94_Runtime_Config
    GH->>GSS: Read 00_Project(target rows)
    GH->>GH: Build prompt from title_jp / source_url + prompts / policies / schemas / examples
    GH->>AI: Request rights validation JSON
    AI-->>GH: Return schema-oriented JSON
    GH->>GH: Parse / validate / normalize JSON
    GH->>GH: Apply fast-pass by source_url domain if eligible
    GH->>GSS: Upsert 00_Rights_Validation
    GH->>GSS: Update 00_Project(minimum fields only)
    GH->>GSS: Append 100_App_Logs(success / failure)
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_02 Source Build
    Human->>GAS: STEP_02 実行を指示
    GAS->>GH: Trigger STEP_02
    GH->>GSS: Read required data
    GH->>AI: Request 01_Source JSON
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 01_Source rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_03 Scenes Build
    Human->>GAS: STEP_03 実行を指示
    GAS->>GH: Trigger STEP_03
    GH->>GSS: Read required data
    GH->>AI: Request 02_Scenes JSON
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 02_Scenes rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_04 Short Script
    Human->>GAS: STEP_04 実行を指示
    GAS->>GH: Trigger STEP_04
    GH->>GSS: Read required data
    GH->>AI: Request 03_Script_Short JSON
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 03_Script_Short rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_05 Full Script
    Human->>GAS: STEP_05 実行を指示
    GAS->>GH: Trigger STEP_05
    GH->>GSS: Read required data
    GH->>AI: Request 04_Script_Full JSON
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 04_Script_Full rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_06 Visual Bible
    Note over Human,AI: STEP_04 と STEP_05 の完了後に実行
    Human->>GAS: STEP_06 実行を指示
    GAS->>GH: Trigger STEP_06
    GH->>GSS: Read required data from 03_Script_Short and 04_Script_Full
    GH->>AI: Request 05_Visual_Bible JSON for Short and Full
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 05_Visual_Bible rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_07 Image Prompts
    Human->>GAS: STEP_07 実行を指示
    GAS->>GH: Trigger STEP_07
    GH->>GSS: Read required data
    GH->>AI: Request 06_Image_Prompts JSON
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 06_Image_Prompts rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_08 Audio Subtitle Edit Plan
    Human->>GAS: STEP_08 実行を指示
    GAS->>GH: Trigger STEP_08
    GH->>GSS: Read required data
    GH->>AI: Request 08_TTS_Subtitles / 09_Edit_Plan JSON
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 08_TTS_Subtitles, 09_Edit_Plan rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,AI: STEP_09 Q&A Build
    Note over Human,AI: STEP_04 と STEP_05 の完了後に実行
    Human->>GAS: STEP_09 実行を指示
    GAS->>GH: Trigger STEP_09
    GH->>GSS: Read required data from 03_Script_Short and 04_Script_Full
    GH->>AI: Request 10_QA JSON for Short and Full
    AI-->>GH: Return JSON
    GH->>GH: Validate / normalize JSON
    GH->>GSS: Write 10_QA rows
    Human->>GSS: Review / approve result
    end

    rect rgb(245, 245, 245)
    Note over Human,GSS: STEP_10 Human Quality Check
    Human->>GSS: 11_QC を人手で確認・記入・更新
    Human->>GSS: 必要に応じて前工程へ差し戻し
    end

    rect rgb(245, 245, 245)
    Note over Human,GSS: STEP_11 Human Publish Plan / Publish Decision
    Human->>GSS: 12_Publish を人手で確認・記入・更新
    Human->>GSS: 公開可否を最終判断
    end

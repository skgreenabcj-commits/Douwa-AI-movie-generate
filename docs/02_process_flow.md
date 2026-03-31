```md
# 02_Process_Flow
```
```mermaid
flowchart TD
    STEP_00[STEP_00<br/>Project Create / project_id 採番済み案件を準備]
    STEP_01[STEP_01<br/>Rights Validation<br/>Output: 00_Rights_Validation rows<br/>Also update: 00_Project / 100_App_Logs]
    STEP_02[STEP_02<br/>Source Build<br/>Output: 01_Source rows]
    STEP_03[STEP_03<br/>Scenes Build<br/>Output: 02_Scenes rows]
    STEP_04[STEP_04<br/>Short Script<br/>Output: 03_Script_Short rows]
    STEP_05[STEP_05<br/>Full Script<br/>Output: 04_Script_Full rows]
    STEP_06[STEP_06<br/>Visual Bible for Short and Full<br/>Output: 05_Visual_Bible rows]
    STEP_07[STEP_07<br/>Image Prompts<br/>Output: 06_Image_Prompts rows]
    STEP_08[STEP_08<br/>Audio Subtitle Edit Plan<br/>Output: 08_TTS_Subtitles, 09_Edit_Plan rows]
    STEP_09[STEP_09<br/>Q&A Build for Short and Full<br/>Output: 10_QA rows]
    STEP_10[STEP_10<br/>Human Quality Check<br/>Output: 11_QC rows]
    STEP_11[STEP_11<br/>Human Publish Plan / Publish Decision<br/>Output: 12_Publish rows]

    STEP_00 --> STEP_01
    STEP_01 --> STEP_02
    STEP_02 --> STEP_03
    STEP_03 --> STEP_04
    STEP_03 --> STEP_05
    STEP_04 --> STEP_06
    STEP_05 --> STEP_06
    STEP_06 --> STEP_07
    STEP_07 --> STEP_08
    STEP_04 --> STEP_09
    STEP_05 --> STEP_09
    STEP_08 --> STEP_10
    STEP_09 --> STEP_10
    STEP_10 --> STEP_11

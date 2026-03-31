```mermaid
flowchart LR
    human[Human User / Operator]
    gss[Google Spreadsheet<br/>Project / Workflow / Runtime Config / Logs]
    gas[Google Apps Script<br/>UI / Trigger / Validation / Sheet Utilities]
    github[GitHub Repository<br/>Prompts / Schemas / Automation Code / Fast-pass Logic]
    runtime[GitHub Actions Runtime<br/>STEP Executors / Sheets Client / Validation / Upsert]
    ai[AI APIs<br/>Gemini / TTS / Image]
    logs[Logs / Monitoring / Error Reports]
    config[Runtime Config / Secrets<br/>94_Runtime_Config + GitHub Secrets]
    storage[Assets / JSON / Output Storage]

    human -->|edit / review / approve| gss
    human -->|menu / button trigger| gas

    gas <-->|read / write| gss
    gas -->|workflow_dispatch with payload| github

    github -->|run workflow| runtime
    runtime -->|load prompts / schemas / examples / fast-pass rules| github
    runtime -->|read input / write output / write logs| gss
    runtime -->|call model| ai
    ai -->|JSON output| runtime
    runtime -->|validate / transform / upsert / log| storage
    runtime -->|status / errors| logs
    runtime -->|load runtime settings| config

# fast_pass_logic_v1

このファイルは、信頼性の高い公開元・アーカイブ・配布元に対して、source_url のドメインをキーに fast-pass 候補判定を行うための共通ルールを定義する。  
AIの出力を完全に置き換えるものではなく、GitHub後段処理で限定的な補正候補として利用する。

## 共通原則
- fast-pass は source_url のドメイン一致を起点に判定する
- AI が `BLOCKED` または `risk_level=HIGH` を返した場合は fast-pass を適用しない
- 翻訳者、編者、注釈者、挿絵、現代語訳などの別権利懸念がある場合は fast-pass を適用しない
- 個別注意書き、特殊利用条件、対象範囲の限定がある場合は fast-pass を適用しない
- fast-pass 適用時も、notes には適用根拠を残す

## Rule: aozora.gr.jp
- domain: `www.aozora.gr.jp`
- 条件:
  - 著者名・作品名・翻訳者有無に大きな不整合がない
  - 青空文庫の著作権保護期間満了作品として扱われている
  - 取扱規準・朗読配信案内と矛盾しない
  - 本文中心利用であり、別権利懸念や個別注意書きがない
  - AI出力に強い警告がない
- 補正候補:
  - rights_status=APPROVED
  - risk_level=LOW
  - review_required=N

### fast-pass適用根拠
- 青空文庫は「利用に対価を求めないインターネット電子図書館」であり、**著作権の消滅した作品**と、**自由に読んでもらって構わないとされた作品**を収録する方針を明示している。  
  - 所在: https://www.aozora.gr.jp/guide/nyuumon.html
- 青空文庫の「収録ファイルの取り扱い規準」では、**著作権の切れた作品**について、ファイルのダウンロード、複製、再配布、共有、さらにファイルを元にした**実演・口述・翻案等の活用**が可能である旨が案内されている。  
  - 所在: https://www.aozora.gr.jp/guide/kijyunn.html
- 青空文庫の「収録ファイルの朗読配信について」では、**著作権保護期間満了作品は事前の許諾なく、有償無償を問わず利用可能**である旨が案内されている。  
  - 所在: https://www.aozora.gr.jp/guide/roudoku.html
- 青空文庫FAQ・収録案内では、**翻訳者自身の翻訳収録**や、**著作者または権利継承者による収録申入れ**など、権利状態を踏まえた収録運用が示されている。  
  - 所在: https://www.aozora.gr.jp/guide/aozora_bunko_faq.html  
  - 所在: https://www.aozora.gr.jp/guide/shuuroku.html
- 日本の著作権法上、著作物の保護期間は原則として**著作者の死後70年**であり、保護期間満了後はパブリックドメインとして扱われる。  
  - 所在: 文化庁「著作物等の保護期間の延長に関するQ&A」  
    https://www.bunka.go.jp/seisaku/chosakuken/hokaisei/kantaiheiyo_chosakuken/1411890.html
  - 所在: 文化庁「ここが知りたい著作権」  
    https://www.bunka.go.jp/seisaku/chosakuken/taisetsu/point/index.html
- 以上から、`www.aozora.gr.jp` 配下の作品については、**青空文庫の収録方針・利用規準・朗読配信案内が一致し、かつ個別ページ上も著作権保護期間満了作品として矛盾なく読める場合**に限り、STEP_01 における fast-pass 候補として扱う合理性がある。

### 解釈上の留意点
- fast-pass は **青空文庫ドメインであることのみ** を理由に自動適用しない
- 原著者と翻訳者は分離して確認する
- 翻訳者、編者、注釈者、挿絵、現代語訳、解説文、底本固有の付加要素など、**本文以外の別権利** が疑われる場合は fast-pass を適用しない
- 青空文庫の利用規準は強い根拠だが、個別ページの注記・作品属性・利用対象範囲を優先して確認する
- AI が `BLOCKED` または `risk_level=HIGH` を返した場合は、青空文庫案件であっても fast-pass を適用しない

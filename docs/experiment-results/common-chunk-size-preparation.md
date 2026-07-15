# Common chunk-size benchmark preparation

- Suite attempt: `20260715133756586`
- Protocol hash: `290c3c632dbcf824101f0e184bf18ffec13d7233e3ed2eefaeb6aa412d2fb280`
- Loaded corpus hash: `e44495f83da4d3836eee2903b73821f02921bcd232151209e5a8e44eb7a34815`
- Status: **comparable**

| Experiment | Target | Minimum | Overlap | Chunks | Indexed words | Average | P50 | P90 | P95 | Maximum | Below minimum | At/above target | Preparation ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| common-programming-word-300 | 300 | 200 | 80 | 30455 | 5288888 | 173.66 | 126 | 344 | 385 | 5952 | 17861 | 9028 | 8587 |
| common-programming-word-450 | 450 | 200 | 80 | 27496 | 5002863 | 181.95 | 97 | 464 | 497 | 5952 | 17861 | 4126 | 8837 |
| common-programming-word-850 | 850 | 200 | 80 | 25553 | 4789743 | 187.44 | 83 | 502 | 829 | 5952 | 17861 | 1232 | 8604 |

## Interpretation

- These are corpus-preparation measurements, not retrieval-quality results.
- All candidates used the same loaded corpus snapshot and clean committed code.
- Short source sections are retained as standalone chunks, explaining the common below-minimum count.
- A single source block is not split by the word-window chunker, explaining maxima above every configured target.
- The baseline is retained for retrieval evaluation; no chunk-size choice is accepted until nDCG@k and guardrail metrics are measured on the same suite.

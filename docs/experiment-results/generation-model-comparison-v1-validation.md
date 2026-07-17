# Grounded generator comparison outputs

- Protocol/attempt: `generation-models-v1` / `20260717105749265`
- Split: **validation only**
- Selection: **awaiting-human-review**
- Judge: **disabled**

| Blind variant | Generated | Errors | Cache hits | Input tokens | Output tokens | Reasoning tokens | Cost USD | Median ms | P95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| variant-20c2ee7c | 27 | 0 | 27 | 52578 | 5012 | 4532 | 0.164763 | 1772.89 | 3141.88 |
| variant-cff457f4 | 27 | 0 | 27 | 48914 | 9938 | 5801 | 0.069270 | 3454.26 | 5959.06 |
| variant-015380ad | 27 | 0 | 27 | 55245 | 11084 | 6711 | 0.171426 | 5216.25 | 8096.17 |

No quality winner is selected from latency or cost alone. Human review must be completed using the blinded package before judge calibration or test execution. Cache hits indicate that the final replay reused a successful content-addressed response; token usage, cost, and latency remain those captured from its original provider request. Google cost is a dated list-price estimate, while OpenRouter cost is provider-reported. The locked test split was touched: **no**.

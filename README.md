# ChatGPT Consumer Price Data

OpenAI consumer subscription price collector for ChatGPT Go, Plus, Pro 5x (`prolite`) and Pro 20x (`pro`).

The GitHub Actions workflow reads public ChatGPT checkout pricing configuration for 249 ISO regions, keeps the official local-currency amount, and adds public exchange-rate conversions. It runs every day at 03:17 Asia/Shanghai and can also be started manually.

Published snapshot:

`https://raw.githubusercontent.com/TeaMazal/chatgpt-consumer-price-data/main/data/live-prices.json`

The workflow refuses to replace the current snapshot when coverage is abnormally low, a consumer plan is missing, or the US Plus/Pro reference price is missing.

This repository is not affiliated with or endorsed by OpenAI. Checkout eligibility, taxes and final prices are controlled by the official checkout page.

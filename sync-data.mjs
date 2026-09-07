import { writeFile } from "node:fs/promises";
import { fetchLiveSnapshot } from "./data-loader.mjs";

const outputUrl = new URL("./data/live-prices.json", import.meta.url);
const snapshot = await fetchLiveSnapshot();
await writeFile(outputUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`真实价格快照已更新：${snapshot.plans.reduce((sum, item) => sum + item.rows.length, 0)} 条价格，汇率日期 ${snapshot.fx.updatedAt}`);

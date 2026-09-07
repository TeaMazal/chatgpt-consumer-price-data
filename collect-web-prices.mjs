import { readFile, writeFile } from "node:fs/promises";
import { buildWebSnapshot, retainFailedRows } from "./web-collector-utils.mjs";
import { ECB_RATE_URL, FALLBACK_RATE_URL } from "./data-loader.mjs";
import { validateSnapshot } from "./price-utils.mjs";

const CONFIG_URL = "https://chatgpt.com/backend-anon/checkout_pricing_config/configs";
const outputUrl = new URL("./data/live-prices.json", import.meta.url);
const previousSnapshot = await readPreviousSnapshot();
const COUNTRY_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/).sort();

const configs = [];
const unsupported = [];
const failed = [];
let completed = 0;
await mapLimit(COUNTRY_CODES, 4, async (code) => {
  try {
    const config = await fetchJson(`${CONFIG_URL}/${code}`, true, 3);
    if (config === null) unsupported.push(code);
    else configs.push(config);
  } catch (error) {
    failed.push({ code, message: error instanceof Error ? error.message : String(error) });
  } finally {
    completed += 1;
    if (completed % 20 === 0 || completed === COUNTRY_CODES.length) {
      console.log(`采集进度：${completed}/${COUNTRY_CODES.length}`);
    }
  }
});

if (failed.length) {
  const firstPassFailures = failed.splice(0);
  console.log(`开始串行补采首轮失败地区：${firstPassFailures.map((item) => item.code).join(", ")}`);
  for (const item of firstPassFailures) {
    try {
      const config = await fetchJson(`${CONFIG_URL}/${item.code}`, true, 4);
      if (config === null) unsupported.push(item.code);
      else configs.push(config);
    } catch (error) {
      failed.push({ code: item.code, message: error instanceof Error ? error.message : String(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

if (configs.length < 180) {
  throw new Error(`采集保护未通过：仅成功 ${configs.length}/${COUNTRY_CODES.length} 个地区，旧快照保持不变`);
}

const [ecb, fallback] = await Promise.all([
  fetchJson(ECB_RATE_URL, false, 3),
  fetchJson(FALLBACK_RATE_URL, false, 3),
]);
const freshSnapshot = buildWebSnapshot(configs, ecb, fallback, new Date().toISOString(), {
  requested: COUNTRY_CODES.length,
  unsupported: unsupported.length,
  failed: failed.length,
});
const snapshot = validateSnapshot(retainFailedRows(freshSnapshot, previousSnapshot, failed.map((item) => item.code)));
const plus = snapshot.plans.find((plan) => plan.id === "chatgpt-plus");
const go = snapshot.plans.find((plan) => plan.id === "chatgpt-go");
const proLite = snapshot.plans.find((plan) => plan.id === "chatgpt-prolite");
const pro = snapshot.plans.find((plan) => plan.id === "chatgpt-pro");
if (!plus?.rows.some((row) => row.countryCode === "US") || !pro?.rows.some((row) => row.countryCode === "US")) {
  throw new Error("采集保护未通过：缺少美国 Plus 或 Pro 20x 基准价，旧快照保持不变");
}
if ([go, plus, proLite, pro].some((plan) => !plan || plan.rows.length < 20)) {
  throw new Error("采集保护未通过：任一消费者套餐覆盖少于 20 个地区，旧快照保持不变");
}

await writeFile(outputUrl, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`采集完成：${snapshot.plans.map((plan) => `${plan.shortName} ${plan.rows.length}`).join("，")}；不支持 ${unsupported.length}；失败 ${failed.length}；沿用 ${snapshot.collectionScope.retained || 0}`);
if (failed.length) console.warn(`失败地区：${failed.slice(0, 12).map((item) => item.code).join(", ")}`);

async function fetchJson(url, openAiHeaders = true, retries = 1) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: openAiHeaders ? requestHeaders(url) : { accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    }
  }
  throw lastError;
}

function requestHeaders(url) {
  const path = new URL(url).pathname;
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
    origin: "https://chatgpt.com",
    referer: "https://chatgpt.com/zh-Hans-CN/pricing/",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-openai-target-path": path,
    "x-openai-target-route": "/backend-anon/checkout_pricing_config/configs/{country_code}",
  };
}

async function mapLimit(items, limit, mapper) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function readPreviousSnapshot() {
  try {
    return JSON.parse(await readFile(outputUrl, "utf8"));
  } catch {
    return null;
  }
}

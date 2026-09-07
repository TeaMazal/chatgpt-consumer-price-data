import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  comparisonPercent,
  convertCny,
  filterAndRank,
  formatMoney,
  listedCny,
  originalPriceLabel,
  taxedCny,
  validateSnapshot,
} from "./price-utils.mjs";
import { buildWebSnapshot, retainFailedRows } from "./web-collector-utils.mjs";

const snapshot = validateSnapshot(JSON.parse(await readFile(new URL("./data/live-prices.json", import.meta.url), "utf8")));
const plus = snapshot.plans.find((plan) => plan.id === "chatgpt-plus");
const pro5x = snapshot.plans.find((plan) => plan.id === "chatgpt-prolite");
const pro20x = snapshot.plans.find((plan) => plan.id === "chatgpt-pro");
const plusUs = plus.rows.find((row) => row.countryCode === "US");
const plusJp = plus.rows.find((row) => row.countryCode === "JP");
const pro5xJp = pro5x.rows.find((row) => row.countryCode === "JP");
const pro20xJp = pro20x.rows.find((row) => row.countryCode === "JP");

assert.equal(snapshot.mode, "live", "不得再使用演示模式");
assert.equal(snapshot.plans.length, 4, "应包含 Go、Plus、Pro 5x 和 Pro 20x");
assert.equal(plus.rows.length >= 17, true, "Plus 不得少于当前 17 个已核验地区");
assert.equal(plusUs.amountMajor, plusUs.sourceChannel === "ios" ? 19.99 : 20, "美国 Plus 官方价应匹配采集渠道");
assert.equal(["ios", "web"].includes(plusUs.sourceChannel), true, "价格必须明确标注渠道");
assert.equal(pro5xJp.amountMajor, 16800, "日本 Web Pro 5x 起价应为 ¥16,800");
assert.equal(pro5xJp.planKey, "prolite", "Pro 5x 必须映射到 prolite");
assert.equal(pro20xJp.amountMajor, 30000, "日本 iOS Pro 20x 应为 ¥30,000");
assert.equal(pro20xJp.planKey, "pro", "Pro 20x 必须映射到 pro");
assert.equal(originalPriceLabel(plusJp), "¥3,000", "日元应显示为 0 位小数");
assert.equal(originalPriceLabel(plusUs), plusUs.sourceChannel === "ios" ? "$19.99" : "$20.00", "美元应保留 2 位小数");
assert.equal(taxedCny(plusJp), plusJp.taxTreatment === "included" ? listedCny(plusJp) : null, "含税金额必须遵循官方税费口径");
assert.equal(convertCny(listedCny(plusUs), "USD", snapshot.fx.usdToCny), plusUs.amountMajor, "人民币转美元不应重复换汇");
assert.equal(formatMoney(20, "USD", "zh-CN", 2), "$20.00");
assert.equal(comparisonPercent(plusUs, plusUs), 0, "美国相对自身应为基准");
assert.equal(comparisonPercent(pro5xJp, undefined), null, "没有同渠道美国价格时不得伪造价差");
assert.equal(filterAndRank(plus.rows, { query: "JPY" }).length, 1, "应支持按币种搜索");
assert.equal(filterAndRank(plus.rows, { taxFilter: "unknown" }).every((row) => row.taxTreatment === "unknown"), true, "税费筛选结果必须匹配口径");
assert.equal(snapshot.fx.source.includes("欧洲央行"), true, "汇率主源必须标明欧洲央行");
assert.equal(plusJp.fxSource, "ECB", "日元应使用 ECB 主汇率源");
assert.equal(plus.rows.find((row) => row.currencyCode === "PKR")?.fxSource, "备用汇率", "ECB 未覆盖的 PKR 应明确使用备用源");
assert.equal(Boolean(snapshot.provenance.applePriceSource || snapshot.provenance.webPriceSource), true, "价格来源必须可追溯到官方渠道");

const collectedAt = "2026-09-07T12:00:00.000Z";
const webSnapshot = validateSnapshot(buildWebSnapshot([
  webConfig("US", "USD", 2, null, {
    go: { amount: 8, tax: "exclusive" },
    plus: { amount: 20, tax: "exclusive" },
    prolite: { amount: 100, tax: "exclusive" },
    pro: { amount: 200, tax: "exclusive" },
  }),
  webConfig("JP", "JPY", 0, 10, {
    go: { amount: 1400, tax: "inclusive" },
    plus: { amount: 3000, tax: "inclusive" },
    prolite: { amount: 16800, tax: "inclusive" },
    pro: { amount: 30000, tax: "inclusive" },
  }),
  webConfig("AU", "AUD", 2, 10, {
    plus: { amount: 34.99, tax: "inclusive" },
    pro: { amount: 349.99, tax: "inclusive" },
  }),
], {
  base: "EUR",
  date: "2026-09-04",
  rates: { CNY: 7.8, USD: 1.1, JPY: 180, AUD: 1.7 },
}, {
  result: "success",
  time_last_update_utc: "Mon, 07 Sep 2026 00:02:31 +0000",
  rates: { CNY: 7.1, USD: 1, JPY: 164, AUD: 1.55 },
}, collectedAt));

const webPlus = webSnapshot.plans.find((plan) => plan.id === "chatgpt-plus");
const webPro5x = webSnapshot.plans.find((plan) => plan.id === "chatgpt-prolite");
const webPro20x = webSnapshot.plans.find((plan) => plan.id === "chatgpt-pro");
const webPlusUs = webPlus.rows.find((row) => row.countryCode === "US");
const webPlusJp = webPlus.rows.find((row) => row.countryCode === "JP");

assert.equal(webSnapshot.plans.length, 4, "Web 采集应识别四个消费者套餐");
assert.equal(webPro5x.shortName, "Pro 5x", "prolite 必须显示为 Pro 5x");
assert.equal(webPro5x.rows.find((row) => row.countryCode === "JP").amountMajor, 16800, "Pro 5x 金额必须保持官方主单位");
assert.equal(webPro20x.shortName, "Pro 20x", "pro 必须显示为 Pro 20x");
assert.equal(webPro20x.rows.find((row) => row.countryCode === "US").amountMajor, 200, "Pro 20x 金额必须保持官方主单位");
assert.equal(webPlusUs.taxTreatment, "excluded", "exclusive 应映射为未含税");
assert.equal(webPlusJp.taxTreatment, "included", "inclusive 应映射为已含税");
assert.equal(webPlusUs.taxRatePercent, null, "缺失税率不得转换成 0%");
assert.equal(webPlusJp.taxRatePercent, 10, "明确税率应保留");
assert.equal(webPlusJp.minorUnitExponent, 0, "日元金额不得增加小数位");
assert.equal(webSnapshot.collectionScope.reachable, 3, "采集范围应等于成功配置数量");
assert.equal(webPlusUs.cnyPerUnit, 7.09090909, "ECB 交叉汇率换算应正确");

const partialSnapshot = buildWebSnapshot([
  webConfig("US", "USD", 2, null, {
    go: { amount: 8, tax: "exclusive" },
    plus: { amount: 20, tax: "exclusive" },
    prolite: { amount: 100, tax: "exclusive" },
    pro: { amount: 200, tax: "exclusive" },
  }),
  webConfig("JP", "JPY", 0, 10, {
    go: { amount: 1400, tax: "inclusive" },
    plus: { amount: 3000, tax: "inclusive" },
    prolite: { amount: 16800, tax: "inclusive" },
    pro: { amount: 30000, tax: "inclusive" },
  }),
], {
  base: "EUR", date: "2026-09-04", rates: { CNY: 7.8, USD: 1.1, JPY: 180, AUD: 1.7 },
}, {
  result: "success", time_last_update_utc: "Mon, 07 Sep 2026 00:02:31 +0000", rates: { CNY: 7.1, USD: 1, JPY: 164, AUD: 1.55 },
}, collectedAt, { requested: 3, failed: 1 });
const retainedSnapshot = retainFailedRows(partialSnapshot, webSnapshot, ["AU"]);
assert.equal(retainedSnapshot.plans.find((plan) => plan.id === "chatgpt-plus").rows.length, 3, "临时失败地区应沿用上一份官方价格");
assert.equal(retainedSnapshot.collectionScope.retained, 1, "应记录沿用的地区数量");

console.log("真实价格、套餐映射、汇率与单位测试通过");

function webConfig(countryCode, currencyCode, minorUnitExponent, taxPercent, plans) {
  return {
    country_code: countryCode,
    minor_unit_exponent: minorUnitExponent,
    tax_percent: taxPercent,
    currency_config: {
      symbol_code: currencyCode,
      ...Object.fromEntries(Object.entries(plans).map(([key, month]) => [key, { month }])),
    },
  };
}

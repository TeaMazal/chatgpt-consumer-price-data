export const APPLE_PRICE_URL = "https://raw.githubusercontent.com/psdrbhy/all-use/main/data/verified-prices.json";
export const ECB_RATE_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";
export const FALLBACK_RATE_URL = "https://open.er-api.com/v6/latest/USD";
export const BUSINESS_SCOPE_URL = "https://48team.hualabtech.com/data/prices.json";

const COUNTRY_NAMES = {
  AR: "阿根廷", AU: "澳大利亚", BR: "巴西", CA: "加拿大", DE: "德国", DK: "丹麦",
  FR: "法国", GB: "英国", IN: "印度", JP: "日本", KR: "韩国", MX: "墨西哥",
  NG: "尼日利亚", PH: "菲律宾", PK: "巴基斯坦", TR: "土耳其", US: "美国",
};

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW"]);
const WEB_VERIFIED_AT = "2026-09-07T06:50:00Z";
const WEB_PRICE_URL = "https://chatgpt.com/zh-Hans-CN/pricing/";

export async function fetchLiveSnapshot(fetchImpl = fetch) {
  const [apple, ecb, fallback, scope] = await Promise.all([
    fetchJson(fetchImpl, APPLE_PRICE_URL),
    fetchJson(fetchImpl, ECB_RATE_URL),
    fetchJson(fetchImpl, FALLBACK_RATE_URL),
    fetchOptionalJson(fetchImpl, BUSINESS_SCOPE_URL),
  ]);
  return buildLiveSnapshot(apple, ecb, fallback, new Date().toISOString(), scope);
}

export function buildLiveSnapshot(apple, ecb, fallback, builtAt = new Date().toISOString(), scope = null) {
  validateSources(apple, ecb, fallback);
  const rateFor = createCnyRateResolver(ecb.rates, fallback.rates);
  const iosRows = apple.records
    .filter((record) => record.channel === "ios" && ["plus", "pro"].includes(record.plan))
    .map((record) => ({
      countryCode: record.storefront,
      countryName: record.storefrontNameZh || COUNTRY_NAMES[record.storefront] || record.storefront,
      currencyCode: record.currency,
      amountMajor: record.localPrice,
      minorUnitExponent: minorUnitExponent(record.currency),
      cnyPerUnit: rateFor(record.currency),
      fxSource: rateFor.source(record.currency),
      fxUpdatedAt: rateFor.source(record.currency) === "ECB" ? ecb.date : fallback.time_last_update_utc,
      taxTreatment: "unknown",
      taxRatePercent: null,
      status: "verified",
      sourceChannel: "ios",
      sourceLabel: "Apple App Store",
      sourceUrl: record.sourceUrl,
      collectedAt: record.collectedAt,
      planKey: record.plan,
    }));

  const webRows = [
    verifiedWebRow("go", 1400, rateFor, ecb.date),
    verifiedWebRow("prolite", 16800, rateFor, ecb.date),
  ];
  const latestApplePrice = latestDate(iosRows.map((row) => row.collectedAt));

  return {
    version: 2,
    mode: "live",
    provider: "OpenAI",
    builtAt,
    collectionScope: scope?.coverage ? {
      observedAt: scope.generatedAt,
      requested: scope.coverage.requested,
      reachable: scope.coverage.success,
      unsupported: scope.coverage.unsupported,
      evidencePlan: "business",
      note: "仅用于验证接口地区范围，不把 Business 金额用于消费者套餐",
      sourceUrl: BUSINESS_SCOPE_URL,
    } : null,
    fx: {
      base: "CNY",
      usdToCny: rateFor("USD"),
      updatedAt: ecb.date,
      source: "欧洲央行（Frankfurter）",
      fallbackSource: "ExchangeRate-API（仅补充 ECB 未覆盖币种）",
      fallbackUpdatedAt: fallback.time_last_update_utc,
    },
    plans: [
      plan("chatgpt-go", "ChatGPT Go", "Go", "web", WEB_VERIFIED_AT, webRows.filter((row) => row.planKey === "go")),
      plan("chatgpt-plus", "ChatGPT Plus", "Plus", "ios", latestApplePrice, iosRows.filter((row) => row.planKey === "plus")),
      plan("chatgpt-prolite", "ChatGPT Pro 5x", "Pro 5x", "web", WEB_VERIFIED_AT, webRows.filter((row) => row.planKey === "prolite")),
      plan("chatgpt-pro", "ChatGPT Pro 20x", "Pro 20x", "ios", latestApplePrice, iosRows.filter((row) => row.planKey === "pro")),
    ],
    provenance: {
      appleSnapshotUrl: APPLE_PRICE_URL,
      appleGeneratedAt: apple.generatedAt,
      applePriceSource: "OpenAI 官方 Apple App Store 商品页",
      webPriceSource: "OpenAI 官方 ChatGPT 定价页",
      exchangeRateUrl: ECB_RATE_URL,
      fallbackRateUrl: FALLBACK_RATE_URL,
    },
  };
}

function plan(id, name, shortName, channel, priceUpdatedAt, rows) {
  return { id, name, shortName, channel, billingPeriod: "month", billingUnit: "account", priceUpdatedAt, rows };
}

function verifiedWebRow(planKey, amountMajor, rateFor, fxUpdatedAt) {
  return {
    countryCode: "JP",
    countryName: "日本",
    currencyCode: "JPY",
    amountMajor,
    minorUnitExponent: 0,
    cnyPerUnit: rateFor("JPY"),
    fxSource: rateFor.source("JPY"),
    fxUpdatedAt,
    taxTreatment: "unknown",
    taxRatePercent: null,
    status: "verified",
    sourceChannel: "web",
    sourceLabel: "ChatGPT 官网",
    sourceUrl: WEB_PRICE_URL,
    collectedAt: WEB_VERIFIED_AT,
    planKey,
  };
}

function createCnyRateResolver(ecbRates, fallbackRates) {
  const resolver = (currency) => {
    let rate;
    if (currency === "EUR") rate = ecbRates.CNY;
    else if (Number.isFinite(ecbRates[currency])) rate = ecbRates.CNY / ecbRates[currency];
    else if (Number.isFinite(fallbackRates[currency])) rate = fallbackRates.CNY / fallbackRates[currency];
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`没有可用的 ${currency} 人民币汇率`);
    return Math.round(rate * 100000000) / 100000000;
  };
  resolver.source = (currency) => currency === "EUR" || Number.isFinite(ecbRates[currency]) ? "ECB" : "备用汇率";
  return resolver;
}

function minorUnitExponent(currency) {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

function latestDate(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${new URL(url).hostname} 返回 HTTP ${response.status}`);
  return response.json();
}

async function fetchOptionalJson(fetchImpl, url) {
  try {
    return await fetchJson(fetchImpl, url);
  } catch {
    return null;
  }
}

function validateSources(apple, ecb, fallback) {
  if (apple?.schemaVersion !== 2 || !Array.isArray(apple.records) || !apple.records.length) {
    throw new Error("官方 App Store 价格快照格式无效");
  }
  if (ecb?.base !== "EUR" || !Number.isFinite(ecb.rates?.CNY) || !Number.isFinite(ecb.rates?.USD)) {
    throw new Error("ECB 汇率响应格式无效");
  }
  if (fallback?.result !== "success" || fallback.base_code !== "USD" || !Number.isFinite(fallback.rates?.CNY)) {
    throw new Error("备用汇率响应格式无效");
  }
}

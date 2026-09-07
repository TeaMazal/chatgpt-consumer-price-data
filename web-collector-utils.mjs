const PLAN_DEFINITIONS = [
  ["chatgpt-go", "ChatGPT Go", "Go", "go"],
  ["chatgpt-plus", "ChatGPT Plus", "Plus", "plus"],
  ["chatgpt-prolite", "ChatGPT Pro 5x", "Pro 5x", "prolite"],
  ["chatgpt-pro", "ChatGPT Pro 20x", "Pro 20x", "pro"],
];

const displayNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });

export function buildWebSnapshot(configs, ecb, fallback, collectedAt = new Date().toISOString(), scope = {}) {
  if (!Array.isArray(configs) || !configs.length) throw new Error("没有可用的国家价格配置");
  const rateFor = createCnyRateResolver(ecb, fallback);
  const rowsByPlan = new Map(PLAN_DEFINITIONS.map((definition) => [definition[3], []]));

  for (const config of configs) {
    const countryCode = String(config.country_code || "").toUpperCase();
    const currencyConfig = config.currency_config || {};
    const currencyCode = String(
      currencyConfig.symbol_code || config.symbol_code || currencyConfig.currency_code || config.currency_code || "",
    ).toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(currencyCode)) continue;
    const minorUnitExponent = integerOr(currencyConfig.minor_unit_exponent, config.minor_unit_exponent, currencyDigits(currencyCode));
    const taxPercent = numberOrNull(currencyConfig.tax_percent, config.tax_percent);

    for (const [, , , planKey] of PLAN_DEFINITIONS) {
      const month = currencyConfig[planKey]?.month;
      if (!month || !Number.isFinite(Number(month.amount)) || Number(month.amount) <= 0) continue;
      const rate = rateFor(currencyCode);
      rowsByPlan.get(planKey).push({
        countryCode,
        countryName: displayNames.of(countryCode) || countryCode,
        currencyCode,
        amountMajor: Number(month.amount),
        minorUnitExponent,
        cnyPerUnit: rate.value,
        fxSource: rate.source,
        fxUpdatedAt: rate.updatedAt,
        taxTreatment: normalizeTax(month.tax),
        taxRatePercent: taxPercent,
        status: "verified",
        sourceChannel: "web",
        sourceLabel: "ChatGPT 官网接口",
        sourceUrl: `https://chatgpt.com/backend-anon/checkout_pricing_config/configs/${countryCode}`,
        collectedAt,
        planKey,
      });
    }
  }

  const plans = PLAN_DEFINITIONS.map(([id, name, shortName, planKey]) => ({
    id,
    name,
    shortName,
    channel: "web",
    billingPeriod: "month",
    billingUnit: "account",
    priceUpdatedAt: collectedAt,
    rows: rowsByPlan.get(planKey),
  })).filter((plan) => plan.rows.length);

  return {
    version: 2,
    mode: "live",
    provider: "OpenAI",
    builtAt: collectedAt,
    collectionScope: {
      observedAt: collectedAt,
      requested: scope.requested ?? configs.length,
      reachable: configs.length,
      unsupported: scope.unsupported ?? 0,
      failed: scope.failed ?? 0,
      evidencePlan: "consumer",
      note: "消费者套餐由 OpenAI 官方 Web 价格配置直接采集",
    },
    fx: {
      base: "CNY",
      usdToCny: rateFor("USD").value,
      updatedAt: ecb.date,
      source: "欧洲央行（Frankfurter）",
      fallbackSource: "ExchangeRate-API（仅补充 ECB 未覆盖币种）",
      fallbackUpdatedAt: fallback.time_last_update_utc,
    },
    plans,
    provenance: {
      webPriceSource: "OpenAI ChatGPT checkout pricing config",
      countryEndpoint: "https://chatgpt.com/backend-anon/checkout_pricing_config/countries",
      configUrlTemplate: "https://chatgpt.com/backend-anon/checkout_pricing_config/configs/{country_code}",
    },
  };
}

export function retainFailedRows(snapshot, previousSnapshot, failedCodes) {
  if (previousSnapshot?.collectionScope?.evidencePlan !== "consumer" || !Array.isArray(previousSnapshot.plans)) {
    return snapshot;
  }
  const failed = new Set(failedCodes);
  const retainedCountries = new Set();
  const plans = snapshot.plans.map((plan) => {
    const currentCountries = new Set(plan.rows.map((row) => row.countryCode));
    const previousPlan = previousSnapshot.plans.find((item) => item.id === plan.id);
    const retainedRows = (previousPlan?.rows || [])
      .filter((row) => failed.has(row.countryCode) && !currentCountries.has(row.countryCode))
      .map((row) => {
        retainedCountries.add(row.countryCode);
        return { ...row, freshness: "retained" };
      });
    return { ...plan, rows: [...plan.rows, ...retainedRows] };
  });
  return {
    ...snapshot,
    collectionScope: { ...snapshot.collectionScope, retained: retainedCountries.size },
    plans,
  };
}

function createCnyRateResolver(ecb, fallback) {
  if (ecb?.base !== "EUR" || !Number.isFinite(ecb.rates?.CNY)) throw new Error("ECB 汇率无效");
  if (fallback?.result !== "success" || !Number.isFinite(fallback.rates?.CNY)) throw new Error("备用汇率无效");
  return (currency) => {
    if (currency === "EUR") return { value: ecb.rates.CNY, source: "ECB", updatedAt: ecb.date };
    if (Number.isFinite(ecb.rates[currency])) {
      return { value: roundRate(ecb.rates.CNY / ecb.rates[currency]), source: "ECB", updatedAt: ecb.date };
    }
    if (Number.isFinite(fallback.rates[currency])) {
      return {
        value: roundRate(fallback.rates.CNY / fallback.rates[currency]),
        source: "备用汇率",
        updatedAt: fallback.time_last_update_utc,
      };
    }
    throw new Error(`没有可用的 ${currency} 人民币汇率`);
  };
}

function normalizeTax(value) {
  if (value === "inclusive") return "included";
  if (value === "exclusive") return "excluded";
  return "unknown";
}

function currencyDigits(currency) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

function integerOr(...values) {
  const match = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .find(Number.isInteger);
  return match ?? 2;
}

function numberOrNull(...values) {
  const match = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .find(Number.isFinite);
  return match ?? null;
}

function roundRate(value) {
  return Math.round(value * 100000000) / 100000000;
}

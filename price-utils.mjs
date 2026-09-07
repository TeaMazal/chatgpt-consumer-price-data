const SUPPORTED_CURRENCIES = new Set(["CNY", "USD"]);

export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 2 || snapshot.mode !== "live") {
    throw new Error("价格快照格式不受支持");
  }
  if (!Number.isFinite(snapshot.fx?.usdToCny) || snapshot.fx.usdToCny <= 0) {
    throw new Error("价格快照没有有效的美元汇率");
  }
  if (!Array.isArray(snapshot.plans) || snapshot.plans.length === 0) {
    throw new Error("价格快照没有套餐数据");
  }
  for (const plan of snapshot.plans) {
    if (!plan.id || !Array.isArray(plan.rows) || plan.rows.length === 0) throw new Error(`套餐数据无效: ${plan.id || "unknown"}`);
    for (const row of plan.rows) {
      if (!/^[A-Z]{2}$/.test(row.countryCode)) throw new Error(`国家代码无效: ${row.countryCode}`);
      if (!/^[A-Z]{3}$/.test(row.currencyCode)) throw new Error(`币种代码无效: ${row.currencyCode}`);
      if (!Number.isFinite(row.amountMajor) || row.amountMajor <= 0) throw new Error(`官方金额无效: ${row.countryCode}`);
      if (!Number.isInteger(row.minorUnitExponent) || row.minorUnitExponent < 0 || row.minorUnitExponent > 4) {
        throw new Error(`货币小数位无效: ${row.countryCode}`);
      }
      if (!Number.isFinite(row.cnyPerUnit) || row.cnyPerUnit <= 0) throw new Error(`人民币汇率无效: ${row.countryCode}`);
      if (row.status !== "verified" || !["ios", "web"].includes(row.sourceChannel) || !row.sourceUrl) {
        throw new Error(`价格来源无效: ${row.countryCode}`);
      }
    }
  }
  return snapshot;
}

export function listedCny(row) {
  if (!row) return null;
  return roundMoney(row.amountMajor * row.cnyPerUnit);
}

export function taxedCny(row) {
  if (!row) return null;
  const listed = listedCny(row);
  if (row.taxTreatment === "included") return listed;
  if (row.taxTreatment === "excluded" && Number.isFinite(row.taxRatePercent)) {
    return roundMoney(listed * (1 + row.taxRatePercent / 100));
  }
  return null;
}

export function displayAmountCny(row, basis = "listed") {
  return basis === "taxed" ? taxedCny(row) : listedCny(row);
}

export function convertCny(cny, currency, usdToCny) {
  if (cny === null || cny === undefined) return null;
  if (!SUPPORTED_CURRENCIES.has(currency)) throw new Error(`不支持的显示币种: ${currency}`);
  return currency === "CNY" ? roundMoney(cny) : roundMoney(cny / usdToCny);
}

export function formatMoney(amount, currency, locale = "zh-CN", fractionDigits) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "结账确认";
  const options = { style: "currency", currency, currencyDisplay: "narrowSymbol" };
  if (Number.isInteger(fractionDigits)) {
    options.minimumFractionDigits = fractionDigits;
    options.maximumFractionDigits = fractionDigits;
  }
  return new Intl.NumberFormat(locale, options).format(amount);
}

export function originalPriceLabel(row) {
  return formatMoney(row.amountMajor, row.currencyCode, "zh-CN", row.minorUnitExponent);
}

export function comparisonPercent(row, referenceRow, basis = "listed") {
  const value = displayAmountCny(row, basis);
  const reference = displayAmountCny(referenceRow, basis);
  if (value === null || reference === null || reference === 0) return null;
  return Math.round(((value - reference) / reference) * 1000) / 10;
}

export function filterAndRank(rows, { query = "", taxFilter = "all", basis = "listed" } = {}) {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  return rows
    .filter((row) => taxFilter === "all" || row.taxTreatment === taxFilter)
    .filter((row) => {
      if (!normalized) return true;
      return [row.countryName, row.countryCode, row.currencyCode]
        .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(normalized));
    })
    .sort((a, b) => {
      const aValue = displayAmountCny(a, basis);
      const bValue = displayAmountCny(b, basis);
      if (aValue === null && bValue === null) return a.countryName.localeCompare(b.countryName, "zh-CN");
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      return aValue - bValue;
    });
}

export function flagEmoji(countryCode) {
  return [...countryCode.toUpperCase()].map((char) => String.fromCodePoint(127397 + char.charCodeAt(0))).join("");
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

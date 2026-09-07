import { fetchLiveSnapshot } from "./data-loader.mjs?v=global-pipeline1";
import {
  comparisonPercent,
  convertCny,
  displayAmountCny,
  filterAndRank,
  flagEmoji,
  formatMoney,
  listedCny,
  originalPriceLabel,
  taxedCny,
  validateSnapshot,
} from "./price-utils.mjs?v=global-pipeline1";

const state = {
  snapshot: null,
  planId: "chatgpt-plus",
  displayCurrency: "CNY",
  basis: "listed",
  query: "",
  taxFilter: "all",
  refreshing: false,
};

const refs = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindRefs();
  bindEvents();
  try {
    const response = await fetch("./data/live-prices.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applySnapshot(validateSnapshot(await response.json()));
    await refreshLiveData(true);
  } catch (error) {
    showLoadError(error);
  }
  window.lucide?.createIcons();
});

function bindRefs() {
  [
    "priceUpdatedAt", "fxUpdatedAt", "currencyTabs", "basisTabs", "platformTabs", "planSelect",
    "searchInput", "clearSearch", "taxFilter", "refreshButton", "sourceState", "noticeTitle",
    "noticeBody", "noticeTag", "lowestPrice", "lowestCountry", "referenceLabel", "referencePrice",
    "referenceMeta", "savingPercent", "savingMeta", "regionCount", "currencyCount", "resultCount",
    "priceRows", "emptyState", "barChart",
  ].forEach((id) => { refs[id] = document.getElementById(id); });
}

function bindEvents() {
  refs.currencyTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-currency]");
    if (!button) return;
    state.displayCurrency = button.dataset.currency;
    setActive(refs.currencyTabs, button);
    render();
  });
  refs.basisTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-basis]");
    if (!button) return;
    state.basis = button.dataset.basis;
    setActive(refs.basisTabs, button);
    render();
  });
  refs.platformTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-platform]");
    if (!button || button.dataset.platform === "openai") return;
    button.animate([{ transform: "translateX(0)" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], { duration: 220 });
  });
  refs.planSelect.addEventListener("change", () => {
    state.planId = refs.planSelect.value;
    state.query = "";
    refs.searchInput.value = "";
    render();
  });
  refs.searchInput.addEventListener("input", () => {
    state.query = refs.searchInput.value;
    renderRows();
  });
  refs.clearSearch.addEventListener("click", () => {
    refs.searchInput.value = "";
    state.query = "";
    refs.searchInput.focus();
    renderRows();
  });
  refs.taxFilter.addEventListener("change", () => {
    state.taxFilter = refs.taxFilter.value;
    renderRows();
  });
  refs.refreshButton.addEventListener("click", () => refreshLiveData(false));
}

function applySnapshot(snapshot) {
  state.snapshot = snapshot;
  if (!snapshot.plans.some((plan) => plan.id === state.planId)) state.planId = snapshot.plans[0].id;
  refs.planSelect.innerHTML = snapshot.plans
    .map((plan) => `<option value="${plan.id}">${escapeHtml(plan.name)} · ${channelName(plan.channel)}</option>`)
    .join("");
  refs.planSelect.value = state.planId;
  render();
}

async function refreshLiveData(silent) {
  if (state.refreshing) return;
  state.refreshing = true;
  refs.refreshButton.disabled = true;
  refs.refreshButton.classList.add("refreshing");
  setSourceState("正在刷新", "loading");
  try {
    applySnapshot(validateSnapshot(await fetchLiveSnapshot()));
    setSourceState(state.snapshot.collectionScope?.evidencePlan === "consumer" ? "全球真实数据" : "真实数据", "live");
    refs.noticeTitle.textContent = "官方渠道数据已刷新";
    refs.noticeBody.textContent = noticeText(currentPlan());
    refs.noticeTag.textContent = "可核验来源";
  } catch (error) {
    if (!state.snapshot) throw error;
    setSourceState("本地真实快照", "cached");
    refs.noticeTitle.textContent = "实时刷新暂时失败";
    refs.noticeBody.textContent = `继续使用上次成功的真实快照：${error.message}`;
    refs.noticeTag.textContent = "已保留快照";
    if (!silent) console.warn(error);
  } finally {
    state.refreshing = false;
    refs.refreshButton.disabled = false;
    refs.refreshButton.classList.remove("refreshing");
  }
}

function render() {
  if (!state.snapshot) return;
  renderMeta();
  renderSummary();
  renderRows();
  renderChart();
  refs.noticeBody.textContent = noticeText(currentPlan());
  window.lucide?.createIcons();
}

function currentPlan() {
  return state.snapshot?.plans.find((plan) => plan.id === state.planId) || state.snapshot?.plans[0];
}

function renderMeta() {
  const plan = currentPlan();
  refs.priceUpdatedAt.textContent = formatDate(plan.priceUpdatedAt);
  refs.fxUpdatedAt.textContent = `汇率 ${formatDate(state.snapshot.fx.updatedAt, true)}`;
}

function renderSummary() {
  const plan = currentPlan();
  const rows = plan.rows;
  const ranked = filterAndRank(rows, { basis: state.basis });
  const lowest = ranked.find((row) => displayAmountCny(row, state.basis) !== null);
  const reference = rows.find((row) => row.countryCode === "US");
  const lowestValue = displayAmountCny(lowest, state.basis);
  const referenceValue = displayAmountCny(reference, state.basis);
  refs.lowestPrice.textContent = displayMoney(lowestValue);
  refs.lowestCountry.textContent = lowest ? `${lowest.countryName} · ${originalPriceLabel(lowest)}` : "--";
  refs.referenceLabel.textContent = "美国基准";
  refs.referencePrice.textContent = reference ? displayMoney(referenceValue) : "--";
  refs.referenceMeta.textContent = reference ? `${plan.shortName} · 每账号/月` : "当前官方渠道未采集美国区";
  const saving = comparisonPercent(lowest, reference, state.basis);
  refs.savingPercent.textContent = saving === null ? "--" : `${saving > 0 ? "+" : ""}${saving}%`;
  refs.savingMeta.textContent = reference ? "相对美国标价" : "缺少同渠道美国基准";
  refs.regionCount.textContent = `${rows.length} 个`;
  const reachable = state.snapshot.collectionScope?.reachable;
  const currencyCount = new Set(rows.map((row) => row.currencyCode)).size;
  refs.currencyCount.textContent = reachable
    ? `接口范围 ${reachable} · 当前 ${currencyCount} 种币种`
    : `${currencyCount} 种结算币种`;
}

function renderRows() {
  if (!state.snapshot) return;
  const rowsForPlan = currentPlan().rows;
  const reference = rowsForPlan.find((row) => row.countryCode === "US");
  const rows = filterAndRank(rowsForPlan, {
    query: state.query,
    taxFilter: state.taxFilter,
    basis: state.basis,
  });
  refs.resultCount.textContent = `${rows.length} 个地区 · 按${state.basis === "listed" ? "标价换算" : "含税口径"}从低到高`;
  refs.emptyState.hidden = rows.length > 0;
  refs.priceRows.innerHTML = rows.map((row, index) => priceRowTemplate(row, reference, index)).join("");
}

function priceRowTemplate(row, reference, index) {
  const listed = listedCny(row);
  const taxed = taxedCny(row);
  const compare = comparisonPercent(row, reference, state.basis);
  const compareClass = compare === null || Math.abs(compare) < 0.05 ? "equal" : compare < 0 ? "cheap" : "expensive";
  const compareText = compare === null ? "暂无基准" : Math.abs(compare) < 0.05 ? "基准" : `${compare > 0 ? "+" : ""}${compare}%`;
  const taxMeta = taxLabel(row);
  return `
    <div class="price-row" role="row">
      <div class="country-cell" role="cell">
        <span class="rank ${index < 3 ? "top" : ""}">${String(index + 1).padStart(2, "0")}</span>
        <span class="flag" aria-hidden="true">${flagEmoji(row.countryCode)}</span>
        <span><strong>${escapeHtml(row.countryName)}</strong><small>${row.countryCode} · ${row.currencyCode}</small></span>
      </div>
      <div class="price-cell" role="cell"><strong>${originalPriceLabel(row)}</strong><small>每账号 / 月</small></div>
      <div class="price-cell primary" role="cell"><strong>${displayMoney(listed)}</strong><small>1 ${row.currencyCode} = ¥${formatRate(row.cnyPerUnit)} · ${escapeHtml(row.fxSource || "汇率")}</small></div>
      <div class="price-cell ${taxed === null ? "unknown" : ""}" role="cell"><strong>${displayMoney(taxed)}</strong><small>${taxMeta.detail}</small></div>
      <div class="compare-cell ${compareClass}" role="cell"><strong>${compareText}</strong><small>${state.basis === "listed" ? "按标价" : "按含税口径"}</small></div>
      <div class="status-cell" role="cell"><a class="status-badge verified" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noreferrer">官方已核验</a><small>${channelName(row.sourceChannel)}</small></div>
    </div>`;
}

function renderChart() {
  const rows = filterAndRank(currentPlan().rows, { basis: state.basis })
    .filter((row) => displayAmountCny(row, state.basis) !== null)
    .slice(0, 6);
  if (!rows.length) {
    refs.barChart.innerHTML = '<div class="chart-empty">当前税费口径暂无可比较价格</div>';
    return;
  }
  const values = rows.map((row) => displayAmountCny(row, state.basis));
  const max = Math.max(...values);
  refs.barChart.innerHTML = rows.map((row, index) => {
    const value = values[index];
    const width = Math.max(34, (value / max) * 100);
    return `<div class="bar-item"><div class="bar-label"><strong>${escapeHtml(row.countryName)}</strong><small>${row.currencyCode}</small></div><div class="bar-track"><div class="bar-fill" style="width:${width}%">${displayMoney(value)}</div></div></div>`;
  }).join("");
}

function displayMoney(cny) {
  if (cny === null || cny === undefined) return "结账确认";
  const amount = convertCny(cny, state.displayCurrency, state.snapshot.fx.usdToCny);
  return formatMoney(amount, state.displayCurrency, "zh-CN", 2);
}

function taxLabel(row) {
  if (row.taxTreatment === "included") return { label: "已含税", detail: row.taxRatePercent ? `已含 ${row.taxRatePercent}%` : "官方标记含税" };
  if (row.taxTreatment === "excluded") return { label: "未含税", detail: Number.isFinite(row.taxRatePercent) ? `加计 ${row.taxRatePercent}%` : "税率未知" };
  return { label: "结账确认", detail: "官方公开页未声明税费" };
}

function noticeText(plan) {
  if (!plan) return "价格来自 OpenAI 官方公开页面，汇率来自欧洲央行。";
  const scope = state.snapshot.collectionScope;
  if (scope?.evidencePlan === "consumer") {
    const retained = scope.retained ? `，沿用上次成功 ${scope.retained}` : "";
    return `${plan.shortName} 已收录 ${plan.rows.length} 个地区；本次成功 ${scope.reachable}/${scope.requested}，不支持 ${scope.unsupported || 0}，失败 ${scope.failed || 0}${retained}。`;
  }
  if (plan.channel === "ios") {
    const reachable = scope?.reachable;
    return `${plan.shortName} 当前已核验 ${plan.rows.length} 个地区；接口已探测 ${reachable || "--"} 个地区，等待 GitHub 采集消费者套餐。`;
  }
  return `${plan.shortName} 来自 OpenAI 官方 Web 定价页；目前只展示已人工核验的日本区。`;
}

function channelName(channel) {
  return channel === "ios" ? "iOS 官方价" : "Web 官方价";
}

function setSourceState(label, className) {
  refs.sourceState.className = `source-state ${className}`;
  refs.sourceState.querySelector("span").textContent = label;
}

function showLoadError(error) {
  setSourceState("数据不可用", "error");
  refs.noticeTitle.textContent = "真实价格数据加载失败";
  refs.noticeBody.textContent = error.message;
  refs.noticeTag.textContent = "请稍后刷新";
  refs.priceRows.innerHTML = `<div class="empty-state"><strong>价格数据加载失败</strong><span>${escapeHtml(error.message)}</span></div>`;
}

function setActive(container, selected) {
  container.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === selected));
}

function formatDate(value, dateOnly = false) {
  if (!value) return "--";
  const options = dateOnly
    ? { year: "numeric", month: "2-digit", day: "2-digit" }
    : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat("zh-CN", options).format(new Date(value));
}

function formatRate(value) {
  if (value >= 1) return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

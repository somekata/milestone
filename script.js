// =========================
// グローバル状態
// =========================

let milestones = [];
let filteredMilestones = [];
let currentView = "list";
let currentSort = { key: null, asc: true };
let selectedId = null;

const STATUS_LABELS = {
  "not-started": "未着手",
  "in-progress": "進行中",
  done: "完了",
  postponed: "延期",
};

const STATUS_ORDER = {
  "not-started": 1,
  "in-progress": 2,
  done: 3,
  postponed: 4,
};

const PRIORITY_LABELS = {
  low: "低",
  medium: "中",
  high: "高",
};

// =========================
// DOM取得 & 初期化
// =========================

document.addEventListener("DOMContentLoaded", () => {
  setupEventHandlers();
  applyFilterAndRender();
});

// イベント設定
function setupEventHandlers() {
  document
    .getElementById("btn-load-csv")
    .addEventListener("click", handleLoadCSV);
  document
    .getElementById("btn-export-csv")
    .addEventListener("click", handleExportCSV);

  document
    .getElementById("btn-apply-filter")
    .addEventListener("click", () => applyFilterAndRender());
  document
    .getElementById("btn-reset-filter")
    .addEventListener("click", resetFilters);

  document.querySelectorAll("#view-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.view);
    });
  });

  // テーブルヘッダ ソート
  document
    .querySelectorAll(".milestone-table th[data-sort]")
    .forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        toggleSort(key);
      });
    });

  // 新規ボタン
  document.getElementById("btn-new").addEventListener("click", () => {
    openModalForNew();
  });

  // モーダル
  document
    .getElementById("btn-modal-cancel")
    .addEventListener("click", closeModal);
  document.getElementById("milestone-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveFromModal();
  });

  // バックドロップクリックで閉じる
  document
    .querySelector("#milestone-modal .modal-backdrop")
    .addEventListener("click", closeModal);
}

// =========================
// CSV 読み込み・書き出し
// =========================

function handleLoadCSV() {
  const input = document.getElementById("csvFile");
  const file = input.files[0];
  const msg = document.getElementById("csv-message");

  if (!file) {
    msg.textContent = "CSVファイルを選択してください。";
    return;
  }

  const mode = document.querySelector('input[name="loadMode"]:checked').value;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    try {
      const rows = parseCSV(text);
      if (!rows.length) {
        msg.textContent = "有効な行が見つかりませんでした。";
        return;
      }
      const { added, skipped } = addRowsToMilestones(rows, mode);
      msg.textContent = `読み込み完了: ${added}件追加 / ${skipped}件スキップ`;
      input.value = "";
      refreshOwnerFilterOptions();
      applyFilterAndRender();
    } catch (err) {
      console.error(err);
      msg.textContent = "CSVの読み込み中にエラーが発生しました。";
    }
  };
  reader.readAsText(file, "utf-8");
}

// 簡易CSVパーサー（ダブルクオート対応）
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = [];
  let headers = null;

  for (let line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);
    if (!headers) {
      headers = cols;
      continue;
    }
    if (cols.length === 1 && cols[0] === "") continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = cols[idx] !== undefined ? cols[idx] : "";
    });
    rows.push(row);
  }

  return rows;
}

// 1行分のパース
function parseCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur);
  return result;
}

// CSV行 → internal milestone に変換
function addRowsToMilestones(rows, mode) {
  if (mode === "replace") {
    milestones = [];
    selectedId = null;
  }

  const existingIds = new Set(milestones.map((m) => m.id));
  let added = 0;
  let skipped = 0;

  for (const r of rows) {
    const m = convertRowToMilestone(r);
    if (!m.title) {
      skipped++;
      continue;
    }
    if (!m.id) {
      m.id = generateId();
    } else if (existingIds.has(m.id)) {
      // id重複はスキップ（簡易）
      skipped++;
      continue;
    }
    milestones.push(m);
    existingIds.add(m.id);
    added++;
  }
  return { added, skipped };
}

function convertRowToMilestone(row) {
  const trim = (v) => (v === undefined || v === null ? "" : String(v).trim());

  const tagsStr = trim(row.tags);
  const tags = tagsStr
    ? tagsStr
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return {
    id: trim(row.id),
    title: trim(row.title),
    level: trim(row.level || "L2"),
    category: trim(row.category || ""),
    startDate: normalizeDateString(trim(row.start_date)),
    endDate: normalizeDateString(trim(row.end_date)),
    status: trim(row.status || "not-started"),
    priority: trim(row.priority || "medium"),
    owner: trim(row.owner || ""),
    tags,
    notes: trim(row.notes || ""),
  };
}

function normalizeDateString(s) {
  if (!s) return "";
  // YYYY-MM-DD 以外はそのまま受ける（タイムラインで解釈失敗するかも）
  return s;
}

// デフォルトファイル名生成
function buildDefaultFilename() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `milestones_${stamp}.csv`;
}

// CSV書き出し（保存先・保存名を選択可能）
async function handleExportCSV() {
  if (!milestones.length) {
    alert("書き出すマイルストーンがありません。");
    return;
  }

  // CSV文字列の組み立て
  const header =
    "id,title,level,category,start_date,end_date,status,priority,owner,tags,notes";
  const lines = [header];

  for (const m of milestones) {
    const row = [
      m.id || "",
      m.title || "",
      m.level || "",
      m.category || "",
      m.startDate || "",
      m.endDate || "",
      m.status || "",
      m.priority || "",
      m.owner || "",
      (m.tags || []).join(";"),
      m.notes || "",
    ].map(escapeCSVField);
    lines.push(row.join(","));
  }

  const csv = lines.join("\r\n");
  const defaultName = buildDefaultFilename(); // 例: milestones_2025-11-16.csv

  // File System Access API が使える場合は OS の保存ダイアログを使用
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [
          {
            description: "CSV Files",
            accept: { "text/csv": [".csv"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
      alert(
        `保存しました: ${handle.name}\n※通常は data フォルダを作成して、その中に保存しておくと管理しやすいです。`
      );
      return;
    } catch (e) {
      // キャンセルした場合は何もしない
      if (e.name === "AbortError") return;
      console.error(e);
      // それ以外のエラーは通常ダウンロードにフォールバック
    }
  }

  // フォールバック：ファイル名指定 → 通常ダウンロード
  const filename = prompt(
    "保存するファイル名を入力してください（通常は data フォルダに保存して管理することをおすすめします）:",
    defaultName
  );
  if (!filename) return;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename; // ここでファイル名を反映
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCSVField(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// =========================
// フィルタ・ソート・描画
// =========================

function applyFilterAndRender() {
  filteredMilestones = applyFilters(milestones);
  applySort();
  renderListView();
  renderTimelineView();
  updateFooterCount();
  refreshOwnerFilterOptions();
}

function applyFilters(list) {
  const searchText = document
    .getElementById("searchText")
    .value.trim()
    .toLowerCase();

  const levelValues = Array.from(
    document.querySelectorAll("#levelFilterGroup input:checked")
  ).map((i) => i.value);

  const statusValues = Array.from(
    document.querySelectorAll("#statusFilterGroup input:checked")
  ).map((i) => i.value);

  const owner = document.getElementById("ownerFilter").value;

  return list.filter((m) => {
    if (levelValues.length && !levelValues.includes(m.level || "L2")) {
      return false;
    }
    if (
      statusValues.length &&
      !statusValues.includes(m.status || "not-started")
    ) {
      return false;
    }
    if (owner && m.owner !== owner) {
      return false;
    }
    if (searchText) {
      const haystack = [
        m.title,
        m.category,
        m.owner,
        (m.tags || []).join(" "),
        m.notes,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchText)) return false;
    }
    return true;
  });
}

function resetFilters() {
  document.getElementById("searchText").value = "";
  document
    .querySelectorAll("#levelFilterGroup input")
    .forEach((i) => (i.checked = true));
  document
    .querySelectorAll("#statusFilterGroup input")
    .forEach((i) => (i.checked = true));
  document.getElementById("ownerFilter").value = "";
  applyFilterAndRender();
}

// ソート
function toggleSort(key) {
  if (currentSort.key === key) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.key = key;
    currentSort.asc = true;
  }
  applySort();
  renderListView();
}

function applySort() {
  const { key, asc } = currentSort;
  if (!key) return;

  const dir = asc ? 1 : -1;
  filteredMilestones.sort((a, b) => {
    if (key === "period") {
      const da = a.startDate || a.endDate || "";
      const db = b.startDate || b.endDate || "";
      return da === db ? 0 : da > db ? dir : -dir;
    }
    if (key === "status") {
      const sa = STATUS_ORDER[a.status] || 99;
      const sb = STATUS_ORDER[b.status] || 99;
      return sa === sb ? 0 : sa > sb ? dir : -dir;
    }
    const va = (a[key] || "").toString().toLowerCase();
    const vb = (b[key] || "").toString().toLowerCase();
    if (va === vb) return 0;
    return va > vb ? dir : -dir;
  });
}

// リスト表示
function renderListView() {
  const tbody = document.getElementById("listBody");
  const emptyMsg = document.getElementById("list-empty");

  tbody.innerHTML = "";

  if (!filteredMilestones.length) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  filteredMilestones.forEach((m) => {
    const tr = document.createElement("tr");
    if (m.id === selectedId) {
      tr.classList.add("selected");
    }

    tr.innerHTML = `
      <td>${m.level || ""}</td>
      <td>${escapeHtml(m.title || "")}</td>
      <td>${escapeHtml(m.category || "")}</td>
      <td>${formatPeriod(m.startDate, m.endDate)}</td>
      <td>${renderStatusBadge(m.status)}</td>
      <td>${renderPriority(m.priority)}</td>
      <td>${escapeHtml(m.owner || "")}</td>
      <td>${escapeHtml((m.tags || []).join("; "))}</td>
    `;

    tr.addEventListener("click", () => {
      selectedId = m.id;
      renderListView(); // 選択行のハイライト
      renderDetailPanel(m);
    });

    tbody.appendChild(tr);
  });

  // 選択中が消えていたら詳細クリア
  if (selectedId && !filteredMilestones.find((m) => m.id === selectedId)) {
    selectedId = null;
    clearDetailPanel();
  }
}

function formatPeriod(start, end) {
  if (!start && !end) return "";
  if (!start) return `〜 ${end}`;
  if (!end) return `${start} 〜`;
  if (start === end) return start;
  return `${start} 〜 ${end}`;
}

function renderStatusBadge(status) {
  const label = STATUS_LABELS[status] || status || "";
  const cls = status ? `badge-status ${status}` : "badge-status";
  return `<span class="${cls}">${label}</span>`;
}

function renderPriority(priority) {
  const label = PRIORITY_LABELS[priority] || "";
  let cls = "priority-low";
  if (priority === "medium") cls = "priority-medium";
  if (priority === "high") cls = "priority-high";
  return `<span class="priority-dot ${cls}"></span>${label}`;
}

// タイムライン表示
function renderTimelineView() {
  const container = document.getElementById("timeline-container");
  const emptyMsg = document.getElementById("timeline-empty");
  container.innerHTML = "";

  const list = filteredMilestones.filter((m) => m.startDate || m.endDate);
  if (!list.length) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  // 日付範囲の算出
  const dates = [];
  for (const m of list) {
    if (m.startDate) dates.push(m.startDate);
    if (m.endDate) dates.push(m.endDate);
  }
  dates.sort();
  const minDate = new Date(dates[0]);
  const maxDate = new Date(dates[dates.length - 1]);
  if (isNaN(minDate) || isNaN(maxDate)) {
    container.textContent =
      "日付形式を解釈できないため、タイムライン表示を省略します。";
    return;
  }

  // 余白（前後1か月）
  const padMonths = 1;
  const minMs = addMonths(minDate, -padMonths).getTime();
  const maxMs = addMonths(maxDate, padMonths).getTime();
  const spanMs = maxMs - minMs || 1;

  const grid = document.createElement("div");
  grid.className = "timeline-grid";

  // ---- 横軸（年月の目盛り）----
  const axis = document.createElement("div");
  axis.className = "timeline-axis";

  let tickDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (tickDate.getTime() <= maxMs) {
    const pos = ((tickDate.getTime() - minMs) / spanMs) * 100;
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = pos + "%";

    const label = document.createElement("div");
    label.className = "tick-label";
    label.textContent = `${tickDate.getFullYear()}/${
      tickDate.getMonth() + 1
    }`;
    tick.appendChild(label);

    axis.appendChild(tick);
    tickDate = addMonths(tickDate, 1);
  }

  grid.appendChild(axis);

  // ---- カテゴリごとに段を作る ----
  const rows = document.createElement("div");
  rows.className = "timeline-rows";

  const categories = Array.from(
    new Set(list.map((m) => m.category || "（未分類）"))
  );
  const rowHeight = 50; // カテゴリごとの高さ
  const baseTop = 10;   // 一番上の開始位置

  categories.forEach((cat, rowIndex) => {
    const catMs = list.filter((m) => (m.category || "（未分類）") === cat);
    const rowTop = baseTop + rowIndex * rowHeight;

    // カテゴリラベル
    const label = document.createElement("div");
    label.className = "timeline-row-label";
    label.style.top = rowTop + "px";
    label.textContent = cat;
    rows.appendChild(label);

    // 同じカテゴリ内で、バーを少しずつ縦にずらす
    // laneIndex 0〜3 をぐるぐる回すイメージ
    catMs.forEach((m, idx) => {
      const start = m.startDate
        ? new Date(m.startDate).getTime()
        : new Date(m.endDate).getTime();
      const end = m.endDate
        ? new Date(m.endDate).getTime()
        : new Date(m.startDate).getTime();
      if (isNaN(start) || isNaN(end)) return;

      const s = Math.min(start, end);
      const e = Math.max(start, end);
      const left = ((s - minMs) / spanMs) * 100;
      const width =
        ((e - s || 24 * 60 * 60 * 1000) / spanMs) * 100; // 1日分は最低幅

      const bar = document.createElement("div");
      bar.className = "timeline-bar";

      // ---- 同じカテゴリ内での縦位置調整 ----
      const laneIndex = idx % 4;          // 0,1,2,3 を周回
      const laneOffset = laneIndex * 18;   // 18pxずつずらす
      bar.style.top = rowTop + 4 + laneOffset + "px";

      bar.style.left = left + "%";
      bar.style.width = Math.max(width, 2) + "%";

      // ---- 色＆透明度（レベルで色分け + 半透明）----
      let bg = "rgba(59, 130, 246, 0.75)"; // L2
      if (m.level === "L1") bg = "rgba(239, 68, 68, 0.75)";
      if (m.level === "L3") bg = "rgba(16, 185, 129, 0.75)";
      bar.style.background = bg;
      bar.style.color = "#fff";

      bar.textContent = m.title || "(無題)";
      bar.title = `${m.title}\n${formatPeriod(m.startDate, m.endDate)}`;

      bar.addEventListener("click", () => {
        selectedId = m.id;
        renderListView(); // 行ハイライト更新
        renderDetailPanel(m);
      });

      rows.appendChild(bar);
    });
  });

  grid.appendChild(rows);
  container.appendChild(grid);
}

function addMonths(d, n) {
  const dt = new Date(d.getTime());
  dt.setMonth(dt.getMonth() + n);
  return dt;
}

// =========================
// 詳細パネル
// =========================

function renderDetailPanel(m) {
  const container = document.getElementById("detail-content");
  if (!m) {
    clearDetailPanel();
    return;
  }

  const tagsHtml = (m.tags || [])
    .map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`)
    .join("");

  container.innerHTML = `
    <div class="detail-section">
      <div class="detail-label">タイトル</div>
      <div class="detail-value"><strong>${escapeHtml(
        m.title || ""
      )}</strong></div>
    </div>
    <div class="detail-section">
      <div class="detail-label">レベル・カテゴリ</div>
      <div class="detail-value">
        ${escapeHtml(m.level || "")} / ${escapeHtml(m.category || "")}
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-label">期間</div>
      <div class="detail-value">${formatPeriod(
        m.startDate,
        m.endDate
      )}</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">状態・優先度</div>
      <div class="detail-value">
        ${renderStatusBadge(m.status)}　${renderPriority(m.priority)}
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-label">担当者</div>
      <div class="detail-value">${escapeHtml(m.owner || "")}</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">タグ</div>
      <div class="detail-value detail-tags">
        ${tagsHtml || '<span class="empty-message">タグなし</span>'}
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-label">メモ</div>
      <div class="detail-value">
        ${
          m.notes
            ? `<pre style="white-space:pre-wrap;font-family:inherit;font-size:0.88rem;">${escapeHtml(
                m.notes
              )}</pre>`
            : '<span class="empty-message">メモなし</span>'
        }
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-label">ID</div>
      <div class="detail-value"><code>${escapeHtml(m.id || "")}</code></div>
    </div>
    <div class="detail-actions">
      <button class="secondary-btn" id="btn-edit-ms">編集</button>
      <button class="secondary-btn" id="btn-duplicate-ms">複製して新規</button>
      <button class="ghost-btn" id="btn-delete-ms">削除</button>
    </div>
  `;

  document
    .getElementById("btn-edit-ms")
    .addEventListener("click", () => openModalForEdit(m));
  document
    .getElementById("btn-duplicate-ms")
    .addEventListener("click", () => duplicateMilestone(m));
  document
    .getElementById("btn-delete-ms")
    .addEventListener("click", () => deleteMilestone(m));
}

function clearDetailPanel() {
  const container = document.getElementById("detail-content");
  container.innerHTML = `
    <p class="empty-message">
      左のリストまたはタイムラインからマイルストーンを選択してください。
    </p>
  `;
}

// =========================
// モーダル関連
// =========================

function openModalForNew() {
  const modal = document.getElementById("milestone-modal");
  document.getElementById("modal-title").textContent = "新規マイルストーン";
  fillModalForm({
    id: "",
    title: "",
    level: "L2",
    category: "",
    startDate: "",
    endDate: "",
    status: "not-started",
    priority: "medium",
    owner: "",
    tags: [],
    notes: "",
  });
  modal.classList.remove("hidden");
}

function openModalForEdit(m) {
  const modal = document.getElementById("milestone-modal");
  document.getElementById("modal-title").textContent = "マイルストーン編集";
  fillModalForm(m);
  modal.classList.remove("hidden");
}

function closeModal() {
  const modal = document.getElementById("milestone-modal");
  modal.classList.add("hidden");
}

function fillModalForm(m) {
  document.getElementById("ms-id").value = m.id || "";
  document.getElementById("ms-title").value = m.title || "";
  document.getElementById("ms-level").value = m.level || "L2";
  document.getElementById("ms-category").value = m.category || "";
  document.getElementById("ms-start").value = m.startDate || "";
  document.getElementById("ms-end").value = m.endDate || "";
  document.getElementById("ms-status").value = m.status || "not-started";
  document.getElementById("ms-priority").value = m.priority || "medium";
  document.getElementById("ms-owner").value = m.owner || "";
  document.getElementById("ms-tags").value = (m.tags || []).join("; ");
  document.getElementById("ms-notes").value = m.notes || "";
}

function saveFromModal() {
  const id = document.getElementById("ms-id").value.trim();
  const title = document.getElementById("ms-title").value.trim();
  if (!title) {
    alert("タイトルは必須です。");
    return;
  }

  const ms = {
    id: id || generateId(),
    title,
    level: document.getElementById("ms-level").value || "L2",
    category: document.getElementById("ms-category").value.trim(),
    startDate: document.getElementById("ms-start").value,
    endDate: document.getElementById("ms-end").value,
    status: document.getElementById("ms-status").value || "not-started",
    priority: document.getElementById("ms-priority").value || "medium",
    owner: document.getElementById("ms-owner").value.trim(),
    tags: document
      .getElementById("ms-tags")
      .value.split(";")
      .map((t) => t.trim())
      .filter(Boolean),
    notes: document.getElementById("ms-notes").value,
  };

  const idx = milestones.findIndex((m) => m.id === ms.id);
  if (idx >= 0) {
    milestones[idx] = ms;
  } else {
    milestones.push(ms);
  }

  selectedId = ms.id;
  closeModal();
  refreshOwnerFilterOptions();
  applyFilterAndRender();
  const selected = milestones.find((m) => m.id === selectedId);
  renderDetailPanel(selected);
}

function duplicateMilestone(m) {
  const copy = { ...m, id: generateId() };
  milestones.push(copy);
  selectedId = copy.id;
  refreshOwnerFilterOptions();
  applyFilterAndRender();
  renderDetailPanel(copy);
}

function deleteMilestone(m) {
  if (!confirm("このマイルストーンを削除しますか？")) return;
  milestones = milestones.filter((x) => x.id !== m.id);
  if (selectedId === m.id) {
    selectedId = null;
  }
  refreshOwnerFilterOptions();
  applyFilterAndRender();
}

// =========================
// ユーティリティ
// =========================

function generateId() {
  return "ms-" + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll("#view-tabs .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.querySelectorAll(".view-panel").forEach((panel) =>
    panel.classList.toggle("active", panel.id === view + "-view")
  );
}

function updateFooterCount() {
  const span = document.getElementById("footer-count");
  span.textContent = `${milestones.length}件（表示中: ${filteredMilestones.length}件）`;
}

function refreshOwnerFilterOptions() {
  const select = document.getElementById("ownerFilter");
  const current = select.value;
  const owners = Array.from(
    new Set(milestones.map((m) => m.owner).filter(Boolean))
  ).sort();
  select.innerHTML = '<option value="">すべて</option>';
  owners.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    select.appendChild(opt);
  });
  if (owners.includes(current)) {
    select.value = current;
  }
}

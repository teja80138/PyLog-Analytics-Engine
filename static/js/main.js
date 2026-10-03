/**
 * PyLog-Analytics-Engine
 * Client-Side Distributed Log Analytics via Pyodide WebAssembly
 * Architecture: Vanilla JS with Native Web Components
 */

// Global Application State
const PREFS_KEY = 'pylog_prefs_v1';

const appState = {
  pyodide: null,
  isBooted: false,
  isRunning: false,
  rawSourceCodes: {},

  // User Preferences
  prefs: {
    worker_count: 4,
    line_count: 2000,
    use_stop_words: true,
    bigrams_mode: false,
    last_input_mode: 'generate'
  },

  // Active Data
  currentRawText: '',
  pipelineResult: null,
  benchmarkHistory: []
};

/* ==========================================================================
   LOCALSTORAGE PERSISTENCE
   ========================================================================== */
function loadUserPreferences() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appState.prefs = Object.assign(appState.prefs, parsed);
    }
  } catch (err) {
    console.warn('Failed to parse localStorage preferences:', err);
  }
}

function saveUserPreferences() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(appState.prefs));
  } catch (err) {
    console.warn('Failed to save preferences to localStorage:', err);
  }
}

/* ==========================================================================
   PYODIDE BOOTSTRAP ENGINE
   ========================================================================== */
// Base path detection to support both root domain and GitHub Pages subdirectories
function getBasePath() {
  const path = window.location.pathname;
  if (window.location.hostname.endsWith('github.io')) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      return '/' + segments[0];
    }
  }
  return path.replace(/\/[^/]*$/, '') || '';
}

const BASE_PATH = getBasePath();

const PIPELINE_MODULES = [
  'pipeline/stop_words.py',
  'pipeline/log_generator.py',
  'pipeline/splitter.py',
  'pipeline/mapper.py',
  'pipeline/shuffler.py',
  'pipeline/reducer.py',
  'pipeline/aggregator.py',
  'pipeline/__init__.py'
];

async function bootPyodide() {
  const bootOverlay = document.getElementById('bootOverlay');
  const bootLog = document.getElementById('bootLog');
  const bootProgressBar = document.getElementById('bootProgressBar');
  const bootStatusLine = document.getElementById('bootStatusLine');
  const bootPctText = document.getElementById('bootPctText');
  const bootErrorCard = document.getElementById('bootErrorCard');
  const bootErrorMsg = document.getElementById('bootErrorMsg');

  // Check for file:// protocol restriction
  if (window.location.protocol === 'file:') {
    bootErrorCard.style.display = 'block';
    bootErrorMsg.innerHTML = '<strong>Security Restriction:</strong> Browsers do not permit <code>fetch()</code> on <code>file://</code> URLs.<br><br>Please run the local web server from your terminal:<br><code style="color: #67e8f9; background: #0f172a; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 6px;">./run.sh</code><br><br>Then navigate to <a href="http://localhost:8080" style="color: #38bdf8; text-decoration: underline;">http://localhost:8080</a> in your browser.';
    bootStatusLine.textContent = 'Please run via ./run.sh';
    return;
  }

  function appendBootEntry(text, isDone = false) {
    const div = document.createElement('div');
    if (isDone) div.className = 'log-success-line';
    div.textContent = text;
    bootLog.appendChild(div);
    bootLog.scrollTop = bootLog.scrollHeight;
  }

  function updateProgress(stepIndex, totalSteps, statusText) {
    const pct = Math.round((stepIndex / totalSteps) * 100);
    bootProgressBar.style.width = pct + '%';
    bootPctText.textContent = pct + '%';
    bootStatusLine.textContent = statusText;
  }

  try {
    appendBootEntry('[0.05s] Initializing Pyodide WebAssembly runtime...');
    updateProgress(0, 10, 'Fetching Pyodide WASM core...');

    // Load Pyodide from pinned stable CDN
    appState.pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
    });

    appendBootEntry('[0.45s] Pyodide core online (Python 3.12).', true);
    updateProgress(1, 10, 'Pyodide core ready.');

    const totalFiles = PIPELINE_MODULES.length;

    // Fetch and execute each module sequentially
    for (let i = 0; i < totalFiles; i++) {
      const path = PIPELINE_MODULES[i];
      const filename = path.split('/').pop();
      const fetchUrl = `${BASE_PATH}/${path}`.replace(/\/+/g, '/');

      updateProgress(1 + i, 10, `Fetching ${filename}...`);
      appendBootEntry(`[${(0.6 + i * 0.1).toFixed(2)}s] Fetching ${path}...`);

      const resp = await fetch(fetchUrl);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText} while fetching ${fetchUrl}`);
      }
      const code = await resp.text();
      appState.rawSourceCodes[filename] = code;

      updateProgress(1 + i + 0.5, 10, `Executing ${filename}...`);
      await appState.pyodide.runPythonAsync(code);

      appendBootEntry(`[${(0.7 + i * 0.1).toFixed(2)}s] Executed: ${filename}`, true);
    }

    updateProgress(10, 10, 'All pipeline modules verified and loaded.');
    appendBootEntry('[1.50s] Pipeline online: splitter, mapper, shuffler, reducer, aggregator registered.', true);

    appState.isBooted = true;

    // Populate source code viewer in Export tab
    populateSourceCodeViewer();

    // Signal terminal console
    const term = document.querySelector('terminal-console');
    if (term) {
      term.terminalLog('SYS', 'PyLog Analytics Engine online (Pyodide v0.26.4).');
      term.terminalLog('SYS', 'All 8 real Python modules loaded from pipeline/ directory.');
    }

    // Update status indicators
    const pulse = document.getElementById('runtimePulse');
    if (pulse) pulse.classList.remove('loading');
    const label = document.getElementById('runtimeLabel');
    if (label) label.textContent = 'Pyodide: Ready';

    // Fade out boot overlay
    setTimeout(() => {
      bootOverlay.classList.add('hidden');
    }, 400);

  } catch (err) {
    console.error('Pyodide Boot Failure:', err);
    bootErrorCard.style.display = 'block';
    bootErrorMsg.textContent = err.message;
    bootStatusLine.textContent = 'Boot error encountered.';
  }
}

/* ==========================================================================
   WEB COMPONENT 1: <pipeline-stage-bar>
   ========================================================================== */
class PipelineStageBar extends HTMLElement {
  constructor() {
    super();
    this.stages = ['split', 'map', 'shuffle', 'reduce', 'aggregate'];
    this.stageTitles = {
      split: 'Splitter',
      map: 'Mapper',
      shuffle: 'Shuffler',
      reduce: 'Reducer',
      aggregate: 'Aggregator'
    };
    this.stageDescriptions = {
      split: 'Partition raw text lines into N worker chunks',
      map: 'map() and filter() word pairs without explicit loops',
      shuffle: 'Group pairs by key across chunks via itertools.groupby',
      reduce: 'Sum counts per key via functools.reduce',
      aggregate: 'Merge per-node frequency dicts via functools.reduce'
    };
  }

  connectedCallback() {
    this.render();
  }

  render() {
    let html = '<div class="stage-bar-wrap">';
    this.stages.forEach((id, idx) => {
      html += `
        <div id="stage-${id}" class="stage-step-card idle">
          <div class="stage-step-head">
            <span>PHASE 0${idx + 1}</span>
            <span id="stage-badge-${id}">IDLE</span>
          </div>
          <div class="stage-step-title">${this.stageTitles[id]}</div>
          <div class="stage-step-detail">${this.stageDescriptions[id]}</div>
          <div class="stage-step-footer">
            <span>Status</span>
            <span id="stage-time-${id}">0.0 ms</span>
          </div>
        </div>
      `;
      if (idx < this.stages.length - 1) {
        html += `
          <div class="stage-arrow-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        `;
      }
    });
    html += '</div>';
    this.innerHTML = html;
  }

  setStageState(stageName, state, timingMs = null, errMsg = null) {
    const card = this.querySelector(`#stage-${stageName}`);
    const badge = this.querySelector(`#stage-badge-${stageName}`);
    const timeSpan = this.querySelector(`#stage-time-${stageName}`);
    const sideDot = document.getElementById(`sideDot-${stageName}`);
    const sideState = document.getElementById(`sideState-${stageName}`);

    if (!card) return;

    card.className = `stage-step-card ${state}`;
    if (badge) badge.textContent = state.toUpperCase();

    if (sideDot) sideDot.className = `stage-dot ${state}`;
    if (sideState) {
      if (state === 'active') sideState.textContent = 'Active';
      else if (state === 'complete') sideState.textContent = 'Done';
      else if (state === 'error') sideState.textContent = 'Error';
      else sideState.textContent = 'Ready';
    }

    if (timingMs !== null && timeSpan) {
      timeSpan.textContent = `${timingMs.toFixed(1)} ms`;
    }
    if (errMsg && timeSpan) {
      timeSpan.textContent = errMsg;
    }
  }

  reset() {
    this.stages.forEach(id => this.setStageState(id, 'idle', 0.0));
  }
}
customElements.define('pipeline-stage-bar', PipelineStageBar);

/* ==========================================================================
   WEB COMPONENT 2: <worker-grid>
   ========================================================================== */
class WorkerGrid extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = '<div class="worker-card-grid" id="workerGridHost"></div>';
  }

  init(workerCount) {
    const host = this.querySelector('#workerGridHost') || this;
    host.innerHTML = '';

    for (let i = 0; i < workerCount; i++) {
      const card = document.createElement('div');
      card.id = `worker-card-${i}`;
      card.className = 'worker-node-card';
      card.style.animationDelay = `${i * 60}ms`;
      card.innerHTML = `
        <div class="worker-node-head">
          <div class="worker-node-id">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
            <span>Worker-${i + 1}</span>
          </div>
          <span id="worker-badge-${i}" class="worker-node-badge badge-idle">IDLE</span>
        </div>
        <div class="worker-metrics-grid">
          <div class="worker-mini-box">
            <div class="worker-mini-lbl">Lines Processed</div>
            <div id="worker-lines-${i}" class="worker-mini-val">0</div>
          </div>
          <div class="worker-mini-box">
            <div class="worker-mini-lbl">Tokens Emitted</div>
            <div id="worker-tokens-${i}" class="worker-mini-val">0</div>
          </div>
          <div class="worker-mini-box">
            <div class="worker-mini-lbl">Worker Latency</div>
            <div id="worker-lat-${i}" class="worker-mini-val">0.0 ms</div>
          </div>
          <div class="worker-mini-box">
            <div class="worker-mini-lbl">Partition Node</div>
            <div class="worker-mini-val" style="font-size: 10px; color: var(--text-muted);">node-0${i + 1}.local</div>
          </div>
        </div>
        <div class="worker-prog-track">
          <div id="worker-fill-${i}" class="worker-prog-fill"></div>
        </div>
      `;
      host.appendChild(card);
    }
  }

  updateWorker(index, state, lines = 0, tokens = 0, elapsedMs = 0) {
    const card = this.querySelector(`#worker-card-${index}`);
    const badge = this.querySelector(`#worker-badge-${index}`);
    const linesEl = this.querySelector(`#worker-lines-${index}`);
    const tokensEl = this.querySelector(`#worker-tokens-${index}`);
    const latEl = this.querySelector(`#worker-lat-${index}`);
    const fill = this.querySelector(`#worker-fill-${index}`);

    if (!card) return;

    card.className = `worker-node-card ${state}`;
    if (badge) {
      badge.className = `worker-node-badge badge-${state}`;
      badge.textContent = state.toUpperCase();
    }
    if (linesEl) linesEl.textContent = lines.toLocaleString();
    if (tokensEl) tokensEl.textContent = tokens.toLocaleString();
    if (latEl) latEl.textContent = `${elapsedMs.toFixed(1)} ms`;

    if (fill) {
      if (state === 'active') fill.style.width = '65%';
      else if (state === 'complete') fill.style.width = '100%';
      else fill.style.width = '0%';
    }
  }
}
customElements.define('worker-grid', WorkerGrid);

/* ==========================================================================
   WEB COMPONENT 3: <frequency-table>
   ========================================================================== */
class FrequencyTable extends HTMLElement {
  constructor() {
    super();
    this.unigrams = [];
    this.bigrams = [];
    this.activeMode = 'unigram'; // 'unigram' | 'bigram'
    this.currentPage = 1;
    this.pageSize = 25;
    this.sortCol = 'count';
    this.sortDir = 'desc';
    this.searchTerm = '';
    this.minCount = 1;
  }

  connectedCallback() {
    this.render();
    this.bindEvents();
  }

  render() {
    this.innerHTML = `
      <div class="freq-table-wrapper">
        <div class="freq-table-toolbar">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="table-search-input-wrap">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" id="freqSearchInput" placeholder="Filter token names...">
            </div>
            <div class="table-tabs-row">
              <button class="table-tab-btn active" id="tabUnigramBtn">Unigrams</button>
              <button class="table-tab-btn" id="tabBigramBtn" disabled>Bigrams</button>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px;">
            <div class="table-slider-group">
              <span>Min Count:</span>
              <input type="range" id="minCountSlider" min="1" max="100" value="1">
              <span id="minCountVal" style="font-family: var(--font-mono); color: var(--accent); min-width: 24px;">1</span>
            </div>
            <span id="tableRecordCount" style="font-family: var(--font-mono); color: var(--text-muted); font-size: 11px;">0 tokens</span>
          </div>
        </div>

        <div class="table-scroll-container">
          <table class="data-tbl">
            <thead>
              <tr>
                <th style="width: 70px;">Rank</th>
                <th class="sortable" id="thToken">Token Name</th>
                <th class="sortable" id="thCount" style="width: 110px;">Count</th>
                <th style="width: 120px;">Frequency %</th>
                <th class="tbl-bar-cell">Proportional Weight</th>
              </tr>
            </thead>
            <tbody id="freqTbody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No frequency data yet. Run pipeline to aggregate tokens.</td></tr>
            </tbody>
          </table>
        </div>

        <div class="freq-table-pagination">
          <div id="tablePageSummary">Page 1 of 1</div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button id="btnPrevPage" class="btn btn-secondary btn-sm" disabled>Previous</button>
            <span id="tablePageIndicator" style="font-family: var(--font-mono); padding: 0 4px;">1</span>
            <button id="btnNextPage" class="btn btn-secondary btn-sm" disabled>Next</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const search = this.querySelector('#freqSearchInput');
    search.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.currentPage = 1;
      this.renderTableBody();
    });

    const slider = this.querySelector('#minCountSlider');
    slider.addEventListener('input', (e) => {
      this.minCount = Number(e.target.value);
      this.querySelector('#minCountVal').textContent = e.target.value;
      this.currentPage = 1;
      this.renderTableBody();
    });

    this.querySelector('#thToken').addEventListener('click', () => {
      if (this.sortCol === 'token') {
        this.sortDir = (this.sortDir === 'asc') ? 'desc' : 'asc';
      } else {
        this.sortCol = 'token';
        this.sortDir = 'asc';
      }
      this.renderTableBody();
    });

    this.querySelector('#thCount').addEventListener('click', () => {
      if (this.sortCol === 'count') {
        this.sortDir = (this.sortDir === 'desc') ? 'asc' : 'desc';
      } else {
        this.sortCol = 'count';
        this.sortDir = 'desc';
      }
      this.renderTableBody();
    });

    this.querySelector('#btnPrevPage').addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderTableBody();
      }
    });

    this.querySelector('#btnNextPage').addEventListener('click', () => {
      this.currentPage++;
      this.renderTableBody();
    });

    this.querySelector('#tabUnigramBtn').addEventListener('click', () => {
      this.activeMode = 'unigram';
      this.querySelector('#tabUnigramBtn').classList.add('active');
      this.querySelector('#tabBigramBtn').classList.remove('active');
      this.currentPage = 1;
      this.renderTableBody();
    });

    this.querySelector('#tabBigramBtn').addEventListener('click', () => {
      if (this.bigrams.length === 0) return;
      this.activeMode = 'bigram';
      this.querySelector('#tabBigramBtn').classList.add('active');
      this.querySelector('#tabUnigramBtn').classList.remove('active');
      this.currentPage = 1;
      this.renderTableBody();
    });
  }

  setData(unigrams, bigrams = []) {
    this.unigrams = unigrams || [];
    this.bigrams = bigrams || [];
    this.currentPage = 1;

    const bigramBtn = this.querySelector('#tabBigramBtn');
    if (bigramBtn) {
      if (this.bigrams.length > 0) {
        bigramBtn.disabled = false;
        bigramBtn.title = 'View bigram consecutive pairs';
      } else {
        bigramBtn.disabled = true;
        bigramBtn.title = 'Bigram analysis was not enabled for this run';
      }
    }

    this.renderTableBody();
  }

  renderTableBody() {
    const list = this.activeMode === 'unigram' ? this.unigrams : this.bigrams;
    const totalTokens = list.reduce((acc, cur) => acc + cur[1], 0) || 1;
    const maxCount = list.length > 0 ? list[0][1] : 1;

    let filtered = list;
    if (this.minCount > 1) {
      filtered = filtered.filter(item => item[1] >= this.minCount);
    }
    if (this.searchTerm.trim()) {
      filtered = filtered.filter(item => item[0].toLowerCase().includes(this.searchTerm));
    }

    // Sort
    const sorted = [...filtered];
    if (this.sortCol === 'token') {
      sorted.sort((a, b) => this.sortDir === 'asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]));
    } else {
      sorted.sort((a, b) => this.sortDir === 'asc' ? a[1] - b[1] : b[1] - a[1]);
    }

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    if (this.currentPage > totalPages) this.currentPage = totalPages;
    if (this.currentPage < 1) this.currentPage = 1;

    const startIdx = (this.currentPage - 1) * this.pageSize;
    const pageSlice = sorted.slice(startIdx, startIdx + this.pageSize);

    const tbody = this.querySelector('#freqTbody');
    tbody.innerHTML = '';

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No token frequency records match filter criteria.</td></tr>';
    } else {
      pageSlice.forEach(([token, count], idx) => {
        const rank = startIdx + idx + 1;
        const pct = ((count / totalTokens) * 100).toFixed(2);
        const barWidth = Math.max(2, (count / maxCount) * 100).toFixed(1);

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-family: var(--font-mono); color: var(--text-muted);">${rank}</td>
          <td class="tbl-token-cell">${token}</td>
          <td style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary);">${count.toLocaleString()}</td>
          <td style="font-family: var(--font-mono); color: var(--text-muted);">${pct}%</td>
          <td class="tbl-bar-cell">
            <div class="inline-bar-wrap">
              <div class="inline-bar-fill" style="width: ${barWidth}%;"></div>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    this.querySelector('#tableRecordCount').textContent = `${total.toLocaleString()} ${this.activeMode === 'unigram' ? 'tokens' : 'bigrams'}`;
    this.querySelector('#tablePageSummary').textContent = total > 0
      ? `Showing ${startIdx + 1} to ${Math.min(startIdx + this.pageSize, total)} of ${total.toLocaleString()}`
      : '0 records';
    this.querySelector('#tablePageIndicator').textContent = `${this.currentPage} / ${totalPages}`;

    this.querySelector('#btnPrevPage').disabled = (this.currentPage <= 1);
    this.querySelector('#btnNextPage').disabled = (this.currentPage >= totalPages);
  }
}
customElements.define('frequency-table', FrequencyTable);

/* ==========================================================================
   WEB COMPONENT 4: <metrics-dashboard>
   ========================================================================== */
class MetricsDashboard extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = `
      <div class="metrics-grid-row">
        <div class="metric-card-box">
          <div class="metric-header">
            <span>Total Tokens</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
          </div>
          <div id="mTotalTokens" class="metric-big-num">0</div>
          <div class="metric-unit-lbl">Across all partitions</div>
        </div>

        <div class="metric-card-box">
          <div class="metric-header">
            <span>Unique Vocabulary</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          </div>
          <div id="mUniqueTokens" class="metric-big-num">0</div>
          <div class="metric-unit-lbl">Distinct normalized keys</div>
        </div>

        <div class="metric-card-box">
          <div class="metric-header">
            <span>Processing Time</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <div id="mProcessingTime" class="metric-big-num">0 ms</div>
          <div class="metric-unit-lbl">WASM pipeline duration</div>
        </div>

        <div class="metric-card-box">
          <div class="metric-header">
            <span>Throughput</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          </div>
          <div id="mThroughput" class="metric-big-num">0</div>
          <div class="metric-unit-lbl">Tokens per second</div>
        </div>
      </div>
    `;
  }

  setMetrics(totalTokens, uniqueTokens, processingMs, throughput) {
    this.animateNumber('mTotalTokens', totalTokens);
    this.animateNumber('mUniqueTokens', uniqueTokens);
    this.animateNumber('mProcessingTime', Math.round(processingMs), ' ms');
    this.animateNumber('mThroughput', throughput);
  }

  animateNumber(elemId, target, suffix = '') {
    const el = this.querySelector(`#${elemId}`);
    if (!el) return;
    const duration = 650;
    const start = performance.now();

    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const val = Math.floor(target * ease);
      el.textContent = `${val.toLocaleString()}${suffix}`;
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = `${target.toLocaleString()}${suffix}`;
    }
    requestAnimationFrame(step);
  }
}
customElements.define('metrics-dashboard', MetricsDashboard);

/* ==========================================================================
   WEB COMPONENT 5: <log-preview-pane>
   ========================================================================== */
class LogPreviewPane extends HTMLElement {
  constructor() {
    super();
    this.rawLines = [];
    this.filteredLines = [];
    this.activeFilter = 'ALL';
    this.currentPage = 1;
    this.pageSize = 100;
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <div class="preview-pane-box">
        <div class="preview-pane-toolbar">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">Raw Log Stream Preview</span>
            <span id="previewCounterBadge" style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">0 lines</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="mode-pill-selector" style="padding: 2px;">
              <button class="mode-pill-btn active" data-lvl="ALL">ALL</button>
              <button class="mode-pill-btn" data-lvl="INFO">INFO</button>
              <button class="mode-pill-btn" data-lvl="WARN">WARN</button>
              <button class="mode-pill-btn" data-lvl="ERROR">ERROR</button>
              <button class="mode-pill-btn" data-lvl="DEBUG">DEBUG</button>
              <button class="mode-pill-btn" data-lvl="FATAL">FATAL</button>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button id="btnPrevLogPage" class="btn btn-secondary btn-sm" disabled>Prev</button>
              <span id="logPageBadge" style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">1/1</span>
              <button id="btnNextLogPage" class="btn btn-secondary btn-sm" disabled>Next</button>
            </div>
          </div>
        </div>
        <div class="preview-code-scroll" id="logLinesContainer">
          <div style="padding: 24px; text-align: center; color: var(--text-muted);">No log lines loaded yet.</div>
        </div>
      </div>
    `;

    this.querySelectorAll('.mode-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.querySelectorAll('.mode-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.getAttribute('data-lvl');
        this.currentPage = 1;
        this.updateView();
      });
    });

    this.querySelector('#btnPrevLogPage').addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.updateView();
      }
    });

    this.querySelector('#btnNextLogPage').addEventListener('click', () => {
      this.currentPage++;
      this.updateView();
    });
  }

  setLogs(rawText) {
    this.rawLines = rawText.split('\n').filter(l => l.trim().length > 0);
    this.currentPage = 1;
    this.updateView();
  }

  updateView() {
    if (this.activeFilter === 'ALL') {
      this.filteredLines = this.rawLines;
    } else {
      const matchTag = `[${this.activeFilter}]`;
      this.filteredLines = this.rawLines.filter(l => l.includes(matchTag));
    }

    const total = this.filteredLines.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    if (this.currentPage > totalPages) this.currentPage = totalPages;
    if (this.currentPage < 1) this.currentPage = 1;

    const startIdx = (this.currentPage - 1) * this.pageSize;
    const slice = this.filteredLines.slice(startIdx, startIdx + this.pageSize);

    const container = this.querySelector('#logLinesContainer');
    container.innerHTML = '';

    if (total === 0) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">No logs matching level [${this.activeFilter}].</div>`;
    } else {
      const frag = document.createDocumentFragment();
      slice.forEach((line, idx) => {
        const lineNum = startIdx + idx + 1;
        let lvlClass = 'lvl-info';
        if (line.includes('[FATAL]')) lvlClass = 'lvl-fatal';
        else if (line.includes('[ERROR]')) lvlClass = 'lvl-error';
        else if (line.includes('[WARN]')) lvlClass = 'lvl-warn';
        else if (line.includes('[DEBUG]')) lvlClass = 'lvl-debug';

        const row = document.createElement('div');
        row.className = `log-line-item ${lvlClass}`;
        row.innerHTML = `
          <div class="log-num-gutter">${lineNum}</div>
          <div class="log-text-content">${line}</div>
        `;
        frag.appendChild(row);
      });
      container.appendChild(frag);
    }

    this.querySelector('#previewCounterBadge').textContent = total > 0
      ? `Showing lines ${startIdx + 1} to ${Math.min(startIdx + this.pageSize, total)} of ${total.toLocaleString()}`
      : '0 lines';
    this.querySelector('#logPageBadge').textContent = `${this.currentPage}/${totalPages}`;
    this.querySelector('#btnPrevLogPage').disabled = (this.currentPage <= 1);
    this.querySelector('#btnNextLogPage').disabled = (this.currentPage >= totalPages);
  }
}
customElements.define('log-preview-pane', LogPreviewPane);

/* ==========================================================================
   WEB COMPONENT 6: <terminal-console>
   ========================================================================== */
class TerminalConsole extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = `
      <div class="terminal-console-box">
        <div class="terminal-console-head">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            <span>Pipeline Event Stream Console</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer;">
              <input type="checkbox" id="chkAutoScroll" checked style="accent-color: var(--accent);">
              <span>Auto-scroll</span>
            </label>
            <button id="btnClearTerm" class="btn btn-secondary btn-sm">Clear</button>
            <button id="btnCopyTerm" class="btn btn-secondary btn-sm">Copy Logs</button>
          </div>
        </div>
        <div class="terminal-console-body" id="termBody"></div>
      </div>
    `;

    this.querySelector('#btnClearTerm').addEventListener('click', () => {
      this.querySelector('#termBody').innerHTML = '';
    });

    this.querySelector('#btnCopyTerm').addEventListener('click', () => {
      const text = Array.from(this.querySelectorAll('.term-entry')).map(r => r.innerText).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        alert('Console logs copied to clipboard.');
      });
    });
  }

  terminalLog(phase, message, level = 'info') {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

    const body = this.querySelector('#termBody');
    if (!body) return;

    const row = document.createElement('div');
    row.className = 'term-entry';

    let phaseColor = 'var(--accent)';
    if (phase === 'SYS') phaseColor = 'var(--level-info)';
    else if (phase === 'STAGE') phaseColor = 'var(--color-purple, #8b5cf6)';
    else if (phase === 'WORKER') phaseColor = 'var(--accent)';
    else if (phase === 'REDUCE') phaseColor = 'var(--level-warn)';
    else if (phase === 'SUCCESS') phaseColor = 'var(--success)';
    else if (phase === 'ERROR') phaseColor = 'var(--level-error)';

    row.innerHTML = `
      <span class="term-time">[${ts}]</span>
      <span class="term-phase" style="color: ${phaseColor};">[${phase}]</span>
      <span class="term-msg">${message}</span>
    `;

    body.appendChild(row);

    const autoScroll = this.querySelector('#chkAutoScroll');
    if (autoScroll && autoScroll.checked) {
      body.scrollTop = body.scrollHeight;
    }
  }
}
customElements.define('terminal-console', TerminalConsole);

/* ==========================================================================
   WEB COMPONENT 7: <css-bar-chart>
   ========================================================================== */
class CssBarChart extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = `
      <div class="bar-chart-card">
        <div class="card-header-row" style="margin-bottom: 2px;">
          <div>
            <div class="card-title-text">Top 20 Frequent Log Tokens</div>
            <div class="card-desc-text">Proportional horizontal distribution rendered in pure CSS</div>
          </div>
        </div>
        <div class="pure-css-chart" id="pureCssChartHost">
          <div style="color: var(--text-muted); font-size: 12px;">Run pipeline to render top tokens.</div>
        </div>
      </div>
    `;
  }

  setData(unigrams) {
    const host = this.querySelector('#pureCssChartHost');
    host.innerHTML = '';

    if (!unigrams || unigrams.length === 0) {
      host.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">No tokens available to display.</div>';
      return;
    }

    const top20 = unigrams.slice(0, 20);
    const maxVal = top20[0][1];
    const total = unigrams.reduce((acc, cur) => acc + cur[1], 0) || 1;

    top20.forEach(([token, count], idx) => {
      const pct = ((count / total) * 100).toFixed(2);
      const widthPct = ((count / maxVal) * 100).toFixed(1);

      const row = document.createElement('div');
      row.className = 'chart-bar-row';
      row.title = `Click to filter frequency table to "${token}"`;
      row.innerHTML = `
        <div class="chart-bar-label">#${idx + 1} ${token}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" id="cssBar-${idx}" style="width: 0%;"></div>
        </div>
        <div class="chart-bar-val">${count.toLocaleString()} (${pct}%)</div>
      `;

      row.addEventListener('click', () => {
        const table = document.querySelector('frequency-table');
        if (table) {
          const searchInput = table.querySelector('#freqSearchInput');
          if (searchInput) {
            searchInput.value = token;
            searchInput.dispatchEvent(new Event('input'));
          }
        }
      });

      host.appendChild(row);

      // Trigger staggered CSS transition animation
      setTimeout(() => {
        const fill = this.querySelector(`#cssBar-${idx}`);
        if (fill) fill.style.width = `${widthPct}%`;
      }, 40 + idx * 25);
    });
  }
}
customElements.define('css-bar-chart', CssBarChart);

/* ==========================================================================
   WEB COMPONENT 8: <timeline-sparkline>
   ========================================================================== */
class TimelineSparkline extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.innerHTML = `
      <div class="sparkline-box">
        <div class="card-header-row" style="margin-bottom: 0;">
          <div>
            <div class="card-title-text">Chronological Log Volume Distribution</div>
            <div class="card-desc-text">Timestamps bucketed minute-by-minute rendered via proportional CSS column heights</div>
          </div>
          <span id="sparklineBucketBadge" style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">0 buckets</span>
        </div>
        <div class="sparkline-columns-row" id="sparklineColumnsHost">
          <div style="color: var(--text-muted); font-size: 11px; align-self: center;">No timeline events parsed yet.</div>
        </div>
        <div class="sparkline-time-labels">
          <span id="sparkStartLbl">Start</span>
          <span id="sparkMidLbl">Timeline Volume</span>
          <span id="sparkEndLbl">End</span>
        </div>
      </div>
    `;
  }

  setData(timeline) {
    const host = this.querySelector('#sparklineColumnsHost');
    host.innerHTML = '';

    if (!timeline || timeline.length === 0) {
      host.innerHTML = '<div style="color: var(--text-muted); font-size: 11px; align-self: center;">No timeline events parsed.</div>';
      return;
    }

    this.querySelector('#sparklineBucketBadge').textContent = `${timeline.length} minute buckets`;
    this.querySelector('#sparkStartLbl').textContent = timeline[0][0];
    this.querySelector('#sparkMidLbl').textContent = `${timeline.length} Minutes Duration`;
    this.querySelector('#sparkEndLbl').textContent = timeline[timeline.length - 1][0];

    const maxCount = Math.max(...timeline.map(item => item[1])) || 1;

    timeline.forEach(([bucket, count]) => {
      const heightPct = Math.max(10, (count / maxCount) * 100);

      const col = document.createElement('div');
      col.className = 'sparkline-column-wrap';
      col.title = `Minute: ${bucket} : Volume: ${count} log lines`;

      const bar = document.createElement('div');
      bar.className = 'sparkline-bar-pill';
      bar.style.height = `${heightPct}%`;

      col.appendChild(bar);
      host.appendChild(col);
    });
  }
}
customElements.define('timeline-sparkline', TimelineSparkline);

/* ==========================================================================
   SOURCE CODE VIEWER FOR EXPORT PANEL
   ========================================================================== */
function populateSourceCodeViewer() {
  const tabsList = document.getElementById('sourceTabsList');
  const codePre = document.getElementById('sourceCodePre');
  const copyBtn = document.getElementById('btnCopyCurrentSource');

  if (!tabsList || !codePre) return;
  tabsList.innerHTML = '';

  const filenames = Object.keys(appState.rawSourceCodes);
  if (filenames.length === 0) {
    codePre.textContent = 'No Python modules loaded.';
    return;
  }

  let activeFile = filenames[0];

  filenames.forEach((fn, idx) => {
    const btn = document.createElement('button');
    btn.className = `source-tab-btn ${idx === 0 ? 'active' : ''}`;
    btn.textContent = fn;
    btn.addEventListener('click', () => {
      tabsList.querySelectorAll('.source-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFile = fn;
      codePre.textContent = appState.rawSourceCodes[fn];
    });
    tabsList.appendChild(btn);
  });

  codePre.textContent = appState.rawSourceCodes[activeFile];

  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(appState.rawSourceCodes[activeFile]).then(() => {
        alert(`Copied ${activeFile} to clipboard.`);
      });
    };
  }
}

/* ==========================================================================
   PIPELINE EXECUTION ORCHESTRATION
   ========================================================================== */
async function runDistributedPipeline() {
  if (!appState.isBooted) {
    alert('Pyodide runtime is initializing. Please wait a moment.');
    return;
  }
  if (appState.isRunning) return;

  const rawText = appState.currentRawText.trim();
  if (!rawText) {
    alert('No log text available. Please generate or paste logs first.');
    return;
  }

  appState.isRunning = true;
  document.getElementById('btnRunHeader').disabled = true;

  const stageBar = document.querySelector('pipeline-stage-bar');
  const workerGrid = document.querySelector('worker-grid');
  const term = document.querySelector('terminal-console');

  // Switch to Pipeline tab
  switchTab('panel-pipeline');

  stageBar.reset();
  const workerCount = appState.prefs.worker_count;
  workerGrid.init(workerCount);

  term.terminalLog('STAGE', `Initiating MapReduce pipeline across ${workerCount} worker partitions.`);

  const pipelineStart = performance.now();

  try {
    // -------------------------------------------------------------
    // Phase 1: Splitter
    // -------------------------------------------------------------
    stageBar.setStageState('split', 'active');
    term.terminalLog('STAGE', `Splitter: Partitioning lines into ${workerCount} worker chunks via itertools.islice.`);
    await new Promise(r => setTimeout(r, 60)); // Yield to UI

    appState.pyodide.globals.set('CURRENT_RAW_TEXT', rawText);
    appState.pyodide.globals.set('CURRENT_NUM_WORKERS', workerCount);
    appState.pyodide.globals.set('USE_STOP_WORDS', appState.prefs.use_stop_words);
    appState.pyodide.globals.set('USE_BIGRAMS', appState.prefs.bigrams_mode);

    const tSplit0 = performance.now();
    await appState.pyodide.runPythonAsync(`
SPLITTER_RES = splitter(CURRENT_RAW_TEXT, CURRENT_NUM_WORKERS)
    `);
    const splitMs = performance.now() - tSplit0;
    stageBar.setStageState('split', 'complete', splitMs);
    term.terminalLog('SUCCESS', `Splitter complete in ${splitMs.toFixed(1)} ms.`);

    // -------------------------------------------------------------
    // Phase 2: Mapper (Simulate sequential worker execution with timings)
    // -------------------------------------------------------------
    stageBar.setStageState('map', 'active');
    term.terminalLog('STAGE', `Mapper: Tokenizing and filtering with map() across ${workerCount} nodes.`);

    await appState.pyodide.runPythonAsync(`
STOPS_OBJ = STOP_WORDS if USE_STOP_WORDS else None
WORKER_RESULTS = []
    `);

    for (let i = 0; i < workerCount; i++) {
      workerGrid.updateWorker(i, 'active', 0, 0, 0);
      term.terminalLog('WORKER', `Worker-${i + 1} processing partition ${i + 1}/${workerCount}...`);
      await new Promise(r => setTimeout(r, 40));

      await appState.pyodide.runPythonAsync(`
w_input = SPLITTER_RES[${i}]
w_res = mapper(w_input, stop_words=STOPS_OBJ, bigrams=USE_BIGRAMS)
WORKER_RESULTS.append(w_res)
      `);

      const wResProxy = appState.pyodide.globals.get('w_res');
      const wRes = wResProxy.toJs({ dict_converter: Object.fromEntries });
      if (wResProxy && typeof wResProxy.destroy === 'function') {
        wResProxy.destroy();
      }

      const unigramCount = wRes.unigrams ? (Array.isArray(wRes.unigrams) ? wRes.unigrams.length : Object.keys(wRes.unigrams).length) : 0;
      workerGrid.updateWorker(i, 'complete', unigramCount, wRes.token_count || 0, wRes.elapsed_ms || 0);
      term.terminalLog('WORKER', `Worker-${i + 1} emitted ${wRes.token_count || 0} tokens in ${(wRes.elapsed_ms || 0).toFixed(1)} ms.`);
    }

    stageBar.setStageState('map', 'complete', performance.now() - pipelineStart);
    term.terminalLog('SUCCESS', 'Mapper phase complete across all worker partitions.');

    // -------------------------------------------------------------
    // Phase 3: Shuffler
    // -------------------------------------------------------------
    stageBar.setStageState('shuffle', 'active');
    term.terminalLog('STAGE', 'Shuffler: Grouping pairs by key across worker partitions via itertools.groupby.');
    await new Promise(r => setTimeout(r, 60));

    const tShuf0 = performance.now();
    await appState.pyodide.runPythonAsync(`
SHUFFLER_INPUT = [{"pairs": w["unigrams"]} for w in WORKER_RESULTS]
SHUFFLED_RES = shuffler(SHUFFLER_INPUT)
    `);
    const shufMs = performance.now() - tShuf0;
    stageBar.setStageState('shuffle', 'complete', shufMs);
    term.terminalLog('SUCCESS', `Shuffler complete in ${shufMs.toFixed(1)} ms.`);

    // -------------------------------------------------------------
    // Phase 4: Reducer
    // -------------------------------------------------------------
    stageBar.setStageState('reduce', 'active');
    term.terminalLog('REDUCE', 'Reducer: Summing counts per key via functools.reduce.');
    await new Promise(r => setTimeout(r, 60));

    const tRed0 = performance.now();
    await appState.pyodide.runPythonAsync(`
REDUCED_RES = reducer(SHUFFLED_RES)
    `);
    const redMs = performance.now() - tRed0;
    stageBar.setStageState('reduce', 'complete', redMs);
    term.terminalLog('SUCCESS', `Reducer complete in ${redMs.toFixed(1)} ms.`);

    // -------------------------------------------------------------
    // Phase 5: Aggregator & Full Run Pipeline Orchestration
    // -------------------------------------------------------------
    stageBar.setStageState('aggregate', 'active');
    term.terminalLog('STAGE', 'Aggregator: Merging per-node dicts via functools.reduce.');
    await new Promise(r => setTimeout(r, 60));

    const tAgg0 = performance.now();
    await appState.pyodide.runPythonAsync(`
# Execute full orchestrator to build complete result payload
PIPELINE_FINAL_RESULT = run_pipeline(
    raw_text=CURRENT_RAW_TEXT,
    num_workers=CURRENT_NUM_WORKERS,
    use_stop_words=USE_STOP_WORDS,
    bigrams=USE_BIGRAMS
)
    `);
    const aggMs = performance.now() - tAgg0;
    stageBar.setStageState('aggregate', 'complete', aggMs);

    // Retrieve results into JS
    const finalProxy = appState.pyodide.globals.get('PIPELINE_FINAL_RESULT');
    const result = finalProxy.toJs({ dict_converter: Object.fromEntries });
    finalProxy.destroy();

    const totalTimeMs = performance.now() - pipelineStart;
    appState.pipelineResult = result;

    term.terminalLog('SUCCESS', `Pipeline execution completed in ${totalTimeMs.toFixed(1)} ms! Total tokens: ${result.total_tokens.toLocaleString()}.`);

    // Record Benchmark
    recordBenchmarkRun(workerCount, result.total_lines, result.total_tokens, totalTimeMs);

    // Update Results UI
    renderResultsPanel(result, totalTimeMs);

    // Switch to Results Tab after small pause
    await new Promise(r => setTimeout(r, 300));
    switchTab('panel-results');

  } catch (err) {
    console.error('Pipeline execution error:', err);
    stageBar.setStageState('map', 'error', null, err.message);
    term.terminalLog('ERROR', `Pipeline error: ${err.message}`);
  } finally {
    appState.isRunning = false;
    document.getElementById('btnRunHeader').disabled = false;
  }
}

/* ==========================================================================
   RESULTS PANEL RENDERING
   ========================================================================== */
function renderResultsPanel(result, totalTimeMs) {
  const metrics = document.querySelector('metrics-dashboard');
  const table = document.querySelector('frequency-table');
  const chart = document.querySelector('css-bar-chart');
  const sparkline = document.querySelector('timeline-sparkline');

  const throughput = totalTimeMs > 0 ? Math.floor(result.total_tokens / (totalTimeMs / 1000)) : 0;

  if (metrics) {
    metrics.setMetrics(result.total_tokens, result.unique_tokens, totalTimeMs, throughput);
  }

  if (table) {
    table.setData(result.frequency, result.bigrams);
  }

  if (chart) {
    chart.setData(result.frequency);
  }

  if (sparkline) {
    sparkline.setData(result.timeline);
  }

  // Populate per-service dropdown
  renderServiceFilter(result.by_service);
}

function renderServiceFilter(byService) {
  const select = document.getElementById('selectServiceFilter');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="ALL">All Services Combined</option>';

  if (byService) {
    Object.keys(byService).forEach(svc => {
      const opt = document.createElement('option');
      opt.value = svc;
      opt.textContent = `${svc} (${byService[svc].length} tokens)`;
      select.appendChild(opt);
    });
  }

  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }

  select.onchange = () => {
    const chosen = select.value;
    const table = document.querySelector('frequency-table');
    const chart = document.querySelector('css-bar-chart');

    if (chosen === 'ALL') {
      table.setData(appState.pipelineResult.frequency, appState.pipelineResult.bigrams);
      chart.setData(appState.pipelineResult.frequency);
    } else if (byService && byService[chosen]) {
      const svcTokens = byService[chosen];
      table.setData(svcTokens, []);
      chart.setData(svcTokens);
    }
  };
}

/* ==========================================================================
   WORKER BENCHMARK COMPARISON TABLE
   ========================================================================== */
function recordBenchmarkRun(workerCount, totalLines, totalTokens, totalMs) {
  const throughput = totalMs > 0 ? Math.floor(totalTokens / (totalMs / 1000)) : 0;
  const runId = `RUN-${appState.benchmarkHistory.length + 1}`;

  let deltaStr = 'Baseline';
  if (appState.benchmarkHistory.length > 0) {
    const prev = appState.benchmarkHistory[appState.benchmarkHistory.length - 1];
    const diff = totalMs - prev.totalMs;
    const pct = ((diff / prev.totalMs) * 100).toFixed(1);
    if (diff < 0) {
      deltaStr = `<span style="color: var(--success);">${Math.abs(pct)}% faster</span>`;
    } else {
      deltaStr = `<span style="color: var(--level-warn);">${pct}% slower</span>`;
    }
  }

  appState.benchmarkHistory.push({
    runId,
    workerCount,
    totalLines,
    totalTokens,
    totalMs,
    throughput,
    deltaStr
  });

  const tbody = document.getElementById('benchmarkTbody');
  if (!tbody) return;

  if (appState.benchmarkHistory.length === 1) {
    tbody.innerHTML = '';
  }

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="font-family: var(--font-mono); font-weight: 600; color: var(--accent);">${runId}</td>
    <td style="font-family: var(--font-mono);">${workerCount} Nodes</td>
    <td style="font-family: var(--font-mono);">${totalLines.toLocaleString()}</td>
    <td style="font-family: var(--font-mono);">${totalTokens.toLocaleString()}</td>
    <td style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary);">${totalMs.toFixed(1)} ms</td>
    <td style="font-family: var(--font-mono);">${throughput.toLocaleString()}</td>
    <td style="font-family: var(--font-mono);">${deltaStr}</td>
  `;
  tbody.appendChild(tr);
}

/* ==========================================================================
   EXPORT ACTIONS (CSV, JSON, TSV, CODE)
   ========================================================================== */
function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCSV() {
  if (!appState.pipelineResult || !appState.pipelineResult.frequency) {
    alert('No pipeline results available to export. Run the pipeline first.');
    return;
  }
  const freq = appState.pipelineResult.frequency;
  const total = appState.pipelineResult.total_tokens || 1;

  let csv = 'Rank,Token,Count,Frequency_Percent\n';
  freq.forEach(([token, count], idx) => {
    const pct = ((count / total) * 100).toFixed(4);
    csv += `${idx + 1},"${token.replace(/"/g, '""')}",${count},${pct}\n`;
  });
  downloadBlob('pylog_word_frequencies.csv', csv, 'text/csv;charset=utf-8;');
}

function exportJSON() {
  if (!appState.pipelineResult) {
    alert('No pipeline results available to export. Run the pipeline first.');
    return;
  }
  const jsonStr = JSON.stringify(appState.pipelineResult, null, 2);
  downloadBlob('pylog_analysis_results.json', jsonStr, 'application/json');
}

function copyTSV() {
  if (!appState.pipelineResult || !appState.pipelineResult.frequency) {
    alert('No frequency results available to copy.');
    return;
  }
  const freq = appState.pipelineResult.frequency;
  const total = appState.pipelineResult.total_tokens || 1;

  let tsv = 'Rank\tToken\tCount\tFrequency_Percent\n';
  freq.forEach(([token, count], idx) => {
    const pct = ((count / total) * 100).toFixed(4);
    tsv += `${idx + 1}\t${token}\t${count}\t${pct}\n`;
  });
  navigator.clipboard.writeText(tsv).then(() => {
    alert('Frequency table copied to clipboard as TSV.');
  });
}

/* ==========================================================================
   NAVIGATION & UI EVENT BINDINGS
   ========================================================================== */
function switchTab(targetId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(targetId);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === targetId);
  });

  const titles = {
    'panel-input': 'Input and Ingestion',
    'panel-pipeline': 'Distributed Pipeline and Workers',
    'panel-results': 'Results and Analytics Dashboard',
    'panel-export': 'Export and Pipeline Source'
  };
  const titleEl = document.getElementById('pageTitleText');
  if (titleEl) titleEl.textContent = titles[targetId] || 'PyLog Engine';
}

async function generateLogs() {
  if (!appState.isBooted) return;
  const lineCount = appState.prefs.line_count;
  const term = document.querySelector('terminal-console');

  if (term) term.terminalLog('SYS', `Generating ${lineCount.toLocaleString()} procedural log lines...`);

  const seed = (Date.now() + Math.floor(Math.random() * 10000)) % 100000;
  await appState.pyodide.runPythonAsync(`
import time
GENERATED_LOGS = generate_logs(${lineCount}, seed=${seed})
  `);

  const logsVal = appState.pyodide.globals.get('GENERATED_LOGS');
  const logsText = (logsVal !== undefined && logsVal !== null) ? (typeof logsVal.toString === 'function' ? logsVal.toString() : String(logsVal)) : '';
  if (logsVal && typeof logsVal.destroy === 'function') {
    logsVal.destroy();
  }

  appState.currentRawText = logsText;

  const preview = document.querySelector('log-preview-pane');
  if (preview) preview.setLogs(logsText);

  if (term) term.terminalLog('SYS', `Generated ${lineCount.toLocaleString()} lines successfully.`);
}

document.addEventListener('DOMContentLoaded', () => {
  loadUserPreferences();

  // Navigation Tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Header Actions
  document.getElementById('btnRunHeader').addEventListener('click', async () => {
    if (!appState.currentRawText || !appState.currentRawText.trim()) {
      await generateLogs();
    }
    await runDistributedPipeline();
  });
  document.getElementById('btnResetHeader').addEventListener('click', () => {
    if (confirm('Reset pipeline execution and clear current logs?')) {
      generateLogs();
      const stageBar = document.querySelector('pipeline-stage-bar');
      if (stageBar) stageBar.reset();
      const table = document.querySelector('frequency-table');
      if (table) table.setData([], []);
      const chart = document.querySelector('css-bar-chart');
      if (chart) chart.setData([]);
    }
  });

  // Input Mode Pill Selector
  const modePills = document.querySelectorAll('.mode-pill-btn[data-mode]');
  const modeGen = document.getElementById('modeSectionGen');
  const modePaste = document.getElementById('modeSectionPaste');
  const modeUpload = document.getElementById('modeSectionUpload');

  function setInputMode(mode) {
    modePills.forEach(p => p.classList.toggle('active', p.getAttribute('data-mode') === mode));
    if (modeGen) modeGen.style.display = (mode === 'generate') ? 'block' : 'none';
    if (modePaste) modePaste.style.display = (mode === 'paste') ? 'block' : 'none';
    if (modeUpload) modeUpload.style.display = (mode === 'upload') ? 'block' : 'none';
    appState.prefs.last_input_mode = mode;
    saveUserPreferences();
  }

  modePills.forEach(p => {
    p.addEventListener('click', () => setInputMode(p.getAttribute('data-mode')));
  });

  // Apply saved input mode
  setInputMode(appState.prefs.last_input_mode || 'generate');

  // Generator Controls
  const lineCountSelect = document.getElementById('lineCountSelect');
  const customLineWrap = document.getElementById('customLineWrap');
  const customLineInput = document.getElementById('customLineInput');

  if (lineCountSelect) {
    if ([500, 2000, 10000].includes(appState.prefs.line_count)) {
      lineCountSelect.value = String(appState.prefs.line_count);
      customLineWrap.style.display = 'none';
    } else {
      lineCountSelect.value = 'custom';
      customLineWrap.style.display = 'block';
      customLineInput.value = appState.prefs.line_count;
    }

    lineCountSelect.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        customLineWrap.style.display = 'block';
        appState.prefs.line_count = Number(customLineInput.value) || 2000;
      } else {
        customLineWrap.style.display = 'none';
        appState.prefs.line_count = Number(e.target.value);
      }
      saveUserPreferences();
    });

    customLineInput.addEventListener('input', (e) => {
      const val = Math.max(100, Math.min(50000, Number(e.target.value) || 100));
      appState.prefs.line_count = val;
      saveUserPreferences();
    });
  }

  // Worker Count Slider
  const workerSlider = document.getElementById('workerSlider');
  const workerSliderVal = document.getElementById('workerSliderVal');
  if (workerSlider) {
    workerSlider.value = appState.prefs.worker_count;
    workerSliderVal.textContent = `${appState.prefs.worker_count} Nodes`;
    document.getElementById('workerCountSidebar').textContent = `${appState.prefs.worker_count} Nodes`;

    workerSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      appState.prefs.worker_count = val;
      workerSliderVal.textContent = `${val} Nodes`;
      document.getElementById('workerCountSidebar').textContent = `${val} Nodes`;
      saveUserPreferences();
    });
  }

  // Toggles
  const chkStopWords = document.getElementById('chkStopWords');
  if (chkStopWords) {
    chkStopWords.checked = appState.prefs.use_stop_words;
    chkStopWords.addEventListener('change', (e) => {
      appState.prefs.use_stop_words = e.target.checked;
      saveUserPreferences();
    });
  }

  const chkBigrams = document.getElementById('chkBigrams');
  if (chkBigrams) {
    chkBigrams.checked = appState.prefs.bigrams_mode;
    chkBigrams.addEventListener('change', (e) => {
      appState.prefs.bigrams_mode = e.target.checked;
      saveUserPreferences();
    });
  }

  // Generator Action Buttons
  document.getElementById('btnGenOnly').addEventListener('click', generateLogs);
  document.getElementById('btnGenAndRun').addEventListener('click', async () => {
    await generateLogs();
    await runDistributedPipeline();
  });

  // Paste Mode Textarea
  const pasteArea = document.getElementById('pasteTextarea');
  const pasteStats = document.getElementById('pasteStatsText');
  if (pasteArea) {
    pasteArea.addEventListener('input', () => {
      const text = pasteArea.value;
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      pasteStats.textContent = `${lines.length.toLocaleString()} lines, ${text.length.toLocaleString()} characters`;
    });

    document.getElementById('btnPasteRun').addEventListener('click', async () => {
      const text = pasteArea.value.trim();
      if (!text) {
        alert('Please paste some log lines first.');
        return;
      }
      appState.currentRawText = text;
      const preview = document.querySelector('log-preview-pane');
      if (preview) preview.setLogs(text);
      await runDistributedPipeline();
    });
  }

  // Upload Mode
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('fileInputElem');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    function handleFile(file) {
      if (!file.name.endsWith('.log') && !file.name.endsWith('.txt')) {
        alert('Only .log and .txt files are supported.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        appState.currentRawText = text;
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        document.getElementById('uploadFileName').textContent = file.name;
        document.getElementById('uploadFileSize').textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('uploadLineCount').textContent = `${lines.length.toLocaleString()} lines`;
        document.getElementById('uploadFileInfoCard').style.display = 'flex';

        const preview = document.querySelector('log-preview-pane');
        if (preview) preview.setLogs(text);
      };
      reader.readAsText(file);
    }

    document.getElementById('btnUploadRun').addEventListener('click', async () => {
      if (!appState.currentRawText) {
        alert('Please drop or select a log file first.');
        return;
      }
      await runDistributedPipeline();
    });
  }

  // Export Buttons
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
  document.getElementById('btnCopyTSV').addEventListener('click', copyTSV);

  // Clear Benchmarks
  document.getElementById('btnClearBenchmarks').addEventListener('click', () => {
    appState.benchmarkHistory = [];
    const tbody = document.getElementById('benchmarkTbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 16px;">History cleared. Run the pipeline to record benchmarks.</td></tr>';
    }
  });

  // Boot Pyodide
  bootPyodide().then(() => {
    generateLogs();
  });
});

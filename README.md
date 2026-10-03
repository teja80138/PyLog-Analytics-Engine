# PyLog-Analytics-Engine

Distributed In-Browser Log Analytics Engine via Pyodide WebAssembly

---

## 1. Project Statement

Build a browser-based distributed log word-count aggregator that simulates a map-reduce style pipeline to aggregate word and event frequencies across large distributed log files. The system must demonstrate divide-and-conquer partitioning, parallel map phases, merge/reduce phases, and functional programming constructs : all executed in-browser via Pyodide with no backend.

---

## 2. Frontend Choice

PyLog-Analytics-Engine is implemented using pure Vanilla JavaScript and standard Web Components (`customElements.define`).

Key architectural advantages:
- Zero build tools required: No Vite, Webpack, Babel, or npm compilation steps. The project runs directly in any modern web browser.
- Native encapsulation: Each custom component (`<pipeline-stage-bar>`, `<worker-grid>`, `<frequency-table>`, `<metrics-dashboard>`, `<log-preview-pane>`, `<terminal-console>`, `<css-bar-chart>`, `<timeline-sparkline>`) is a standalone ES class inheriting from `HTMLElement`.
- Lightweight footprint: No runtime overhead from React, Vue, or Angular virtual DOM reconcilers, allowing Pyodide WebAssembly to command full browser CPU and memory bandwidth.
- Static hosting ready: Completely compatible with GitHub Pages and static web servers.

---

## 3. Architecture

All Python MapReduce pipeline logic is written in real `.py` files inside the `pipeline/` directory. At runtime, the client dashboard shell fetches each script over HTTP and executes it inside the Pyodide WebAssembly kernel.

```
+-----------------------------------------------------------------------+
| Browser Client (GitHub Pages / Localhost)                            |
|                                                                       |
|  +--------------------+      HTTP GET        +---------------------+  |
|  | index.html         | -------------------> | pipeline/           |  |
|  | (Dashboard Shell)  | <------------------- |  - stop_words.py    |  |
|  +--------------------+      Fetch .py       |  - log_generator.py |  |
|            |                 Source Text     |  - splitter.py      |  |
|            v                                 |  - mapper.py        |  |
|  +--------------------+                      |  - shuffler.py      |  |
|  | Pyodide WASM v0.26 |                      |  - reducer.py       |  |
|  | Python 3.12 Engine |                      |  - aggregator.py    |  |
|  +--------------------+                      |  - __init__.py      |  |
|            |                                 +---------------------+  |
|            | In-Memory Functional MapReduce                           |
|            v                                                          |
|  +-----------------------------------------------------------------+  |
|  | Splitter -> Mapper -> Shuffler -> Reducer -> Aggregator         |  |
|  +-----------------------------------------------------------------+  |
|            |                                                          |
|            v JS Web Components Update                                 |
|  +-----------------------------------------------------------------+  |
|  | StageBar | WorkerGrid | Metrics | FrequencyTable | Sparkline    |  |
|  +-----------------------------------------------------------------+  |
+-----------------------------------------------------------------------+
```

---

## 4. Pipeline Phases

1. Splitter (`pipeline/splitter.py`):
   Partitions raw log text into N worker chunks using a list comprehension and `itertools.islice`. Empty lines are stripped, and each worker is assigned a partition dictionary with line count metadata.

2. Mapper (`pipeline/mapper.py`):
   Processes each worker partition independently without explicit `for` loops. Tokenizes lines via regex, normalizes to lowercase, filters stop words using Python's functional `filter()`, and emits `(token, 1)` pairs using `map()`. When bigram mode is enabled, consecutive pairs are generated using `zip(tokens, tokens[1:])`.

3. Shuffler (`pipeline/shuffler.py`):
   Collects all emitted pairs across worker partitions via `itertools.chain.from_iterable`. The pairs are sorted by key and grouped using `itertools.groupby` to produce a grouped dictionary of key-value lists.

4. Reducer (`pipeline/reducer.py`):
   Sums the count values for each distinct key using `functools.reduce(lambda a, b: a + b, values, 0)`. The reduction is applied across keys using `map()` over dictionary items, returning a sorted list of `(token, count)` tuples.

5. Aggregator (`pipeline/aggregator.py`):
   Simulates multi-node merge by reducing a list of per-node frequency dictionaries into a unified distribution using `functools.reduce` over the dictionary list.

---

## 5. Running Locally

First, run the automated setup script to verify your environment and test suite:

```bash
./set_up.sh
```

Then, launch the local WebAssembly application server:

```bash
./run.sh
```

Or manually:

```bash
python3 -m http.server 8080
```

Then open your browser to:
```text
http://localhost:8080
```

---

## 6. Running Tests

Run the full pytest suite via `./set_up.sh` or directly:

```bash
pytest tests/ -v
```

The unit test suite validates:
- Partition chunk sizes and empty input handling in `splitter.py`
- Tokenization, stop-word filtering, and AST verification that zero `For` loop nodes exist in `mapper.py`
- Grouping correctness in `shuffler.py`
- Aggregation and sorting in `reducer.py` and `aggregator.py`
- Line format regex and level distribution weights in `log_generator.py`
- Full end-to-end execution of `run_pipeline()`

---

## 7. Deploying

GitHub Actions automatically validates and deploys the project on every push to `main`:

1. Commit and push your changes to branch `main`.
2. The `.github/workflows/deploy.yml` workflow triggers:
   - Validates HTML5 structure via `html5validator`
   - Enforces zero emojis in `*.html`, `*.js`, and `*.css`
   - Enforces zero unicode em dashes in `*.html` and `*.js`
   - Runs `pytest tests/ -v`
3. On passing all validation checks, deploys the root directory and `pipeline/*.py` files to GitHub Pages.

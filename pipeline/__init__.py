"""PyLog Analytics Engine: Distributed Map-Reduce Log Pipeline."""

import functools
import itertools
import re
import time

try:
    from .splitter import splitter
    from .mapper import mapper
    from .shuffler import shuffler
    from .reducer import reducer
    from .aggregator import aggregator
    from .stop_words import STOP_WORDS
    from .log_generator import generate_logs
except (ImportError, ValueError):
    # In Pyodide __main__ scope, modules are executed sequentially into globals
    pass

TIMESTAMP_RE = re.compile(r'^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}):\d{2}\]')
SERVICE_MATCH_RE = re.compile(r'^\[[^\]]+\]\s*\[[^\]]+\]\s*\[([a-zA-Z0-9_\-]+)\]')


def run_pipeline(
    raw_text: str,
    num_workers: int = 4,
    use_stop_words: bool = True,
    bigrams: bool = False
) -> dict:
    """
    Orchestrates the 5-phase MapReduce pipeline:
    Phase 1: Splitter
    Phase 2: Mapper
    Phase 3: Shuffler
    Phase 4: Reducer
    Phase 5: Aggregator

    Returns dictionary with all pipeline artifacts, metrics, and timings.
    """
    total_start = time.perf_counter()
    phase_timings = {}

    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    total_lines = len(lines)

    # -------------------------------------------------------------
    # Phase 1: Splitter
    # -------------------------------------------------------------
    t0 = time.perf_counter()
    partitions = splitter(raw_text, num_chunks=num_workers)
    phase_timings["splitter"] = (time.perf_counter() - t0) * 1000.0

    # -------------------------------------------------------------
    # Phase 2: Mapper
    # -------------------------------------------------------------
    t0 = time.perf_counter()
    stops = STOP_WORDS if use_stop_words else None
    workers = list(map(lambda w: mapper(w, stop_words=stops, bigrams=bigrams), partitions))
    phase_timings["mapper"] = (time.perf_counter() - t0) * 1000.0

    # -------------------------------------------------------------
    # Phase 3: Shuffler
    # -------------------------------------------------------------
    t0 = time.perf_counter()
    unigram_worker_inputs = list(map(lambda w: {"pairs": w["unigrams"]}, workers))
    shuffled_unigrams = shuffler(unigram_worker_inputs)
    phase_timings["shuffler"] = (time.perf_counter() - t0) * 1000.0

    # -------------------------------------------------------------
    # Phase 4: Reducer
    # -------------------------------------------------------------
    t0 = time.perf_counter()
    reduced_unigrams = reducer(shuffled_unigrams)
    phase_timings["reducer"] = (time.perf_counter() - t0) * 1000.0

    # -------------------------------------------------------------
    # Phase 5: Aggregator
    # -------------------------------------------------------------
    t0 = time.perf_counter()
    # Merge per-node frequency dictionaries
    node_dicts = list(map(
        lambda w: dict(reducer(shuffler([{"pairs": w["unigrams"]}]).get("grouped", {}))),
        workers
    ))
    frequency = aggregator(node_dicts)
    phase_timings["aggregator"] = (time.perf_counter() - t0) * 1000.0

    # -------------------------------------------------------------
    # Bigrams (if enabled)
    # -------------------------------------------------------------
    bigrams_result = []
    if bigrams:
        bigram_worker_inputs = list(map(lambda w: {"pairs": w["bigram_pairs"]}, workers))
        shuffled_bigrams = shuffler(bigram_worker_inputs)
        bigrams_result = reducer(shuffled_bigrams)

    # -------------------------------------------------------------
    # By-Service Breakdown
    # -------------------------------------------------------------
    all_service_pairs = list(itertools.chain.from_iterable(
        map(lambda w: w.get("service_pairs", []), workers)
    ))

    # Group by service using itertools.groupby
    sorted_svc_pairs = sorted(all_service_pairs, key=lambda x: (x[0], x[1]))
    by_service = {}
    for svc, svc_group in itertools.groupby(sorted_svc_pairs, key=lambda x: x[0]):
        # Group tokens within this service
        tokens_in_svc = list(map(lambda x: (x[1], x[2]), svc_group))
        shuffled_svc = shuffler([{"pairs": tokens_in_svc}])
        reduced_svc = reducer(shuffled_svc)
        by_service[svc] = reduced_svc

    # -------------------------------------------------------------
    # Timeline minute buckets
    # -------------------------------------------------------------
    timeline_dict = {}
    for line in lines:
        m = TIMESTAMP_RE.match(line)
        if m:
            bucket = m.group(1)
            timeline_dict[bucket] = timeline_dict.get(bucket, 0) + 1

    sorted_timeline = sorted(timeline_dict.items(), key=lambda x: x[0])

    total_tokens = sum(map(lambda w: len(w["unigrams"]), workers))
    unique_tokens = len(frequency)
    processing_ms = (time.perf_counter() - total_start) * 1000.0

    return {
        "workers": workers,
        "frequency": frequency,
        "bigrams": bigrams_result,
        "by_service": by_service,
        "timeline": sorted_timeline,
        "phase_timings": phase_timings,
        "total_tokens": total_tokens,
        "unique_tokens": unique_tokens,
        "total_lines": total_lines,
        "processing_ms": processing_ms
    }

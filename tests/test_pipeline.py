"""Unit tests for PyLog-Analytics-Engine Python pipeline."""

import ast
import pathlib
import re
import pytest

from pipeline.stop_words import STOP_WORDS
from pipeline.log_generator import generate_logs, LEVELS
from pipeline.splitter import splitter
from pipeline.mapper import mapper
from pipeline.shuffler import shuffler
from pipeline.reducer import reducer
from pipeline.aggregator import aggregator
from pipeline import run_pipeline


# -------------------------------------------------------------
# Splitter Tests
# -------------------------------------------------------------
def test_splitter_correct_chunks():
    raw_text = "\n".join([f"line_{i}" for i in range(10)])
    chunks = splitter(raw_text, num_chunks=4)
    assert len(chunks) == 4
    total_lines = sum(c["line_count"] for c in chunks)
    assert total_lines == 10
    # Verify no lines dropped
    all_extracted = [line for c in chunks for line in c["lines"]]
    assert all_extracted == [f"line_{i}" for i in range(10)]


def test_splitter_empty_input():
    chunks = splitter("", num_chunks=4)
    assert len(chunks) == 4
    for c in chunks:
        assert c["lines"] == []
        assert c["line_count"] == 0


def test_splitter_whitespace_input():
    chunks = splitter("   \n\n   \n", num_chunks=3)
    assert len(chunks) == 3
    for c in chunks:
        assert c["lines"] == []
        assert c["line_count"] == 0


# -------------------------------------------------------------
# Mapper Tests
# -------------------------------------------------------------
def test_mapper_tokenization_and_pairs():
    worker = {
        "worker_id": "Worker-1",
        "lines": [
            "[2026-10-03 14:00:00] [INFO] [auth-service] user login successful"
        ]
    }
    result = mapper(worker, stop_words=None, bigrams=False)
    assert result["worker_id"] == "Worker-1"
    tokens = [p[0] for p in result["unigrams"]]
    assert "user" in tokens
    assert "login" in tokens
    assert "successful" in tokens
    assert all(p[1] == 1 for p in result["pairs"])
    assert result["token_count"] == len(result["pairs"])


def test_mapper_stop_words_filtered():
    worker = {
        "worker_id": "Worker-2",
        "lines": [
            "the user is on this login page for an account"
        ]
    }
    # With stop words
    result_filtered = mapper(worker, stop_words=STOP_WORDS, bigrams=False)
    filtered_tokens = [p[0] for p in result_filtered["unigrams"]]
    for sw in ["the", "is", "on", "this", "for", "an"]:
        assert sw not in filtered_tokens
    assert "user" in filtered_tokens
    assert "login" in filtered_tokens
    assert "page" in filtered_tokens
    assert "account" in filtered_tokens


def test_mapper_bigrams_correct_length():
    worker = {
        "worker_id": "Worker-3",
        "lines": [
            "alpha beta gamma delta"
        ]
    }
    # 4 tokens -> 3 bigrams: "alpha beta", "beta gamma", "gamma delta"
    result = mapper(worker, stop_words=None, bigrams=True)
    assert len(result["bigram_pairs"]) == 3
    bigrams = [p[0] for p in result["bigram_pairs"]]
    assert bigrams == ["alpha beta", "beta gamma", "gamma delta"]


def test_mapper_has_no_for_loops():
    mapper_file = pathlib.Path("pipeline/mapper.py")
    tree = ast.parse(mapper_file.read_text(encoding="utf-8"))
    for_nodes = [node for node in ast.walk(tree) if isinstance(node, (ast.For, ast.AsyncFor))]
    assert len(for_nodes) == 0, f"mapper.py contains forbidden For loop nodes: {for_nodes}"


# -------------------------------------------------------------
# Shuffler Tests
# -------------------------------------------------------------
def test_shuffler_grouping():
    worker_results = [
        {"pairs": [("apple", 1), ("banana", 1), ("apple", 1)]},
        {"pairs": [("banana", 1), ("orange", 1)]}
    ]
    shuffled = shuffler(worker_results)
    grouped = shuffled["grouped"]
    assert set(grouped.keys()) == {"apple", "banana", "orange"}
    assert grouped["apple"] == [1, 1]
    assert grouped["banana"] == [1, 1]
    assert grouped["orange"] == [1]
    assert shuffled["unique_keys"] == 3
    assert shuffled["total_pairs"] == 5


# -------------------------------------------------------------
# Reducer Tests
# -------------------------------------------------------------
def test_reducer_sum_and_sort():
    grouped = {
        "banana": [1, 1],
        "apple": [1, 1, 1],
        "cherry": [1]
    }
    reduced = reducer(grouped)
    # Expected descending by count: apple (3), banana (2), cherry (1)
    assert reduced == [("apple", 3), ("banana", 2), ("cherry", 1)]


def test_reducer_tie_breaking_alpha():
    grouped = {
        "zebra": [1, 1],
        "apple": [1, 1]
    }
    reduced = reducer(grouped)
    # Same count (2), tie broken alphabetically ascending: apple before zebra
    assert reduced == [("apple", 2), ("zebra", 2)]


# -------------------------------------------------------------
# Aggregator Tests
# -------------------------------------------------------------
def test_aggregator_two_dicts():
    d1 = {"apple": 3, "banana": 2}
    d2 = {"apple": 1, "cherry": 4}
    merged = aggregator([d1, d2])
    # Expected: cherry: 4, apple: 4, banana: 2 (apple before cherry or cherry before apple depending on alpha tie-break)
    assert dict(merged) == {"apple": 4, "cherry": 4, "banana": 2}


def test_aggregator_three_dicts():
    d1 = {"a": 1}
    d2 = {"b": 2, "a": 2}
    d3 = {"c": 3, "b": 1}
    merged = aggregator([d1, d2, d3])
    # Expected: c: 3, b: 3, a: 3
    assert dict(merged) == {"a": 3, "b": 3, "c": 3}


def test_aggregator_empty_list():
    assert aggregator([]) == []


# -------------------------------------------------------------
# Log Generator Tests
# -------------------------------------------------------------
def test_log_generator_line_count_and_format():
    logs_str = generate_logs(500, seed=123)
    lines = logs_str.splitlines()
    assert len(lines) == 500

    log_pattern = re.compile(
        r"^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\]\s+\[(INFO|WARN|ERROR|DEBUG|FATAL)\]\s+\[[a-z0-9_-]+\]\s+.+$"
    )
    for line in lines:
        assert log_pattern.match(line) is not None, f"Log line format mismatch: {line}"


def test_log_generator_distribution():
    # Generate 2,000 lines to verify level distribution matches weights within 10%
    logs_str = generate_logs(2000, seed=42)
    lines = logs_str.splitlines()

    counts = {lvl: 0 for lvl in LEVELS}
    for line in lines:
        for lvl in LEVELS:
            if f"[{lvl}]" in line:
                counts[lvl] += 1
                break

    # Target: INFO 50%, WARN 20%, ERROR 15%, DEBUG 10%, FATAL 5%
    # Within 10% tolerance (0.10 absolute tolerance)
    assert 0.40 <= (counts["INFO"] / 2000) <= 0.60
    assert 0.10 <= (counts["WARN"] / 2000) <= 0.30
    assert 0.05 <= (counts["ERROR"] / 2000) <= 0.25
    assert 0.02 <= (counts["DEBUG"] / 2000) <= 0.20
    assert 0.00 <= (counts["FATAL"] / 2000) <= 0.15


# -------------------------------------------------------------
# End-to-End Pipeline Tests
# -------------------------------------------------------------
def test_run_pipeline_end_to_end():
    raw_logs = generate_logs(100, seed=42)
    result = run_pipeline(raw_logs, num_workers=4, use_stop_words=True, bigrams=True)

    required_keys = {
        "workers", "frequency", "bigrams", "by_service",
        "timeline", "phase_timings", "total_tokens",
        "unique_tokens", "total_lines", "processing_ms"
    }
    assert required_keys.issubset(set(result.keys()))

    assert result["total_lines"] == 100
    assert result["total_tokens"] > 0
    assert result["unique_tokens"] > 0
    assert len(result["workers"]) == 4
    assert len(result["frequency"]) > 0
    assert len(result["bigrams"]) > 0
    assert len(result["timeline"]) > 0
    assert len(result["by_service"]) > 0
    assert result["processing_ms"] > 0

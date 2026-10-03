"""Mapper phase: Tokenize, normalize, filter stop words, and emit pairs."""

import itertools
import re
import time

TOKEN_RE = re.compile(r'[a-zA-Z0-9_\-]+')
SERVICE_RE = re.compile(r'^\[[^\]]+\]\s*\[[^\]]+\]\s*\[([a-zA-Z0-9_\-]+)\]')


def _tokenize_line(line: str) -> list[str]:
    return TOKEN_RE.findall(line.lower())


def _extract_service(line: str) -> str:
    match = SERVICE_RE.match(line)
    return match.group(1).lower() if match else "unknown"


def _filter_tokens(tokens: list[str], stop_words) -> list[str]:
    if stop_words:
        return list(filter(lambda w: len(w) > 1 and w not in stop_words, tokens))
    return list(filter(lambda w: len(w) > 1, tokens))


def _make_bigrams(tokens: list[str]) -> list[str]:
    return list(map(lambda pair: f"{pair[0]} {pair[1]}", zip(tokens, tokens[1:])))


def _process_single_line(line: str, stop_words, bigrams: bool) -> dict:
    service = _extract_service(line)
    raw_tokens = _tokenize_line(line)
    clean_tokens = _filter_tokens(raw_tokens, stop_words)

    # Emit (token, 1) pairs using map()
    unigram_pairs = list(map(lambda t: (t, 1), clean_tokens))

    # If bigrams=True, additionally emit (f"{w1} {w2}", 1) pairs using zip
    bigram_pairs = list(map(lambda bg: (bg, 1), _make_bigrams(clean_tokens))) if bigrams else []

    # Tag each pair with its source service
    service_pairs = list(map(lambda t: (service, t, 1), clean_tokens))

    return {
        "unigram_pairs": unigram_pairs,
        "bigram_pairs": bigram_pairs,
        "service_pairs": service_pairs
    }


def mapper(worker: dict, stop_words=None, bigrams: bool = False) -> dict:
    """
    Tokenizes each line using re.compile(r'[a-zA-Z0-9_\\-]+').
    Normalizes to lowercase.
    Filters tokens: length > 1, not in stop_words using filter().
    Emits (token, 1) pairs using map().
    If bigrams=True: additionally emits bigram pairs using zip(tokens, tokens[1:]).
    Zero explicit for loops inside this function or file.
    Returns: {"worker_id": str, "pairs": list[tuple[str,int]], "elapsed_ms": float, "token_count": int}
    """
    t0 = time.perf_counter()

    lines = worker.get("lines", []) if isinstance(worker, dict) else []

    # Process each line functionally using map() -- zero explicit for loops
    line_results = list(map(lambda line: _process_single_line(line, stop_words, bigrams), lines))

    unigram_pairs = list(itertools.chain.from_iterable(
        map(lambda res: res["unigram_pairs"], line_results)
    ))

    bigram_pairs = list(itertools.chain.from_iterable(
        map(lambda res: res["bigram_pairs"], line_results)
    )) if bigrams else []

    service_pairs = list(itertools.chain.from_iterable(
        map(lambda res: res["service_pairs"], line_results)
    ))

    # All emitted pairs (unigrams + bigrams if bigrams is True)
    emitted_pairs = unigram_pairs + bigram_pairs

    t1 = time.perf_counter()
    elapsed_ms = (t1 - t0) * 1000.0

    return {
        "worker_id": worker.get("worker_id", "Worker-1") if isinstance(worker, dict) else "Worker-1",
        "pairs": emitted_pairs,
        "unigrams": unigram_pairs,
        "bigrams": bigram_pairs,
        "bigram_pairs": bigram_pairs,
        "service_pairs": service_pairs,
        "elapsed_ms": elapsed_ms,
        "token_count": len(emitted_pairs)
    }

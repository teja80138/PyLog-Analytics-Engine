"""Shuffler phase: Group emitted pairs by key across worker partitions."""

import itertools


def shuffler(all_worker_results: list[dict]) -> dict:
    """
    Collects all pairs across workers using itertools.chain.from_iterable.
    Groups by key using sorted() then itertools.groupby.
    Returns: {"grouped": dict[str, list[int]], "unique_keys": int, "total_pairs": int}
    """
    if not all_worker_results:
        return {"grouped": {}, "unique_keys": 0, "total_pairs": 0}

    # Handle both list of worker dicts and direct list of tuples
    if isinstance(all_worker_results[0], tuple):
        all_pairs = all_worker_results
    else:
        all_pairs = list(itertools.chain.from_iterable(
            map(lambda w: w.get("pairs", []) if isinstance(w, dict) else w, all_worker_results)
        ))

    if not all_pairs:
        return {"grouped": {}, "unique_keys": 0, "total_pairs": 0}

    sorted_pairs = sorted(all_pairs, key=lambda item: item[0])
    grouped = {
        key: list(map(lambda item: item[1], group))
        for key, group in itertools.groupby(sorted_pairs, key=lambda item: item[0])
    }

    return {
        "grouped": grouped,
        "unique_keys": len(grouped),
        "total_pairs": len(all_pairs)
    }

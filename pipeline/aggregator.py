"""Aggregator phase: Merge per-node frequency dicts using functools.reduce."""

import functools


def aggregator(node_results: list[dict]) -> list[tuple[str, int]]:
    """
    Merges a list of per-node dicts using functools.reduce.
    Returns sorted list[tuple[str, int]] descending by count then ascending alpha.
    """
    if not node_results:
        return []

    # Handle cases where elements may be list of tuples by converting to dict
    normalized_dicts = list(map(lambda d: dict(d) if isinstance(d, list) else d, node_results))

    merged = functools.reduce(
        lambda a, b: {k: a.get(k, 0) + b.get(k, 0) for k in set(a) | set(b)},
        normalized_dicts,
        {}
    )

    return sorted(merged.items(), key=lambda item: (-item[1], item[0]))

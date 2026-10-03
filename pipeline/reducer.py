"""Reducer phase: Sum counts per key using functools.reduce."""

import functools


def reducer(grouped: dict) -> list[tuple[str, int]]:
    """
    Sums counts per key using functools.reduce(lambda a, b: a + b, values, 0).
    Uses map() over grouped.items() -- zero explicit for loops.
    Returns sorted list of (token, count) tuples, descending by count then ascending alpha.
    """
    if not grouped:
        return []

    # If grouped dict wraps inner "grouped" key from shuffler output, extract it
    items_dict = grouped.get("grouped", grouped) if isinstance(grouped, dict) and "grouped" in grouped else grouped

    def _reduce_key_counts(key_values_pair: tuple) -> tuple[str, int]:
        key, values = key_values_pair
        total = functools.reduce(lambda a, b: a + b, values, 0)
        return (key, total)

    reduced_pairs = list(map(_reduce_key_counts, items_dict.items()))
    return sorted(reduced_pairs, key=lambda item: (-item[1], item[0]))

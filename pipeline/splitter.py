"""Splitter phase: Partition raw log text into N worker chunks."""

import itertools


def splitter(raw_text: str, num_chunks: int = 4) -> list[dict]:
    """
    Partitions raw log text into num_chunks partitions.
    Uses list comprehension and itertools.islice.
    Returns: list of dicts: [{"worker_id": "Worker-1", "lines": [...], "line_count": N}, ...]
    """
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    total_lines = len(lines)

    if total_lines == 0 or num_chunks <= 0:
        return [
            {
                "worker_id": f"Worker-{i + 1}",
                "lines": [],
                "line_count": 0
            }
            for i in range(max(1, num_chunks))
        ]

    chunk_size = (total_lines + num_chunks - 1) // num_chunks

    # Split using list comprehension and itertools.islice
    chunks = [
        list(itertools.islice(lines, i * chunk_size, (i + 1) * chunk_size))
        for i in range(num_chunks)
    ]

    return [
        {
            "worker_id": f"Worker-{i + 1}",
            "lines": chunks[i],
            "line_count": len(chunks[i])
        }
        for i in range(num_chunks)
    ]

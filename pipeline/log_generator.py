"""Synthetic distributed log line generator for PyLog Analytics Engine."""

import random
from datetime import datetime, timedelta

LEVELS = ["INFO", "WARN", "ERROR", "DEBUG", "FATAL"]
LEVEL_WEIGHTS = [0.50, 0.20, 0.15, 0.10, 0.05]

SERVICES = [
    "auth-service",
    "api-gateway",
    "db-connector",
    "cache-layer",
    "scheduler"
]

MESSAGE_TEMPLATES = {
    "auth-service": {
        "INFO": [
            "User authentication successful for session_token=tok_{tok} client_ip={ip}",
            "Issued JWT bearer token for client_id=client_{tok} scope=user:read tenant=org_{tenant}",
            "Revoked expired session tokens for tenant_id=org_{tenant} cleared=14"
        ],
        "WARN": [
            "Rate limit threshold 80% reached for client_ip={ip} bucket=login",
            "Multiple failed login attempts detected from client_ip={ip} attempts=4",
            "OAuth2 token refresh latency elevated duration={ms}ms"
        ],
        "ERROR": [
            "JWT signature validation failed: expired token signature token_id=jwt_{tok}",
            "Password verification hash mismatch for user_id=usr_{usr}",
            "Authentication backend connection timeout host=auth-db duration=5000ms"
        ],
        "DEBUG": [
            "Validating PBKDF2 salt rounds=100000 salt={salt}",
            "Session cache lookup hit token_id=tok_{tok}"
        ],
        "FATAL": [
            "OAuth2 identity provider connection pool exhausted, terminating auth daemon",
            "Master crypto key decryption error in HSM module"
        ]
    },
    "api-gateway": {
        "INFO": [
            "HTTP 200 GET /api/v2/telemetry duration={ms}ms client=nginx",
            "HTTP 201 POST /orders/checkout duration={ms}ms status=created",
            "Upstream route matched route_id=svc_orders method=POST"
        ],
        "WARN": [
            "Upstream latency spike detected on endpoint /orders/checkout duration={high_ms}ms",
            "Circuit breaker half-open probe dispatched to upstream payment-service",
            "Payload size warning: request size exceeds recommended threshold size=409600b"
        ],
        "ERROR": [
            "HTTP 502 Bad Gateway while proxying request to payment-processor",
            "HTTP 504 Gateway Timeout upstream=db-connector duration=30000ms",
            "Upstream connection refused on proxy cluster target=inventory-service:8080"
        ],
        "DEBUG": [
            "Header inspection x-correlation-id=req_{tok} trace_sampled=true",
            "SSL handshake completed cipher=TLS_AES_256_GCM_SHA384"
        ],
        "FATAL": [
            "TLS certificate handshake internal buffer overflow, terminating listener",
            "Port 443 binding failure: socket address already in use"
        ]
    },
    "db-connector": {
        "INFO": [
            "Transaction committed tx_id=tx_{tx} affected_rows={rows} table=audit_events",
            "Read replica sync acknowledged sequence_num={seq} latency=4ms",
            "Connection pool idle check passed: active=18 idle=32 pool_size=50"
        ],
        "WARN": [
            "Slow query detected duration={high_ms}ms query=\"SELECT * FROM transactions WHERE status='pending'\"",
            "Connection pool high watermark reached active_connections=142 max=150",
            "Table statistics stale for partition table=metrics_2026_10"
        ],
        "ERROR": [
            "Deadlock detected on lock_table lock_key=idx_customer_orders tx_aborted=tx_{tx}",
            "Query execution aborted: lock wait timeout exceeded on row_lock",
            "PostgreSQL replica connection dropped during WAL replication sequence={seq}"
        ],
        "DEBUG": [
            "Acquiring connection from pool pool_size=50 idle=12 active=38",
            "Prepared statement cached statement_name=stmt_fetch_user"
        ],
        "FATAL": [
            "PostgreSQL connection pool exhausted: 150/150 connections active",
            "Disk write failure on WAL journal volume /var/lib/postgresql/wal"
        ]
    },
    "cache-layer": {
        "INFO": [
            "Cache hit key=\"session:usr_{usr}\" ttl_remaining={ttl}s memory_tier=ram",
            "Cache set key=\"catalog:item_{item}\" size=2048b compression=lz4",
            "Cluster node synchronization completed nodes=6 sync_state=healthy"
        ],
        "WARN": [
            "Cache miss ratio exceeded threshold: misses=412 hits=120 window=60s",
            "Memory pressure warning: high memory usage in cache shard 04",
            "Redis replication lag increased to 1200ms on slave replica-02"
        ],
        "ERROR": [
            "Redis cluster node redis-node-03 disconnected during failover sync",
            "Write replication failed to replica node redis-node-02 timeout=5000ms",
            "Cache eviction threshold reached unexpectedly with volatile-lru policy"
        ],
        "DEBUG": [
            "Eviction policy LRU reclaimed 14 keys in memory_pressure event",
            "Cluster heartbeat roundtrip latency=1.2ms peer=redis-05"
        ],
        "FATAL": [
            "Memory fragmentation ratio 2.1 exceeds max_allowed_memory 16GB",
            "Redis engine panic: out of memory allocating key dictionary bucket"
        ]
    },
    "scheduler": {
        "INFO": [
            "Cron task job_cleanup_expired_tokens executed successfully duration=110ms",
            "Periodic telemetry aggregator flush completed records=840",
            "Dispatched 12 scheduled background jobs to worker queue batch-processors"
        ],
        "WARN": [
            "Job backup_s3_snapshot delayed by 180s due to worker queue backlog",
            "Queue depth elevated for worker group batch-processors pending=34",
            "Worker task duration exceeded soft limit task=export_metrics duration=45000ms"
        ],
        "ERROR": [
            "Task reconciliation failed for tenant_id=org_{tenant} timeout=30000ms",
            "Worker heartbeat timeout: node-worker-08 unresponsive for 60s",
            "Cron trigger missed deadline for job generate_invoices scheduler_delay=120s"
        ],
        "DEBUG": [
            "Worker poll tick queue_depth=4 running_tasks=2",
            "Evaluating cron schedule next_run_time=2026-10-03T15:00:00"
        ],
        "FATAL": [
            "Heartbeat failure detected on leader election node zookeeper-01",
            "Scheduler lock manager lost quorum with consensus cluster"
        ]
    }
}


def generate_logs(n_lines: int, seed: int = 42) -> str:
    """
    Produces realistic log lines in the exact format:
    [YYYY-MM-DD HH:MM:SS] [LEVEL] [SERVICE] MESSAGE
    """
    random.seed(seed)
    base_time = datetime(2026, 10, 3, 14, 0, 0)
    lines = []

    for i in range(n_lines):
        # Progress time smoothly: ~1 second per 5 lines
        line_time = base_time + timedelta(seconds=i // 5, milliseconds=(i % 5) * 200)
        timestamp_str = line_time.strftime("%Y-%m-%d %H:%M:%S")

        level = random.choices(LEVELS, weights=LEVEL_WEIGHTS, k=1)[0]
        service = random.choice(SERVICES)

        templates = MESSAGE_TEMPLATES[service][level]
        template = random.choice(templates)

        tok = f"{random.randint(1000, 9999):x}"
        ip = f"192.168.1.{10 + (i % 80)}"
        tenant = f"{100 + (i % 20)}"
        usr = f"{1000 + (i % 200)}"
        salt = f"{random.randint(100000, 999999):x}"
        ms = str(5 + (i % 45))
        high_ms = str(600 + (i % 1200))
        tx = str(88000 + (i % 1000))
        rows = str(1 + (i % 10))
        seq = str(5000 + i)
        item = str(200 + (i % 50))
        ttl = str(600 + (i % 1200))

        message = template.format(
            tok=tok,
            ip=ip,
            tenant=tenant,
            usr=usr,
            salt=salt,
            ms=ms,
            high_ms=high_ms,
            tx=tx,
            rows=rows,
            seq=seq,
            item=item,
            ttl=ttl
        )

        lines.append(f"[{timestamp_str}] [{level}] [{service}] {message}")

    return "\n".join(lines)

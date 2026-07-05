# Design Decisions

PostgreSQL is authoritative because transactional transitions and auditability matter more than adding a broker prematurely. `SKIP LOCKED` allows workers to claim different rows without blocking. Queue-scoped advisory locks prevent concurrency-limit overshoot without globally serializing claims. Leases make crashed-worker recovery possible. Execution history is separated from mutable job state. Retry history and DLQ entries remain durable for incident analysis. Large production payload artifacts should live in object storage, with references stored in JSONB.

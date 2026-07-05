# Architecture

```mermaid
flowchart LR
 UI[React Dashboard] --> API[Spring Boot API]
 API --> PG[(PostgreSQL)]
 S[Schedule/Retry Promoter] --> PG
 R[Lease Recovery] --> PG
 W1[Worker A] -->|SKIP LOCKED claim| PG
 W2[Worker B] -->|SKIP LOCKED claim| PG
 W1 -->|heartbeats| PG
 W2 -->|heartbeats| PG
 PG --> D[Dead Letter Queue]
```

PostgreSQL is the correctness boundary. Workers claim in short transactions and execute outside the transaction. Queue-scoped advisory transaction locks protect concurrency-limit checks. Independent queues still claim concurrently. Leases recover jobs from crashed workers. The system deliberately promises at-least-once execution.

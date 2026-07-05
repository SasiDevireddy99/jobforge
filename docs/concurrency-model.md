# Concurrency Model

1. Worker polls only while local capacity exists.
2. Claim transaction takes a queue-scoped advisory transaction lock.
3. SQL checks pause state and active queue count.
4. Eligible work is selected by priority and age with `FOR UPDATE SKIP LOCKED`.
5. Claim writes worker ownership and lease expiry.
6. Transaction commits before execution.
7. Attempt row is created when execution starts.
8. Success completes the job; failure schedules retry or creates a DLQ entry.
9. Promoter moves due SCHEDULED and RETRY_WAIT jobs to QUEUED.
10. Recovery requeues expired CLAIMED/RUNNING leases.

This is an at-least-once system. Exactly-once external side effects require cooperation from the downstream system, usually through idempotency keys.

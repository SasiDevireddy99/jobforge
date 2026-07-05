# JobForge — Distributed Job Scheduler

A runnable production-style distributed scheduler implementing:
- JWT authentication
- Projects and queues
- Immediate and delayed jobs
- Batch job creation
- Atomic multi-worker claims using PostgreSQL `FOR UPDATE SKIP LOCKED`
- Queue concurrency limits
- Worker registration, heartbeats, leases, and stale-job recovery
- Fixed, linear, and exponential retries
- Execution history and Dead Letter Queue replay
- Responsive React operations dashboard
- Flyway schema, Docker Compose, tests, architecture/ER/API/design documentation

## Run
```bash
docker compose up --build
```
Dashboard: `http://localhost:5173`
API: `http://localhost:8080`

Demo login: `admin@jobforge.local` / `ChangeMe123!`

## Test
```bash
cd backend
mvn test
```

The execution contract is at-least-once. Job submission supports idempotency keys, and handlers should make external side effects idempotent.

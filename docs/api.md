# API

Authentication: `POST /api/v1/auth/login`.

Jobs: `POST /jobs`, `POST /jobs/batch`, `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/executions`.

Queues: `GET /queues`, `POST /queues/{id}/pause`, `POST /queues/{id}/resume`.

Operations: `GET /workers`, `GET /dlq`, `POST /dlq/{id}/replay`.

Create job example body:
```json
{"queueId":"00000000-0000-0000-0000-000000000004","name":"email.send","payload":"{\"recipient\":\"demo@example.com\"}","priority":10,"maxAttempts":5}
```
To exercise retry and DLQ behavior, include `simulateFailure` in the payload.

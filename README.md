# JobForge — Distributed Job Scheduler

JobForge is a runnable, production-style distributed job scheduler and worker platform. It combines authentication, queueing, scheduling, retries, worker coordination, and an operations dashboard into a single reference implementation.

## Overview

JobForge demonstrates how to build a robust asynchronous job system with the following capabilities:

- **JWT authentication** for secured API and dashboard access
- **Projects and queues** to organize workloads
- **Immediate and delayed jobs** for real-time and scheduled execution
- **Batch job creation** for submitting work at scale
- **Atomic multi-worker claims** using PostgreSQL `FOR UPDATE SKIP LOCKED`
- **Queue concurrency limits** to control throughput per queue
- **Worker registration, heartbeats, leases, and stale-job recovery** for resilient execution
- **Fixed, linear, and exponential retries** for failure handling
- **Execution history and Dead Letter Queue replay** for observability and recovery
- **Responsive React operations dashboard** for managing and monitoring the system
- **Flyway schema, Docker Compose, tests, architecture/ER/API/design documentation** for a complete local development experience

The execution contract is **at-least-once**. Job submission supports **idempotency keys**, and handlers should make external side effects idempotent.

## Features

### Core platform

- Secure JWT-based authentication
- Project and queue management
- Immediate and delayed job scheduling
- Batch submission support
- Queue-level concurrency controls
- Job leasing and stale-job recovery
- Dead Letter Queue replay

### Reliability and execution

- PostgreSQL-backed coordination
- Atomic worker claims with `FOR UPDATE SKIP LOCKED`
- Retry policies with fixed, linear, and exponential backoff
- Heartbeats and lease renewal for active workers
- Execution history for auditing and troubleshooting
- At-least-once delivery semantics

### User interface

- Responsive React dashboard
- Operational visibility into jobs, queues, and workers
- Local development-friendly UI/API setup

## Setup

### Prerequisites

- Docker and Docker Compose
- Java and Maven for backend development and tests
- Node.js tooling if you plan to work on the dashboard separately

### Run the full stack

```bash
docker compose up --build
```

After startup:

- Dashboard: `http://localhost:5173`
- API: `http://localhost:8080`

### Demo login

- Email: `admin@jobforge.local`
- Password: `ChangeMe123!`

### Run tests

```bash
cd backend
mvn test
```

## Architecture

JobForge is organized around a few major responsibilities:

### API and authentication layer

The backend exposes the scheduler API, handles JWT authentication, and serves as the control plane for jobs, queues, projects, and workers.

### Scheduling and dispatch

Jobs are stored in PostgreSQL and claimed atomically by workers using `FOR UPDATE SKIP LOCKED`, which enables safe multi-worker consumption without duplicate claims.

### Worker runtime

Workers register with the system, send heartbeats, acquire leases, execute jobs, and recover from stale or failed work.

### Retry and recovery pipeline

Failed jobs can be retried using configurable backoff strategies. Jobs that exhaust retries move to the Dead Letter Queue, where they can be inspected and replayed.

### Operations dashboard

The React dashboard provides a front-end view for monitoring system health, browsing jobs, and managing scheduler operations.

### Database and infrastructure

Flyway manages schema migrations, PostgreSQL stores durable state, and Docker Compose provides a reproducible local environment.

## Repository contents

This repository includes:

- Backend scheduler service
- Worker coordination and job execution logic
- React-based dashboard
- Database migrations
- Tests
- Architecture, ER, API, and design documentation

## Notes on delivery semantics

JobForge is designed for **at-least-once** processing. That means a job may be executed more than once in rare failure scenarios, so downstream handlers should be written to tolerate retries and duplicate delivery.

## Getting started

1. Start the stack with Docker Compose.
2. Log in to the dashboard using the demo credentials.
3. Create projects and queues.
4. Submit immediate or delayed jobs.
5. Observe worker claims, retries, and execution history from the dashboard.

## Contributing

This repository is structured to be easy to extend. Good next improvements include:

- Additional retry and backoff options
- Expanded dashboard views and filters
- More worker health and queue metrics
- API hardening and validation improvements
- Documentation examples for job handlers and integrations

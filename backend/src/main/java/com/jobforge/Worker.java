package com.jobforge;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;


@Component
public class Worker {

    private final JdbcTemplate db;
    private final TransactionTemplate tx;

    private final UUID id = UUID.randomUUID();

    private final AtomicInteger active = new AtomicInteger();

    private ExecutorService pool;


    @Value("${jobforge.worker.capacity:8}")
    private int cap;


    @Value("${jobforge.worker.lease-seconds:30}")
    private int lease;


    public Worker(
            JdbcTemplate db,
            PlatformTransactionManager transactionManager
    ) {
        this.db = db;
        this.tx = new TransactionTemplate(transactionManager);
    }


    // ============================================================
    // WORKER STARTUP
    // ============================================================

    @PostConstruct
    void start() {

        pool = Executors.newVirtualThreadPerTaskExecutor();

        db.update(
                """
                INSERT INTO workers(
                    id,
                    name,
                    status,
                    capacity,
                    started_at,
                    last_heartbeat_at
                )
                VALUES (?, ?, 'ONLINE', ?, now(), now())
                """,
                id,
                "worker-" + id.toString().substring(0, 8),
                cap
        );

        System.out.println(
                "JobForge worker started: " + id
        );
    }


    // ============================================================
    // QUEUE POLLING
    // ============================================================

    @Scheduled(fixedDelay = 500)
    void poll() {

        if (active.get() >= cap) {
            return;
        }

        List<Map<String, Object>> queues =
                db.queryForList(
                        """
                        SELECT id
                        FROM queues
                        WHERE paused = false
                        ORDER BY name
                        """
                );


        for (Map<String, Object> queue : queues) {

            if (active.get() >= cap) {
                break;
            }

            UUID queueId =
                    (UUID) queue.get("id");

            claim(queueId)
                    .ifPresent(this::submit);
        }
    }


    // ============================================================
    // ATOMIC JOB CLAIM
    // ============================================================

    Optional<UUID> claim(UUID queueId) {

        Optional<UUID> result =
                tx.execute(transactionStatus -> {

                    /*
                     * Serialize the concurrency-limit check for this queue.
                     *
                     * pg_advisory_xact_lock returns void, so it must not
                     * be mapped to Long.class.
                     */

                    db.execute((org.springframework.jdbc.core.PreparedStatementCreator) connection -> {

                        var statement =
                                connection.prepareStatement(
                                        """
                                        SELECT pg_advisory_xact_lock(
                                            hashtext(?)
                                        )
                                        """
                                );

                        statement.setString(
                                1,
                                "queue:" + queueId
                        );

                        return statement;

                    }, (org.springframework.jdbc.core.PreparedStatementCallback<Object>) statement -> {

                        statement.execute();

                        return null;
                    });


                    /*
                     * Find one eligible job and atomically claim it.
                     *
                     * SKIP LOCKED allows multiple workers to claim
                     * different jobs without waiting on each other.
                     */

                    List<UUID> claimedJobs =
                            db.query(
                                    """
                                    WITH candidate AS (

                                        SELECT j.id

                                        FROM jobs j

                                        JOIN queues q
                                            ON q.id = j.queue_id

                                        WHERE j.queue_id = ?

                                          AND q.paused = false

                                          AND j.status = 'QUEUED'

                                          AND j.available_at <= now()

                                          AND (

                                              SELECT count(*)

                                              FROM jobs active_jobs

                                              WHERE active_jobs.queue_id = ?

                                                AND active_jobs.status
                                                    IN (
                                                        'CLAIMED',
                                                        'RUNNING'
                                                    )

                                          ) < q.concurrency_limit

                                        ORDER BY
                                            j.priority DESC,
                                            j.available_at ASC,
                                            j.created_at ASC

                                        FOR UPDATE OF j
                                        SKIP LOCKED

                                        LIMIT 1
                                    )

                                    UPDATE jobs j

                                    SET
                                        status = 'CLAIMED',

                                        claimed_by = ?,

                                        lease_expires_at =
                                            now()
                                            + make_interval(
                                                secs => ?
                                            ),

                                        updated_at = now()

                                    FROM candidate c

                                    WHERE j.id = c.id

                                    RETURNING j.id
                                    """,

                                    (rs, rowNumber) ->
                                            rs.getObject(
                                                    "id",
                                                    UUID.class
                                            ),

                                    queueId,
                                    queueId,
                                    id,
                                    lease
                            );


                    return claimedJobs
                            .stream()
                            .findFirst();
                });


        return result == null
                ? Optional.empty()
                : result;
    }


    // ============================================================
    // EXECUTOR SUBMISSION
    // ============================================================

    void submit(UUID jobId) {

        active.incrementAndGet();


        pool.submit(() -> {

            long startedAt =
                    System.nanoTime();


            try {

                startExecution(jobId);

                execute(jobId);

                complete(
                        jobId,
                        elapsed(startedAt)
                );

            } catch (Exception exception) {

                try {

                    fail(
                            jobId,
                            exception,
                            elapsed(startedAt)
                    );

                } catch (Exception failureException) {

                    System.err.println(
                            "Could not record failure for job "
                                    + jobId
                                    + ": "
                                    + failureException.getMessage()
                    );
                }

            } finally {

                active.decrementAndGet();
            }
        });
    }


    // ============================================================
    // START EXECUTION
    // ============================================================

    void startExecution(UUID jobId) {

        tx.executeWithoutResult(transactionStatus -> {

            int updated =
                    db.update(
                            """
                            UPDATE jobs

                            SET
                                status = 'RUNNING',
                                attempts = attempts + 1,
                                updated_at = now()

                            WHERE id = ?

                              AND claimed_by = ?

                              AND status = 'CLAIMED'
                            """,
                            jobId,
                            id
                    );


            if (updated != 1) {

                throw new IllegalStateException(
                        "Job claim ownership lost: "
                                + jobId
                );
            }


            db.update(
                    """
                    INSERT INTO job_executions(

                        job_id,
                        worker_id,
                        attempt_number,
                        status,
                        started_at
                    )

                    SELECT
                        id,
                        ?,
                        attempts,
                        'RUNNING',
                        now()

                    FROM jobs

                    WHERE id = ?
                    """,
                    id,
                    jobId
            );
        });
    }


    // ============================================================
    // JOB HANDLER
    // ============================================================

    void execute(UUID jobId) {

        String payload =
                db.queryForObject(
                        """
                        SELECT payload::text

                        FROM jobs

                        WHERE id = ?
                        """,
                        String.class,
                        jobId
                );


        /*
         * Demo handler failure switch.
         *
         * Payload:
         *
         * {"simulateFailure": true}
         *
         * can be used to test retries and DLQ behavior.
         */

        if (payload != null
                && payload.contains("simulateFailure")) {

            throw new RuntimeException(
                    "Simulated handler failure"
            );
        }


        try {

            Thread.sleep(150);

        } catch (InterruptedException exception) {

            Thread.currentThread().interrupt();

            throw new RuntimeException(
                    "Job execution interrupted",
                    exception
            );
        }
    }


    // ============================================================
    // COMPLETE JOB
    // ============================================================

    void complete(
            UUID jobId,
            long durationMs
    ) {

        tx.executeWithoutResult(transactionStatus -> {

            int updated =
                    db.update(
                            """
                            UPDATE jobs

                            SET
                                status = 'COMPLETED',
                                lease_expires_at = NULL,
                                updated_at = now()

                            WHERE id = ?

                              AND claimed_by = ?

                              AND status = 'RUNNING'
                            """,
                            jobId,
                            id
                    );


            if (updated != 1) {

                throw new IllegalStateException(
                        "Cannot complete job because ownership was lost: "
                                + jobId
                );
            }


            db.update(
                    """
                    UPDATE job_executions

                    SET
                        status = 'COMPLETED',
                        finished_at = now(),
                        duration_ms = ?

                    WHERE job_id = ?

                      AND attempt_number = (

                          SELECT attempts

                          FROM jobs

                          WHERE id = ?
                      )
                    """,
                    durationMs,
                    jobId,
                    jobId
            );
        });
    }


    // ============================================================
    // FAILURE HANDLING
    // ============================================================

    void fail(
            UUID jobId,
            Exception exception,
            long durationMs
    ) {

        tx.executeWithoutResult(transactionStatus -> {

            Map<String, Object> job =
                    db.queryForMap(
                            """
                            SELECT

                                j.attempts,

                                COALESCE(
                                    r.max_attempts,
                                    j.max_attempts
                                ) AS max_attempts,

                                COALESCE(
                                    r.strategy,
                                    'EXPONENTIAL'
                                ) AS strategy,

                                COALESCE(
                                    r.base_delay_seconds,
                                    5
                                ) AS base_delay,

                                COALESCE(
                                    r.max_delay_seconds,
                                    300
                                ) AS max_delay

                            FROM jobs j

                            JOIN queues q
                                ON q.id = j.queue_id

                            LEFT JOIN retry_policies r
                                ON r.id = q.retry_policy_id

                            WHERE j.id = ?
                            """,
                            jobId
                    );


            int attempts =
                    ((Number) job.get("attempts"))
                            .intValue();


            int maxAttempts =
                    ((Number) job.get("max_attempts"))
                            .intValue();


            String strategy =
                    (String) job.get("strategy");


            long baseDelay =
                    ((Number) job.get("base_delay"))
                            .longValue();


            long maxDelay =
                    ((Number) job.get("max_delay"))
                            .longValue();


            String errorMessage =
                    exception.getMessage() == null
                            ? exception
                                .getClass()
                                .getSimpleName()
                            : exception.getMessage();


            if (attempts < maxAttempts) {

                long multiplier;


                switch (strategy) {

                    case "FIXED" ->

                            multiplier = 1;


                    case "LINEAR" ->

                            multiplier =
                                    Math.max(
                                            1,
                                            attempts
                                    );


                    default ->

                            multiplier =
                                    1L << Math.min(
                                            20,
                                            Math.max(
                                                    0,
                                                    attempts - 1
                                            )
                                    );
                }


                long delay =
                        Math.min(
                                maxDelay,
                                baseDelay * multiplier
                        );


                db.update(
                        """
                        UPDATE jobs

                        SET
                            status = 'RETRY_WAIT',

                            available_at =
                                now()
                                + make_interval(
                                    secs => ?
                                ),

                            claimed_by = NULL,

                            lease_expires_at = NULL,

                            updated_at = now()

                        WHERE id = ?
                        """,
                        delay,
                        jobId
                );


                db.update(
                        """
                        INSERT INTO retry_history(

                            job_id,
                            attempt_number,
                            strategy,
                            delay_seconds,
                            reason,
                            scheduled_for
                        )

                        VALUES(

                            ?,
                            ?,
                            ?,
                            ?,
                            ?,

                            now()
                            + make_interval(
                                secs => ?
                            )
                        )
                        """,
                        jobId,
                        attempts,
                        strategy,
                        delay,
                        errorMessage,
                        delay
                );

            } else {

                db.update(
                        """
                        UPDATE jobs

                        SET
                            status = 'DEAD_LETTERED',
                            lease_expires_at = NULL,
                            updated_at = now()

                        WHERE id = ?
                        """,
                        jobId
                );


                db.update(
                        """
                        INSERT INTO dead_letter_entries(

                            job_id,
                            final_error
                        )

                        VALUES (?, ?)

                        ON CONFLICT(job_id)
                        DO NOTHING
                        """,
                        jobId,
                        errorMessage
                );
            }


            db.update(
                    """
                    UPDATE job_executions

                    SET
                        status = 'FAILED',
                        finished_at = now(),
                        duration_ms = ?,
                        error_code = 'EXECUTION_ERROR',
                        error_message = ?

                    WHERE job_id = ?

                      AND attempt_number = ?
                    """,
                    durationMs,
                    errorMessage,
                    jobId,
                    attempts
            );
        });
    }


    // ============================================================
    // DELAYED JOB + RETRY PROMOTION
    // ============================================================

    @Scheduled(fixedDelay = 1000)
    void promote() {

        db.update(
                """
                UPDATE jobs

                SET
                    status = 'QUEUED',
                    updated_at = now()

                WHERE status IN (
                    'SCHEDULED',
                    'RETRY_WAIT'
                )

                AND available_at <= now()
                """
        );
    }


    // ============================================================
    // EXPIRED LEASE RECOVERY
    // ============================================================

    @Scheduled(fixedDelay = 5000)
    void recover() {

        tx.executeWithoutResult(transactionStatus ->

                db.update(
                        """
                        UPDATE jobs

                        SET
                            status = 'QUEUED',
                            claimed_by = NULL,
                            lease_expires_at = NULL,
                            available_at = now(),
                            updated_at = now()

                        WHERE id IN (

                            SELECT id

                            FROM jobs

                            WHERE status IN (
                                'CLAIMED',
                                'RUNNING'
                            )

                            AND lease_expires_at < now()

                            FOR UPDATE
                            SKIP LOCKED

                            LIMIT 100
                        )
                        """
                )
        );
    }


    // ============================================================
    // HEARTBEAT
    // ============================================================

    @Scheduled(fixedDelay = 5000)
    void heartbeat() {

        db.update(
                """
                UPDATE workers

                SET
                    last_heartbeat_at = now(),
                    status = 'ONLINE'

                WHERE id = ?
                """,
                id
        );


        db.update(
                """
                INSERT INTO worker_heartbeats(

                    worker_id,
                    active_jobs
                )

                VALUES (?, ?)
                """,
                id,
                active.get()
        );
    }


    // ============================================================
    // TIMER
    // ============================================================

    long elapsed(long startTime) {

        return TimeUnit.NANOSECONDS
                .toMillis(
                        System.nanoTime()
                                - startTime
                );
    }


    // ============================================================
    // GRACEFUL SHUTDOWN
    // ============================================================

    @PreDestroy
    void stop() {

        db.update(
                """
                UPDATE workers

                SET status = 'DRAINING'

                WHERE id = ?
                """,
                id
        );


        pool.shutdown();


        try {

            if (!pool.awaitTermination(
                    20,
                    TimeUnit.SECONDS
            )) {

                pool.shutdownNow();
            }

        } catch (InterruptedException exception) {

            pool.shutdownNow();

            Thread.currentThread()
                    .interrupt();
        }
    }
}
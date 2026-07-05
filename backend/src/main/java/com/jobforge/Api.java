package com.jobforge;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;


@RestController
@RequestMapping("/api/v1")
public class Api {

    private final JdbcTemplate db;
    private final Security security;


    public Api(
            JdbcTemplate db,
            Security security
    ) {
        this.db = db;
        this.security = security;
    }


    public record Login(
            String email,
            String password
    ) {
    }


    public record CreateJob(
            UUID queueId,
            String name,
            String payload,
            Integer priority,
            Integer maxAttempts,
            Instant runAt,
            String idempotencyKey
    ) {
    }


    @PostMapping("/auth/login")
    public Map<String, String> login(
            @RequestBody Login request
    ) {

        if (
                !"admin@jobforge.local"
                        .equals(request.email())
                ||
                !"ChangeMe123!"
                        .equals(request.password())
        ) {

            throw new ResponseStatusException(
                    HttpStatus.UNAUTHORIZED,
                    "Invalid email or password"
            );
        }


        return Map.of(
                "token",
                security.issue(
                        request.email()
                ),

                "displayName",
                "JobForge Admin"
        );
    }


    @PostMapping("/jobs")
    @Transactional
    public Map<String, Object> create(
            @RequestBody CreateJob request
    ) {

        if (request.queueId() == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "queueId is required"
            );
        }


        if (
                request.name() == null
                ||
                request.name().isBlank()
        ) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Job name is required"
            );
        }


        if (
                request.payload() == null
                ||
                request.payload().isBlank()
        ) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Payload is required"
            );
        }


        UUID id = UUID.randomUUID();


        Instant availableAt =
                request.runAt() == null
                        ? Instant.now()
                        : request.runAt();


        String status =
                availableAt.isAfter(
                        Instant.now()
                )
                        ? "SCHEDULED"
                        : "QUEUED";


        try {

            db.update(
                    """
                    INSERT INTO jobs(
                        id,
                        queue_id,
                        name,
                        payload,
                        status,
                        priority,
                        max_attempts,
                        available_at,
                        idempotency_key
                    )

                    VALUES(
                        ?,
                        ?,
                        ?,
                        ?::jsonb,
                        ?,
                        ?,
                        ?,
                        ?,
                        ?
                    )
                    """,

                    id,

                    request.queueId(),

                    request.name(),

                    request.payload(),

                    status,

                    request.priority() == null
                            ? 0
                            : request.priority(),

                    request.maxAttempts() == null
                            ? 3
                            : Math.max(
                                    1,
                                    request.maxAttempts()
                            ),

                    availableAt,

                    normalizeIdempotencyKey(
                            request.idempotencyKey()
                    )
            );

        } catch (DuplicateKeyException exception) {

            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "A job with this idempotency key already exists"
            );
        }


        return job(id);
    }


    private String normalizeIdempotencyKey(
            String key
    ) {

        if (
                key == null
                ||
                key.isBlank()
        ) {
            return null;
        }

        return key.trim();
    }


    @PostMapping("/jobs/batch")
    @Transactional
    public List<Map<String, Object>> batch(
            @RequestBody List<CreateJob> requests
    ) {

        if (
                requests == null
                ||
                requests.isEmpty()
        ) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Batch cannot be empty"
            );
        }


        if (requests.size() > 100) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Maximum batch size is 100 jobs"
            );
        }


        return requests
                .stream()
                .map(this::create)
                .toList();
    }


    @GetMapping("/jobs")
    public List<Map<String, Object>> jobs(
            @RequestParam(
                    defaultValue = "50"
            )
            int limit
    ) {

        int safeLimit =
                Math.max(
                        1,
                        Math.min(limit, 100)
                );


        return db.queryForList(
                """
                SELECT
                    id,
                    queue_id,
                    name,
                    status,
                    priority,
                    attempts,
                    max_attempts,
                    available_at,
                    claimed_by,
                    created_at,
                    updated_at

                FROM jobs

                ORDER BY created_at DESC

                LIMIT ?
                """,
                safeLimit
        );
    }


    @GetMapping("/jobs/{id}")
    public Map<String, Object> job(
            @PathVariable UUID id
    ) {

        List<Map<String, Object>> jobs =
                db.queryForList(
                        """
                        SELECT *
                        FROM jobs
                        WHERE id = ?
                        """,
                        id
                );


        if (jobs.isEmpty()) {

            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Job not found"
            );
        }


        return jobs.get(0);
    }


    @GetMapping("/jobs/{id}/executions")
    public List<Map<String, Object>> executions(
            @PathVariable UUID id
    ) {

        return db.queryForList(
                """
                SELECT *
                FROM job_executions

                WHERE job_id = ?

                ORDER BY attempt_number
                """,
                id
        );
    }


    @GetMapping("/queues")
    public List<Map<String, Object>> queues() {

        return db.queryForList(
                """
                SELECT
                    q.*,
                    p.name AS project_name

                FROM queues q

                JOIN projects p
                    ON p.id = q.project_id

                ORDER BY q.name
                """
        );
    }


    @PostMapping("/queues/{id}/pause")
    public void pause(
            @PathVariable UUID id
    ) {

        int updated =
                db.update(
                        """
                        UPDATE queues
                        SET paused = true
                        WHERE id = ?
                        """,
                        id
                );


        if (updated == 0) {

            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Queue not found"
            );
        }
    }


    @PostMapping("/queues/{id}/resume")
    public void resume(
            @PathVariable UUID id
    ) {

        int updated =
                db.update(
                        """
                        UPDATE queues
                        SET paused = false
                        WHERE id = ?
                        """,
                        id
                );


        if (updated == 0) {

            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Queue not found"
            );
        }
    }


    @GetMapping("/workers")
    public List<Map<String, Object>> workers() {

        return db.queryForList(
                """
                SELECT
                    id,
                    name,
                    status,
                    capacity,
                    started_at,
                    last_heartbeat_at

                FROM workers

                ORDER BY
                    CASE
                        WHEN status = 'ONLINE'
                            THEN 0
                        ELSE 1
                    END,

                    started_at DESC
                """
        );
    }


    @GetMapping("/dlq")
    public List<Map<String, Object>> dlq() {

        return db.queryForList(
                """
                SELECT
                    id,
                    job_id,
                    final_error,
                    failed_at,
                    replayed_at

                FROM dead_letter_entries

                WHERE replayed_at IS NULL

                ORDER BY failed_at DESC
                """
        );
    }


    @PostMapping("/dlq/{id}/replay")
    @Transactional
    public void replay(
            @PathVariable UUID id
    ) {

        List<UUID> jobs =
                db.query(
                        """
                        SELECT job_id

                        FROM dead_letter_entries

                        WHERE id = ?

                          AND replayed_at IS NULL

                        FOR UPDATE
                        """,

                        (resultSet, rowNumber) ->
                                resultSet.getObject(
                                        "job_id",
                                        UUID.class
                                ),

                        id
                );


        if (jobs.isEmpty()) {

            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Active DLQ entry not found"
            );
        }


        UUID jobId =
                jobs.get(0);


        db.update(
                """
                UPDATE jobs

                SET
                    status = 'QUEUED',
                    attempts = 0,
                    claimed_by = NULL,
                    lease_expires_at = NULL,
                    available_at = now(),
                    updated_at = now()

                WHERE id = ?
                """,
                jobId
        );


        db.update(
                """
                UPDATE dead_letter_entries

                SET replayed_at = now()

                WHERE id = ?
                """,
                id
        );
    }
}
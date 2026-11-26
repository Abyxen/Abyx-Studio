# Post-Mortem: Database Migration Outage — 2026-11-20

## Incident Summary
A database index migration on the users table caused a 47-minute production outage affecting 12,000 users. The migration acquired an exclusive table lock, preventing all reads and writes to the affected table.

## Timeline

| Time (UTC) | Event |
|---|---|
| 03:17 | Migration script started on production database |
| 03:17:15 | Exclusive lock acquired on users table |
| 03:19 | Synthetic monitor detects elevated error rate, alert fires |
| 03:22 | On-call engineer acknowledges alert, begins investigation |
| 03:35 | Root cause identified: table-level lock from ALTER TABLE |
| 03:50 | Decision made to rollback migration |
| 04:04 | Rollback completed, table lock released, service restored |

## Root Cause Analysis
The migration used `ALTER TABLE users ADD INDEX ...` which on MySQL/PostgreSQL without the CONCURRENTLY option acquires an exclusive table lock. The script was tested on a 100-row staging database where the lock was held for under 1 second. On the production table with 8 million rows, the lock was held for 47 minutes.

## Impact
- **Outage duration:** 47 minutes (03:17–04:04 UTC)
- **Users affected:** 12,000
- **Failed orders:** 340
- **Revenue impact:** Estimated $17,000

## Resolution
Emergency rollback using the pre-prepared down migration script. The migration was rescheduled for a maintenance window using `CREATE INDEX CONCURRENTLY`.

## Action Items

| Action | Owner | Due Date |
|---|---|---|
| Mandate use of CREATE INDEX CONCURRENTLY for all future index migrations | DBA Team | 2026-12-01 |
| Add migration lock-time estimation to deployment checklist | Platform Team | 2026-11-30 |
| Implement staging-to-production row count parity check before migrations | DevOps | 2026-12-05 |

## Lessons Learned
- Staging environments must have representative data volumes.
- All DDL migrations must be reviewed by a DBA before production deployment.
- Zero-downtime migration patterns must be documented and enforced.

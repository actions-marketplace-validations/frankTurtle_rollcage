# Runbook: database failover

The orders database is a primary with one replica in a second availability zone.

## Symptoms

- `/healthz` stays green but order creation returns 503.
- The replication lag alarm fires and does not clear after 5 minutes.
- The primary is unreachable from two application hosts.

## Steps

1. Page the database owner on the `db-primary` rotation. Do not fail over alone.
2. Confirm the primary is really down: check the cloud console, not only the dashboard.
3. With the database owner on the call, promote the replica using the managed failover action.
4. Update the connection alias `orders-db-primary` to point at the promoted instance. The
   application reads this alias, so no deploy is needed.
5. Watch for reservations that expired during the outage. They are released back to stock
   automatically after the 900 second TTL.

## After

Create a new replica in the original zone. Write the incident summary within two working days.

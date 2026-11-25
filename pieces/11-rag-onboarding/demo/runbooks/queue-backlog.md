# Runbook: fulfilment queue backlog

Paid orders reach the warehouse through the `fulfilment` queue.

## Symptoms

- The oldest message in the queue is more than 20 minutes old.
- The warehouse reports that no new orders have arrived.

## Steps

1. Open the queue dashboard and note the oldest message age and the consumer count.
2. If the consumer count is zero, restart the `fulfilment-worker` service from the console.
3. If consumers are running but the age keeps growing, look at the dead-letter queue. More than
   100 messages there means a bad message is being retried. Move the poison message to the
   `fulfilment-quarantine` queue by hand and leave a note in the incident channel.
4. Do not purge the queue. Paid orders live in it.

## Escalation

If the backlog is still growing after 30 minutes, page the fulfilment team lead.

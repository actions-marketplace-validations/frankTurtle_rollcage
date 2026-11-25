# Runbook: rotate the payment webhook secret

The payment provider signs webhook calls with a shared secret. Rotate it every 90 days and
whenever someone with access leaves the team.

## Steps

1. In the secrets manager, open `tidepool/orders/payment-webhook` and create a new version.
2. Add the new value in the payment provider dashboard as a second signing secret. Both secrets
   are valid during the overlap.
3. Restart the orders service one instance at a time. The service reads the secret at start.
4. After all instances run, remove the old signing secret from the payment provider dashboard.
5. Note the rotation date in the security log.

## Rules

Never paste a secret into chat, a ticket or a pull request. If one is pasted by mistake,
rotate it right away and tell the security channel.

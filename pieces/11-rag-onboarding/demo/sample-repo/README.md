# Tidepool Orders

Tidepool Orders is the service that accepts customer orders, reserves stock and hands paid
orders to fulfilment. This is a made-up service used as sample data for the onboarding agent.

## Layout

- `src/orders/api.py` has the HTTP handlers.
- `src/orders/config.py` reads settings from environment variables.
- `src/orders/pricing.py` computes order totals and discounts.
- `CONTRIBUTING.md` explains how to get your first pull request merged.
- Runbooks for on-call live in the separate `runbooks/` folder.

## Run it locally

Install dependencies with `make setup`. Start the service with `make dev`. It listens on port
8087 and uses an in-memory store unless `ORDERS_DATABASE_URL` is set.

Run the tests with `make test`. The suite takes about 40 seconds on a laptop.

"""Settings for the orders service, read from environment variables."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    port: int
    database_url: str
    stock_reservation_ttl_seconds: int
    payment_webhook_secret_name: str


def load_settings() -> Settings:
    return Settings(
        port=int(os.environ.get("ORDERS_PORT", "8087")),
        database_url=os.environ.get("ORDERS_DATABASE_URL", "memory://"),
        # A reservation that is not paid within this time is released back to stock.
        stock_reservation_ttl_seconds=int(os.environ.get("ORDERS_RESERVATION_TTL", "900")),
        # The secret itself lives in the secrets manager, never in the environment.
        payment_webhook_secret_name=os.environ.get(
            "ORDERS_WEBHOOK_SECRET_NAME", "tidepool/orders/payment-webhook"
        ),
    )

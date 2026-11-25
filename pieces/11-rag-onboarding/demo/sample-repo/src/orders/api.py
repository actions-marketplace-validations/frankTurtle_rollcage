"""HTTP handlers for the orders service."""

from orders.config import load_settings
from orders.pricing import order_total_cents

IDEMPOTENCY_HEADER = "Idempotency-Key"
MAX_LINE_ITEMS = 50


def create_order(headers: dict[str, str], body: dict) -> tuple[int, dict]:
    """POST /orders. Returns (status, json body)."""
    if IDEMPOTENCY_HEADER not in headers:
        # Retried requests must not create two orders, so the key is mandatory.
        return 400, {"error": "missing Idempotency-Key header"}
    items = body.get("items", [])
    if len(items) > MAX_LINE_ITEMS:
        return 422, {"error": f"an order can have at most {MAX_LINE_ITEMS} line items"}
    subtotal = sum(item["unit_cents"] * item["quantity"] for item in items)
    total = order_total_cents(subtotal, body.get("discount_percent", 0))
    settings = load_settings()
    return 201, {
        "total_cents": total,
        "reservation_expires_in": settings.stock_reservation_ttl_seconds,
    }


def get_health() -> tuple[int, dict]:
    """GET /healthz. Used by the load balancer; it does not touch the database."""
    return 200, {"status": "ok"}

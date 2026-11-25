"""Order totals and discounts. All amounts are integer cents."""

MAX_DISCOUNT_PERCENT = 30
FREE_SHIPPING_THRESHOLD_CENTS = 7500
FLAT_SHIPPING_CENTS = 495


def discount_cents(subtotal_cents: int, percent: int) -> int:
    """Return the discount for a subtotal. The percentage is capped at MAX_DISCOUNT_PERCENT."""
    capped = min(percent, MAX_DISCOUNT_PERCENT)
    # Round down so a discount never exceeds what the customer is owed.
    return subtotal_cents * capped // 100


def shipping_cents(subtotal_after_discount_cents: int) -> int:
    """Orders of 75.00 or more ship free. Everything else pays flat shipping."""
    if subtotal_after_discount_cents >= FREE_SHIPPING_THRESHOLD_CENTS:
        return 0
    return FLAT_SHIPPING_CENTS


def order_total_cents(subtotal_cents: int, percent: int) -> int:
    discounted = subtotal_cents - discount_cents(subtotal_cents, percent)
    return discounted + shipping_cents(discounted)

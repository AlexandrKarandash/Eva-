"""Финансовые расчёты: агрегаты по заказам за период + цепочка комиссий Островка."""
from decimal import Decimal
from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone

from .models import Order, OrderStatus, MarkupSettings

# Статусы, в которых деньги реально получены / бронь идёт
REVENUE_STATUSES = (OrderStatus.PAID, OrderStatus.BOOKING, OrderStatus.VOUCHER_ISSUED)

Q = Decimal("0.01")


def period_range(period):
    """('day'|'week'|'month'|'all') -> (start_datetime|None, label)."""
    now = timezone.now()
    if period == 'day':
        return now.replace(hour=0, minute=0, second=0, microsecond=0), "сегодня"
    if period == 'week':
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return start, "с понедельника"
    if period == 'month':
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), "с 1-го числа"
    return None, "за всё время"


def funding_chain_percent(cost_usd):
    """Эффективный % комиссий цепочки пополнения Островка для суммы cost_usd."""
    cost_usd = Decimal(str(cost_usd or 0))
    if cost_usd <= 0:
        return Decimal("0")
    settings_obj = MarkupSettings.load()
    return settings_obj.compute_ostrovok_topup(cost_usd)["total_percent"]


def summarize(period='all'):
    """Сводка по заказам за период. Все суммы в USDT."""
    start, label = period_range(period)
    qs = Order.objects.all()
    if start is not None:
        qs = qs.filter(created_at__gte=start)

    paid = qs.filter(status__in=REVENUE_STATUSES)
    agg = paid.aggregate(
        rev=Sum('amount_usdt'),
        cost=Sum('cost_price_usdt'),
        fee=Sum('abcex_fee_usdt'),
    )
    revenue = agg['rev'] or Decimal("0")
    cost = agg['cost'] or Decimal("0")
    abcex_fee = agg['fee'] or Decimal("0")

    gross_profit = revenue - cost - abcex_fee
    chain_pct = funding_chain_percent(cost)
    chain_cost = (cost * chain_pct / Decimal("100")).quantize(Q)
    net_profit = gross_profit - chain_cost

    count_paid = paid.count()
    avg_check = (revenue / count_paid).quantize(Q) if count_paid else Decimal("0")
    margin = (net_profit / revenue * Decimal("100")).quantize(Q) if revenue else Decimal("0")

    refunded = qs.filter(status=OrderStatus.REFUNDED)
    refunded_sum = refunded.aggregate(s=Sum('amount_usdt'))['s'] or Decimal("0")

    return {
        'period': period,
        'label': label,
        'count_all': qs.count(),
        'count_paid': count_paid,
        'revenue': revenue.quantize(Q),
        'cost': cost.quantize(Q),
        'abcex_fee': abcex_fee.quantize(Q),
        'gross_profit': gross_profit.quantize(Q),
        'chain_percent': chain_pct,
        'chain_cost': chain_cost,
        'net_profit': net_profit.quantize(Q),
        'avg_check': avg_check,
        'margin': margin,
        'markup_percent': MarkupSettings.load().markup_percent,
        'count_refunded': refunded.count(),
        'refunded_sum': refunded_sum.quantize(Q),
    }

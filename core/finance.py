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


def _range_metrics(start, end):
    """Метрики за интервал [start, end). Все суммы USDT."""
    qs = Order.objects.all()
    if start is not None:
        qs = qs.filter(created_at__gte=start)
    if end is not None:
        qs = qs.filter(created_at__lt=end)
    paid = qs.filter(status__in=REVENUE_STATUSES)
    agg = paid.aggregate(rev=Sum('amount_usdt'), cost=Sum('cost_price_usdt'), fee=Sum('abcex_fee_usdt'))
    rev = agg['rev'] or Decimal('0')
    cost = agg['cost'] or Decimal('0')
    fee = agg['fee'] or Decimal('0')
    chain = (cost * funding_chain_percent(cost) / Decimal('100'))
    net = rev - cost - fee - chain
    return {
        'count': paid.count(),
        'revenue': rev.quantize(Q),
        'cost': cost.quantize(Q),
        'net_profit': net.quantize(Q),
    }


def _period_bounds(period):
    """(start, end, prev_start, prev_end) для сравнения с прошлым периодом."""
    now = timezone.now()
    if period == 'day':
        s = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return s, None, s - timedelta(days=1), s
    if period == 'week':
        s = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return s, None, s - timedelta(days=7), s
    if period == 'month':
        s = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_end = s
        prev_start = (s - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return s, None, prev_start, prev_end
    return None, None, None, None  # all — без сравнения


def _pct(cur, prev):
    if not prev:
        return None
    return ((Decimal(cur) - Decimal(prev)) / Decimal(prev) * Decimal('100')).quantize(Decimal('0.1'))


def compare(period='month'):
    """Текущий период vs прошлый: метрики + дельты %."""
    start, end, ps, pe = _period_bounds(period)
    cur = _range_metrics(start, end)
    prev = _range_metrics(ps, pe) if ps is not None else None
    deltas = {}
    if prev is not None:
        for k in ('count', 'revenue', 'cost', 'net_profit'):
            deltas[k] = _pct(cur[k], prev[k])
    return {'current': cur, 'previous': prev, 'deltas': deltas, 'has_prev': prev is not None}


def daily_series(period='month', max_days=31):
    """Серия по дням для графика: [{d, orders, revenue, cost, profit}]."""
    start, end, _, _ = _period_bounds(period)
    if start is None:
        start = timezone.now() - timedelta(days=max_days)
    qs = Order.objects.filter(created_at__gte=start, status__in=REVENUE_STATUSES)
    buckets = {}
    for o in qs.values('created_at', 'amount_usdt', 'cost_price_usdt', 'abcex_fee_usdt'):
        d = timezone.localtime(o['created_at']).strftime('%d.%m')
        b = buckets.setdefault(d, {'orders': 0, 'revenue': Decimal('0'), 'cost': Decimal('0'), 'fee': Decimal('0')})
        b['orders'] += 1
        b['revenue'] += o['amount_usdt'] or Decimal('0')
        b['cost'] += o['cost_price_usdt'] or Decimal('0')
        b['fee'] += o['abcex_fee_usdt'] or Decimal('0')
    labels, orders, revenue, cost, profit = [], [], [], [], []
    for d in sorted(buckets, key=lambda x: (x[3:], x[:2])):
        b = buckets[d]
        labels.append(d)
        orders.append(b['orders'])
        revenue.append(float(b['revenue']))
        cost.append(float(b['cost']))
        profit.append(float(b['revenue'] - b['cost'] - b['fee']))
    return {'labels': labels, 'orders': orders, 'revenue': revenue, 'cost': cost, 'profit': profit}


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

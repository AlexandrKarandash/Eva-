"""Сервис казны: журнал движений баланса депозита ETG (USD)."""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import BalanceMovement, MovementType, MarkupSettings


def current_balance():
    """Текущий баланс депозита = balance_after последнего движения."""
    last = BalanceMovement.objects.order_by('-created_at', '-id').first()
    return last.balance_after if last else Decimal('0.00')


@transaction.atomic
def record_movement(mtype, amount, initiator="система", source_type="", source_id="", comment=""):
    """Создаёт движение с пересчётом before/after. amount со знаком (+ доход, − расход)."""
    amount = Decimal(str(amount or 0))
    # Блокируем последнюю запись, чтобы before/after были консистентны при гонке
    last = BalanceMovement.objects.select_for_update().order_by('-created_at', '-id').first()
    before = last.balance_after if last else Decimal('0.00')
    after = before + amount
    mv = BalanceMovement.objects.create(
        type=mtype, amount=amount, balance_before=before, balance_after=after,
        initiator=initiator, source_type=source_type, source_id=source_id, comment=comment,
    )
    _maybe_low_balance_alert(before, after)
    return mv


def _maybe_low_balance_alert(before, after):
    """Если включён контроль и баланс ПЕРЕСЁК порог сверху вниз — шлём Telegram-алерт."""
    try:
        s = MarkupSettings.load()
        if not s.balance_control_enabled:
            return
        threshold = s.min_balance_usd or Decimal('0')
        if before >= threshold and after < threshold:
            from .utils import send_telegram_notification
            send_telegram_notification(
                f"⚠️ <b>Низкий баланс депозита</b>\n"
                f"Баланс: <b>{after} USD</b> (порог {threshold} USD).\n"
                f"Пополните депозит Островка, иначе бронирования остановятся."
            )
    except Exception:
        pass


def _already_recorded(source_id, mtype):
    return BalanceMovement.objects.filter(source_type='order', source_id=str(source_id), type=mtype).exists()


def record_booking_spend(order):
    """Списание депозита за подтверждённую бронь (идемпотентно)."""
    try:
        if _already_recorded(order.id, MovementType.BOOKING_SPEND):
            return None
        cost = order.cost_price_usdt or Decimal('0')
        if cost <= 0:
            return None
        return record_movement(
            MovementType.BOOKING_SPEND, -cost, initiator="система",
            source_type='order', source_id=str(order.id),
            comment=f"Бронь: {(order.hotel_name or '')[:50]}",
        )
    except Exception:
        return None


def record_booking_refund(order):
    """Возврат на депозит при отмене брони (идемпотентно)."""
    try:
        if _already_recorded(order.id, MovementType.REFUND):
            return None
        cost = order.cost_price_usdt or Decimal('0')
        if cost <= 0:
            return None
        return record_movement(
            MovementType.REFUND, cost, initiator="система",
            source_type='order', source_id=str(order.id),
            comment=f"Возврат брони: {(order.hotel_name or '')[:50]}",
        )
    except Exception:
        return None


def confirm_topup(topup, initiator="админ"):
    """Подтверждает заявку: создаёт движение + на сумму пополнения."""
    if topup.movement_id:
        return topup.movement
    mv = record_movement(
        MovementType.TOPUP, topup.amount_usd, initiator=initiator,
        source_type='topup', source_id=str(topup.id),
        comment=f"Пополнение депозита (отправлено {topup.usdt_to_send} USDT)",
    )
    from .models import TopupStatus
    topup.status = TopupStatus.CONFIRMED
    topup.confirmed_at = timezone.now()
    topup.movement = mv
    topup.save(update_fields=['status', 'confirmed_at', 'movement'])
    return mv


def balance_status():
    """Возвращает (balance, threshold, is_low, control_on)."""
    s = MarkupSettings.load()
    bal = current_balance()
    threshold = s.min_balance_usd or Decimal('0')
    is_low = bool(s.balance_control_enabled and bal < threshold)
    return bal, threshold, is_low, bool(s.balance_control_enabled)

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone
import logging
from .models import Order, OrderStatus, Transaction
from .services import abcex_service  
from .utils import notify_status_change  

logger = logging.getLogger(__name__)



@shared_task
def expire_unpaid_order_task(order_id):
    try:
        with transaction.atomic():
            order = Order.objects.select_for_update().get(id=order_id)
            if order.status == OrderStatus.PENDING_PAYMENT:
                order.status = OrderStatus.FAILED
                order.save(update_fields=["status"])
                logger.info("Order %s expired after unpaid timeout", order_id)
    except Order.DoesNotExist:
        pass

@shared_task
def process_successful_payment_task(order_id):
    try:
        with transaction.atomic():
            order = Order.objects.select_for_update().get(id=order_id)

            if order.status != OrderStatus.PENDING_PAYMENT:
                return

            order.status = OrderStatus.PAID
            order.paid_at = order.paid_at or timezone.now()
            order.save(update_fields=["status", "paid_at"])
    except Order.DoesNotExist:
        return


def schedule_unpaid_order_expiration(order_id):
    countdown = int(getattr(settings, "PAYMENT_EXPIRATION_SECONDS", 1200))

    def enqueue():
        try:
            expire_unpaid_order_task.apply_async(args=[str(order_id)], countdown=countdown)
        except Exception as exc:
            logger.error("Could not schedule unpaid order expiration for %s: %s", order_id, exc)

    transaction.on_commit(enqueue)


@shared_task(bind=True, max_retries=5)
def verify_and_expire_order_task(self, order_id):
    """
    Проверяет платеж перед отменой заказа. 
    Если биржа недоступна, задача переносится на более позднее время.
    """
    try:
        with transaction.atomic():
            # Блокируем строку заказа
            order = Order.objects.select_for_update().get(id=order_id)
            
            # Если заказ уже оплачен или отменен менеджером, ничего не делаем
            if order.status != OrderStatus.PENDING_PAYMENT:
                logger.info(f"Таска проверки: Заказ #{order_id} уже в статусе {order.status}. Проверка отменена.")
                return

            tx_record = Transaction.objects.select_for_update().filter(order=order).first()
            if not tx_record:
                logger.error(f"Таска проверки: Транзакция для заказа #{order_id} не найдена. Отменяем.")
                order.status = OrderStatus.FAILED
                order._change_reason = "Отмена: данные транзакции отсутствуют в БД."
                order.save(update_fields=['status'])
                return

        # Запрашиваем шлюз вне транзакции атомика, чтобы не держать лог базы во время HTTP-запроса
        payment_info = abcex_service.check_payment(
            target_address=tx_record.to_address,
            expected_amount=order.amount_usdt
        )

        # КЕЙС 1: Оплата успешно найдена
        if payment_info.get("paid"):
            with transaction.atomic():
                order = Order.objects.select_for_update().get(id=order_id)
                if order.status == OrderStatus.PENDING_PAYMENT:
                    order.status = OrderStatus.PAID
                    order.paid_at = timezone.now()
                    order._change_reason = f"Celery: Оплата подтверждена шлюзом. TXID: {payment_info.get('txId')}"
                    order.save(update_fields=['status', 'paid_at'])
                    
                    tx_record = Transaction.objects.select_for_update().filter(order=order).first()
                    tx_record.confirmed = True
                    tx_record.tx_hash = payment_info.get("txId")
                    tx_record.save()
                    
                    notify_status_change(order, title="Оплата успешно зафиксирована фоновым воркером")
            return

        # КЕЙС 2: КРИТИЧЕСКИЙ. Биржа лежит/ошибка сети
        if payment_info.get("reason") == "connection_error":
            logger.warning(f"Биржа ABCEX недоступна при проверке заказа #{order_id}. Перезапуск таски через 120 секунд.")
            # self.retry не убивает таску, а откладывает её выполнение на 2 минуты 
            raise self.retry(countdown=120)

        # КЕЙС 3: Биржа ответила "not_found" (денег нет) и время на оплату реально вышло
        with transaction.atomic():
            order = Order.objects.select_for_update().get(id=order_id)
            if order.status == OrderStatus.PENDING_PAYMENT:
                order.status = OrderStatus.FAILED
                order._change_reason = "Срок ожидания оплаты истек. Транзакция не найдена на шлюзе ABCEX."
                order.save(update_fields=['status'])
                
                logger.info(f"Заказ #{order_id} успешно переведен в FAILED (время вышло).")
                notify_status_change(order, title="Заказ отменен", extra_info="Время на оплату вышло.")

    except self.retry_class as e:
        # Пробрасываем исключение Celery retry дальше, чтобы воркер понял, что это перезапуск
        raise e
    except Exception as exc:
        logger.error(f"Непредвиденная ошибка в таске проверки заказа #{order_id}: {exc}")
        # Если упало что-то системное, пробуем перезапустить через минуту
        raise self.retry(exc=exc, countdown=60)
import re
import logging
from django.core.files.base import ContentFile
from django.core.mail import EmailMessage
from django.template.loader import render_to_string
from django.utils import timezone
from django.conf import settings  # Стандартный импорт настроек Django для универсальности

# Подключаем weasyprint для генерации честного PDF из HTML
import weasyprint

from .models import Order, InboundEmail, VoucherDocument, VoucherStatus, EmailProcessingStatus, OrderStatus

logger = logging.getLogger(__name__)

def issue_aifory_voucher(order):
    """
    Генерирует ваучер Aifory (с клиентской ценой = наценка включена) и отправляет
    его клиенту на order.user_email. Вызывается сразу после подтверждения брони,
    без ожидания входящего письма от ETG. Идемпотентно: повторно не отправляет.
    Не бросает исключение наружу — сбой почты не должен ронять бронирование.
    """
    try:
        if order.vouchers.filter(status=VoucherStatus.SENT).exists():
            logger.info("Aifory voucher for order %s already sent — skip", order.id)
            return False

        voucher_doc = VoucherDocument.objects.create(
            order=order,
            sent_to_email=order.user_email,
            status=VoucherStatus.GENERATED,
        )
        VoucherEmailProcessor.generate_our_voucher(order, voucher_doc)
        VoucherEmailProcessor.send_voucher_to_client(order, voucher_doc)
        logger.info("Aifory voucher for order %s generated and sent to %s", order.id, order.user_email)
        return True
    except Exception as exc:
        logger.error("Failed to issue Aifory voucher for order %s: %s", getattr(order, 'id', '?'), exc)
        return False


class VoucherEmailProcessor:

    @staticmethod
    def extract_booking_id(subject, body):
        """
        Ищет ID бронирования партнёра в теме или тексте письма.
        Логика адаптируется под формат писем конкретного провайдера (например, Emerging Travel / RateHawk).
        """
        # Ищем паттерны вида: "Заказ № 1234567", "Booking ID: 1234567", "Order #1234567"
        patterns = [
            r'(?:заказ|order|booking)\s*(?:№|#)?\s*(\d+)',
            r'id:\s*(\d+)'
        ]
        
        for pattern in patterns:
            match_subj = re.search(pattern, subject, re.IGNORECASE)
            if match_subj:
                return match_subj.group(1)
                
            match_body = re.search(pattern, body, re.IGNORECASE)
            if match_body:
                return match_body.group(1)
        return None

    @classmethod
    def process_inbound_email(cls, inbound_email_obj, partner_file=None):
        """
        Основной пайплайн обработки входящего письма
        """
        try:
            booking_id = cls.extract_booking_id(inbound_email_obj.subject, inbound_email_obj.body)
            if not booking_id:
                raise ValueError("Не удалось извлечь partner_booking_id из текста или темы письма.")
            
            inbound_email_obj.parsed_booking_id = booking_id
            
            # Ищем заказ в нашей базе (emerging_booking_id — это ваш ID от партнёра)
            order = Order.objects.filter(emerging_booking_id=booking_id).first()
            if not order:
                raise Order.DoesNotExist(f"Заказ с partner_booking_id={booking_id} не найден в БД.")
            
            inbound_email_obj.order = order
            
            # Создаем запись документа ваучера
            voucher_doc = VoucherDocument.objects.create(
                order=order,
                sent_to_email=order.user_email,
                status=VoucherStatus.RECEIVED
            )
            
            if partner_file:
                voucher_doc.original_voucher_file.save(partner_file.name, partner_file, save=True)
            
            order.voucher_status = VoucherStatus.RECEIVED
            order.save(update_fields=['voucher_status'])
            
            # Генерируем новый ваучер
            cls.generate_our_voucher(order, voucher_doc)
            
            # Отправляем ваучер клиенту
            cls.send_voucher_to_client(order, voucher_doc)
            
            # Финализируем статусы
            inbound_email_obj.processing_status = EmailProcessingStatus.PROCESSED
            inbound_email_obj.error_message = None
            inbound_email_obj.save()
            
        except Order.DoesNotExist as e:
            inbound_email_obj.processing_status = EmailProcessingStatus.MANUAL
            inbound_email_obj.error_message = str(e)
            inbound_email_obj.save()
        except Exception as e:
            inbound_email_obj.processing_status = EmailProcessingStatus.FAILED
            inbound_email_obj.error_message = str(e)
            inbound_email_obj.save()
            if inbound_email_obj.order:
                inbound_email_obj.order.voucher_status = VoucherStatus.FAILED
                inbound_email_obj.order.save(update_fields=['voucher_status'])

    @staticmethod
    def generate_our_voucher(order, voucher_doc):
        """
        Генерация полноценного PDF-ваучера, визуально повторяющего официальный бланк,
        но в фирменном стиле Aifory Pro и с конечной стоимостью (включающей наценку).
        """
        # Собираем данные для ваучера
        context = {
            'order': order,
            'client_price': order.amount_usdt,  # Финальная цена с вашей наценкой
            'hotel_name': order.hotel_name,
            'check_in': order.check_in,
            'check_out': order.check_out,
            'guest_name': order.guest_name,
            'room_details': order.room_details,
            # Номер бронирования (берём из сохраненного emerging_booking_id или id заказа)
            'booking_id': getattr(order, 'emerging_booking_id', order.id), 
        }
        
        # Рендерим HTML-шаблон, стилизованный под ваш сайт
        html_string = render_to_string('vouchers/partner_style_voucher.html', context)
        
        try:
            # Генерируем реальный бинарный PDF из строки HTML через WeasyPrint
            pdf_bytes = weasyprint.HTML(string=html_string).write_pdf()
        except Exception as e:
            logger.error(f"Ошибка компиляции PDF-ваучера для заказа {order.id}: {e}")
            raise e
        
        # Формируем имя файла
        filename = f"voucher_{order.id}.pdf"
        
        # Сохраняем сгенерированный бинарник в поле модели
        voucher_doc.generated_voucher_file.save(filename, ContentFile(pdf_bytes), save=True)
        
        # Переводим статусы в состояние "Сгенерировано"
        voucher_doc.status = VoucherStatus.GENERATED
        voucher_doc.save(update_fields=['status'])
        
        order.voucher_status = VoucherStatus.GENERATED
        order.save(update_fields=['voucher_status'])

    @staticmethod
    def send_voucher_to_client(order, voucher_doc):
        """
        Отправка созданного ваучера на почту клиента.
        Оригинальный файл партнёра умышленно игнорируется.
        """
        subject = f"Ваш ваучер на бронирование в {order.hotel_name} — Aifory Pro"
        body = "Здравствуйте!\n\nВо вложении к этому письму находится ваш официальный ваучер для заселения.\nПриятного отдыха!"
        
        email = EmailMessage(
            subject,
            body,
            settings.DEFAULT_FROM_EMAIL,
            [order.user_email]
        )
        
        # Читаем файл из хранилища и прикрепляем
        if voucher_doc.generated_voucher_file:
            email.attach(
                f"Voucher_{order.id}.pdf",
                voucher_doc.generated_voucher_file.read(),
                'application/pdf'
            )
            
        email.send()
        
        # Обновляем временные метки и статусы
        voucher_doc.status = VoucherStatus.SENT
        voucher_doc.sent_at = timezone.now()
        voucher_doc.save(update_fields=['status', 'sent_at'])
        
        order.voucher_status = VoucherStatus.SENT
        order.status = OrderStatus.VOUCHER_ISSUED  # Меняем глобальный статус заказа на "Готово"
        order.save(update_fields=['voucher_status', 'status'])
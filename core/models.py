import hashlib
import secrets
import uuid
from django.db import models
from django.conf import settings
from django.utils import timezone

class OrderStatus(models.TextChoices):
    PENDING_PAYMENT = 'pending_payment', 'Ожидание оплаты'
    PAID = 'paid', 'Оплачено'
    PENDING = 'pending', 'В обработке (ожидание ID)' 
    BOOKING = 'booking', 'В процессе бронирования'
    
    VOUCHER_ISSUED = 'voucher_issued', 'Ваучер готов'
    FAILED = 'failed', 'Ошибка'
    
    CANCELLED = 'cancelled', 'Отменено' 
    REFUNDED = 'refunded', 'Возврат'

class NetworkChoices(models.TextChoices):
    TRC20 = 'TRC20', 'TRON (TRC-20)'
    ERC20 = 'ERC20', 'Ethereum (ERC-20)'


class HotelCache(models.Model):
    id = models.CharField(max_length=50, primary_key=True)
    name = models.CharField(max_length=255, null=True, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    stars = models.IntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Кэш отеля"
        verbose_name_plural = "Кэш отелей"

class VoucherStatus(models.TextChoices):
    NOT_RECEIVED = 'not_received', 'Не получен'
    RECEIVED = 'voucher_received', 'Получен от партнёра'
    GENERATED = 'voucher_generated', 'Сгенерирован наш ваучер'
    SENT = 'voucher_sent', 'Отправлен клиенту'
    FAILED = 'failed', 'Ошибка обработки'

class EmailProcessingStatus(models.TextChoices):
    PENDING = 'pending', 'В очереди'
    PROCESSED = 'processed', 'Успешно обработано'
    FAILED = 'failed', 'Ошибка обработки'
    MANUAL = 'manual', 'Требует ручной обработки'

class Order(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField()
    hotel_name = models.TextField()
    hotel_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    hotel_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    
    room_details = models.TextField(blank=True, null=True)
    check_in = models.DateField()
    check_out = models.DateField()
    guest_name = models.CharField(max_length=255, null=True, blank=True)
    
    # Финансовые показатели
    amount_usdt = models.DecimalField(max_digits=12, decimal_places=2)
    amount_rub = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    cost_price_usdt = models.DecimalField(max_digits=12, decimal_places=2)
    

    voucher_status = models.CharField(max_length=30, choices=VoucherStatus.choices, default=VoucherStatus.NOT_RECEIVED)

    status = models.CharField(
        max_length=20, 
        choices=OrderStatus.choices, 
        default=OrderStatus.PENDING_PAYMENT
    )
    
    rate_key = models.TextField()
    emerging_booking_id = models.CharField(max_length=255, null=True, blank=True)
    voucher_url = models.TextField(null=True, blank=True)
    access_token_hash = models.CharField(max_length=64, blank=True, default="")
    
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Заказ {self.id} - {self.status}"

    @staticmethod
    def hash_access_token(token):
        return hashlib.sha256(str(token).encode("utf-8")).hexdigest()

    def issue_access_token(self):
        token = secrets.token_urlsafe(32)
        self.access_token_hash = self.hash_access_token(token)
        self.save(update_fields=["access_token_hash"])
        return token

    def has_access_token(self, token):
        if not token or not self.access_token_hash:
            return False
        token_hash = self.hash_access_token(token)
        return secrets.compare_digest(token_hash, self.access_token_hash)

    class Meta:
        verbose_name = "Заказ"
        verbose_name_plural = "Заказы"

    def save(self, *args, **kwargs):
        _changed_by = getattr(self, '_changed_by', None)
        _change_reason = getattr(self, '_change_reason', None)

        if self.pk:
            old_status = Order.objects.filter(pk=self.pk).values_list('status', flat=True).first()
            if old_status != self.status:
                super().save(*args, **kwargs)  
                
                OrderStatusHistory.objects.create(
                    order=self,
                    old_status=old_status,
                    new_status=self.status,
                    changed_by=_changed_by,
                    reason=_change_reason
                )
                return
                
        super().save(*args, **kwargs)

class InboundEmail(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_email = models.CharField(max_length=255, verbose_name="Отправитель")
    subject = models.CharField(max_length=512, verbose_name="Тема письма", blank=True)
    body = models.TextField(verbose_name="Тело письма (текст/html)", blank=True)
    
    # Сюда сохраняем оригинальный файл письма (.eml) или метаданные вложений
    original_file = models.FileField(upload_to='inbound_emails/%Y/%m/%d/', null=True, blank=True, verbose_name="Файл письма/Вложение")
    
    parsed_booking_id = models.CharField(max_length=255, null=True, blank=True, verbose_name="Распарсенный ID брони")
    processing_status = models.CharField(
        max_length=20, 
        choices=EmailProcessingStatus.choices, 
        default=EmailProcessingStatus.PENDING,
        verbose_name="Статус обработки"
    )
    order = models.ForeignKey(
        'Order', 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='inbound_emails',
        verbose_name="Связанный заказ"
    )
    error_message = models.TextField(null=True, blank=True, verbose_name="Текст ошибки")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Дата получения")

    class Meta:
        verbose_name = "Входящее письмо"
        verbose_name_plural = "Входящие письма"
        ordering = ['-created_at']

    def __str__(self):
        return f"Письмо от {self.from_email} - {self.subject[:30]}"


class VoucherDocument(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('Order', on_delete=models.CASCADE, related_name='vouchers', verbose_name="Заказ")
    
    original_voucher_file = models.FileField(upload_to='vouchers/partner/%Y/%m/%d/', verbose_name="Оригинальный ваучер партнёра")
    generated_voucher_file = models.FileField(upload_to='vouchers/client/%Y/%m/%d/', null=True, blank=True, verbose_name="Наш сгенерированный ваучер")
    
    sent_to_email = models.EmailField(verbose_name="Email отправки")
    status = models.CharField(max_length=30, choices=VoucherStatus.choices, default=VoucherStatus.RECEIVED)
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Создан")
    sent_at = models.DateTimeField(null=True, blank=True, verbose_name="Отправлен клиенту")

    class Meta:
        verbose_name = "Документ ваучера"
        verbose_name_plural = "Документы ваучеров"

    def __str__(self):
        return f"Ваучер для заказа {self.order_id} ({self.status})"

class Transaction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='transactions')
    
    tx_hash = models.CharField(
        max_length=255, 
        unique=True, 
        null=True, 
        blank=True, 
        verbose_name="Хэш транзакции"
    )
    network = models.CharField(
        max_length=10, 
        choices=NetworkChoices.choices, 
        default=NetworkChoices.TRC20
    )
    
    from_address = models.CharField(max_length=255, null=True, blank=True)
    to_address = models.CharField(max_length=255)
    
    amount_usdt = models.DecimalField(max_digits=12, decimal_places=2)
    
    confirmed = models.BooleanField(default=False)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    
    raw_response = models.JSONField(null=True, blank=True)

    def __str__(self):
        return f"TX {self.tx_hash or 'Pending'} for Order {self.order.id}"

    class Meta:
        verbose_name = "Транзакция"
        verbose_name_plural = "Транзакции"

class HotelStatic(models.Model):
    hotel_id = models.CharField(max_length=100, unique=True, verbose_name="ID отеля (строковый)")
    hid = models.BigIntegerField(null=True, blank=True, verbose_name="Числовой HID")
    name = models.CharField(max_length=255, null=True, blank=True, verbose_name="Название отеля")
    address = models.TextField(null=True, blank=True, verbose_name="Адрес")
    star_rating = models.IntegerField(default=0, verbose_name="Количество звезд")
    description = models.TextField(null=True, blank=True, verbose_name="Описание (HTML)")
    kind = models.CharField(max_length=100, null=True, blank=True, verbose_name="Тип объекта (отель, апарт и т.д.)")
    latitude = models.FloatField(null=True, blank=True, verbose_name="Широта")
    longitude = models.FloatField(null=True, blank=True, verbose_name="Долгота")
    
    phone = models.CharField(max_length=50, null=True, blank=True, verbose_name="Телефон")
    email = models.EmailField(null=True, blank=True, verbose_name="Email")
    
    check_in_time = models.CharField(max_length=50, null=True, blank=True, verbose_name="Время заезда")
    check_out_time = models.CharField(max_length=50, null=True, blank=True, verbose_name="Время выезда")
    postal_code = models.CharField(max_length=20, null=True, blank=True, verbose_name="Почтовый индекс")
    city = models.CharField(max_length=100, null=True, blank=True, verbose_name="Город")
    country_code = models.CharField(max_length=10, null=True, blank=True, verbose_name="Код страны")
    hotel_chain = models.CharField(max_length=100, null=True, blank=True, verbose_name="Сеть отелей")
    important_info = models.TextField(null=True, blank=True, verbose_name="Важная информация (правила)")
    amenities_list = models.TextField(null=True, blank=True, verbose_name="Список всех удобств")


    def __str__(self):
        return f"{self.name or self.hotel_id}"

class HotelImage(models.Model):
    hotel = models.ForeignKey(HotelStatic, related_name='images', on_delete=models.CASCADE)
    url_template = models.URLField()

    def get_url(self, size='x500'):
        return self.url_template.replace('{size}', size)
    
class HotelRoomStatic(models.Model):
    hotel = models.ForeignKey(HotelStatic, on_delete=models.CASCADE, related_name='rooms', verbose_name="Отель")
    room_ext_id = models.CharField(max_length=255, unique=True, db_index=True, verbose_name="Идентификатор сопоставления (ext)")
    name = models.CharField(max_length=255, verbose_name="Название типа номера")
    amenities = models.JSONField(default=list, blank=True, verbose_name="Удобства в номере")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Статика номера"
        verbose_name_plural = "Статика номеров"

    def __str__(self):
        return f"{self.name} ({self.room_ext_id})"

class RoomImage(models.Model):
    room = models.ForeignKey(HotelRoomStatic, on_delete=models.CASCADE, related_name='images', verbose_name="Тип номера")
    url_template = models.URLField(verbose_name="Ссылка на фото номера")

    def get_url(self, size='x500'):
        return self.url_template.replace('{size}', size)
    


class City(models.Model):
    name = models.CharField(max_length=100, unique=True, verbose_name="Название города")
    latitude = models.FloatField(null=True, blank=True, verbose_name="Широта центра")
    longitude = models.FloatField(null=True, blank=True, verbose_name="Долгота центра")
    country_code = models.CharField(max_length=10, null=True, blank=True, verbose_name="Код страны")

    class Meta:
        verbose_name = "Город"
        verbose_name_plural = "Города"

    def __str__(self):
        return f"{self.name} ({self.country_code})"

class HotelNearbyCache(models.Model):
    hotel = models.ForeignKey(
        HotelStatic,
        on_delete=models.CASCADE,
        related_name='nearby_cache',
        null=True,
        blank=True,
        verbose_name="Отель"
    )
    etg_hotel_id = models.CharField(max_length=100, db_index=True, verbose_name="ID отеля")
    hid = models.BigIntegerField(null=True, blank=True, db_index=True, verbose_name="HID")
    region_id = models.CharField(max_length=64, null=True, blank=True, db_index=True, verbose_name="ID региона")
    city = models.CharField(max_length=100, null=True, blank=True, db_index=True, verbose_name="Город")
    country_code = models.CharField(max_length=10, null=True, blank=True, verbose_name="Код страны")
    latitude = models.FloatField(null=True, blank=True, verbose_name="Широта")
    longitude = models.FloatField(null=True, blank=True, verbose_name="Долгота")

    metro = models.JSONField(default=list, blank=True, verbose_name="Метро")
    attractions = models.JSONField(default=list, blank=True, verbose_name="Достопримечательности")
    stations = models.JSONField(default=list, blank=True, verbose_name="Станции / вокзалы")
    airports = models.JSONField(default=list, blank=True, verbose_name="Аэропорты")
    around = models.JSONField(default=list, blank=True, verbose_name="Места рядом")

    source = models.CharField(max_length=64, default='osm', verbose_name="Источник")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Обновлено")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Создано")

    class Meta:
        verbose_name = "Кэш мест рядом с отелем"
        verbose_name_plural = "Кэш мест рядом с отелями"
        indexes = [
            models.Index(fields=['etg_hotel_id'], name='core_hoteln_hotel_i_c81de4_idx'),
            models.Index(fields=['hid'], name='core_hoteln_hid_87b70a_idx'),
            models.Index(fields=['city'], name='core_hoteln_city_ead783_idx'),
            models.Index(fields=['region_id'], name='core_hoteln_region__d9512b_idx'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['etg_hotel_id'], name='unique_nearby_cache_etg_hotel_id'),
        ]

    def __str__(self):
        return f"{self.etg_hotel_id} — nearby cache"

    def as_payload(self):
        return {
            "around": self.around or [],
            "attractions": self.attractions or [],
            "airports": self.airports or [],
            "stations": self.stations or [],
            "metro": self.metro or [],
        }


class OrderStatusHistory(models.Model):
    order = models.ForeignKey(
        'Order', 
        on_delete=models.CASCADE, 
        related_name='status_history',
        verbose_name="Заказ"
    )
    old_status = models.CharField(max_length=32, verbose_name="Старый статус", null=True, blank=True)
    new_status = models.CharField(max_length=32, verbose_name="Новый статус")
    changed_at = models.DateTimeField(default=timezone.now, verbose_name="Дата изменения")
    

    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Автор изменений"
    )
    reason = models.TextField(verbose_name="Причина / Комментарий", null=True, blank=True)

    class Meta:
        ordering = ['-changed_at']
        verbose_name = "История статуса заказа"
        verbose_name_plural = "История статусов заказов"

    def __str__(self):
        return f"Заказ #{self.order_id}: {self.old_status} -> {self.new_status}"
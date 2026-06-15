from django.contrib import admin, messages
from django.utils.html import format_html
from django.urls import reverse
from django.shortcuts import render
from django.http import HttpResponseRedirect

# Импортируем старые и новые модели
from .models import (
    City, OrderStatus, NetworkChoices, HotelCache, Order, Transaction, 
    HotelStatic, HotelImage, HotelNearbyCache, InboundEmail, VoucherDocument,
    HotelRoomStatic, RoomImage, OrderStatusHistory  # <-- Добавили новые модели сюда
)
from .services import etg_service, abcex_service
from .views import _safe_voucher_url, notify_status_change
from .email_processor import VoucherEmailProcessor

# --- Inlines (Встроенные блоки) ---

class TransactionInline(admin.TabularInline):
    model = Transaction
    extra = 0
    readonly_fields = ('confirmed_at', 'explorer_link', 'raw_response')
    fields = ('tx_hash', 'network', 'amount_usdt', 'confirmed', 'confirmed_at', 'explorer_link')
    
    @admin.display(description="TronScan")
    def explorer_link(self, obj):
        if obj.tx_hash and obj.network == NetworkChoices.TRC20:
            url = f"https://tronscan.org/#/transaction/{obj.tx_hash}"
            return format_html('<a href="{}" target="_blank">🔗 Посмотреть</a>', url)
        return "—"


class OrderStatusHistoryInline(admin.TabularInline):
    """Отображение истории изменения статусов прямо в карточке заказа"""
    model = OrderStatusHistory
    extra = 0
    readonly_fields = ('old_status', 'new_status', 'changed_at', 'changed_by', 'reason')
    can_delete = False
    ordering = ('-changed_at',)
    
    verbose_name = "Изменение статуса"
    verbose_name_plural = "История изменений статусов"


class HotelImageInline(admin.StackedInline):
    model = HotelImage
    extra = 1
    classes = ('collapse',)


class RoomImageInline(admin.TabularInline):
    """Отображение картинок внутри карточки конкретного типа номера"""
    model = RoomImage
    extra = 1
    verbose_name = "Фотография номера"
    verbose_name_plural = "Фотографии номеров"


class HotelRoomStaticInline(admin.TabularInline):
    """Отображение списка номеров прямо внутри карточки отеля"""
    model = HotelRoomStatic
    extra = 0
    fields = ('name', 'room_ext_id', 'edit_link')
    readonly_fields = ('edit_link',)
    can_delete = False
    
    verbose_name = "Тип номера"
    verbose_name_plural = "Сопоставленные типы номеров (Статика)"

    @admin.display(description="Действие")
    def edit_link(self, obj):
        if obj.pk:
            # Ссылка для перехода к детальному редактированию номера (и его картинок)
            url = reverse("admin:core_hotelroomstatic_change", args=[obj.pk])
            return format_html('<a href="{}" target="_blank">📝 Управление номером и фото</a>', url)
        return "—"


# --- Model Admins ---

@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    # Добавили voucher_status в список отображения
    list_display = (
        'id_short', 'status_colored', 'voucher_status', 'user_email', 
        'hotel_name_short', 'amount_display', 'created_at'
    )
    list_filter = ('status', 'voucher_status', 'created_at', 'check_in')
    search_fields = ('id', 'user_email', 'hotel_name', 'emerging_booking_id')
    
    actions = ['update_etg_status', 'mark_refunded']

    fieldsets = (
        ('Основная информация', {
            # Добавили поле voucher_status в карточку
            'fields': (('status', 'voucher_status'), 'user_email', 'guest_name')
        }),
        ('Детали бронирования', {
            'fields': ('hotel_name', ('check_in', 'check_out'))
        }),
        ('Финансы', {
            'fields': (('amount_usdt', 'cost_price_usdt'), 'paid_at')
        }),
        ('Служебная информация ETG', {
            'classes': ('collapse',),
            'fields': ('rate_key', 'emerging_booking_id', ('hotel_latitude', 'hotel_longitude'))
        }),
    )
    # ИСПРАВЛЕНО: Добавили историю статусов OrderStatusHistoryInline к транзакциям
    inlines = [TransactionInline, OrderStatusHistoryInline]
    readonly_fields = ('created_at', 'id', 'paid_at')

    @admin.display(description="Сумма USDT")
    def amount_display(self, obj):
        return format_html('<b>{} ₮</b>', obj.amount_usdt)

    @admin.action(description='Обновить статус в ETG')
    def update_etg_status(self, request, queryset):
        success_count = 0
        pending_count = 0
        error_count = 0
        for order in queryset:
            status_result = etg_service.check_booking_status(order.id)
            if status_result and status_result.get('status') == 'ok':
                data = status_result.get('data') or {}
                if data.get('percent') == 100:
                    order_info = etg_service.get_final_order_details(order.id)
                    if order_info:
                        etg_id = order_info.get('order_id')
                        if etg_id: order.emerging_booking_id = str(etg_id)
                        etg_status = str(order_info.get('status', '')).lower()
                        docs = order_info.get('documents', [])
                        voucher_link = None
                        for doc in docs:
                            if doc.get('type') == 'voucher' and doc.get('url'):
                                voucher_link = doc.get('url')
                                safe_url = _safe_voucher_url(voucher_link)
                                if safe_url:
                                    order.voucher_url = safe_url
                                break
                        success_statuses = ['confirmed', 'done', 'completed', 'success']
                        if etg_status in success_statuses or voucher_link:
                            order.status = OrderStatus.VOUCHER_ISSUED
                        elif etg_status in ['cancelled', 'failed', 'declined']:
                            order.status = OrderStatus.FAILED
                        order.save()
                        if order.status == OrderStatus.VOUCHER_ISSUED:
                            notify_status_change(order, title="✅ Статус обновлен через админ-панель")
                        success_count += 1
                    else: error_count += 1
                else: pending_count += 1
            else: error_count += 1

        if success_count: self.message_user(request, f"Успешно: {success_count}", messages.SUCCESS)
        if pending_count: self.message_user(request, f"В процессе: {pending_count}", messages.WARNING)
        if error_count: self.message_user(request, f"Ошибки: {error_count}", messages.ERROR)

    @admin.action(description='Отметить как возвращенные')
    def mark_refunded(self, request, queryset):
        refunded_count = 0
        skipped_count = 0
        invalid_status_count = 0 
        abcex_error_count = 0

        ALLOWED_STATUSES = [
            OrderStatus.PAID, 
            OrderStatus.BOOKING, 
            OrderStatus.VOUCHER_ISSUED
        ]

        for order in queryset:
            if order.status == OrderStatus.REFUNDED:
                skipped_count += 1
                continue

            if order.status not in ALLOWED_STATUSES:
                invalid_status_count += 1
                self.message_user(
                    request, 
                    f"Ошибка: Заказ #{order.id} имеет статус '{order.get_status_display()}'. Возврат невозможен.", 
                    level=messages.ERROR
                )
                continue

            tx_record = Transaction.objects.filter(order=order).first()
            if not tx_record or not tx_record.from_address:
                invalid_status_count += 1
                self.message_user(
                    request, 
                    f"Ошибка: У заказа #{order.id} нет адреса отправителя для возврата.", 
                    level=messages.ERROR
                )
                continue
                
            refund_result = abcex_service.create_withdrawal(
                address_to=tx_record.from_address,
                amount=order.amount_usdt
            )
            
            if not refund_result.get("success"):
                abcex_error_count += 1
                self.message_user(
                    request, 
                    f"Ошибка API ABCEX при возврате заказа #{order.id}: {refund_result.get('error')}", 
                    level=messages.ERROR
                )
                continue

            previous_status = order.get_status_display()
            
            # Передаем автора изменений и причину в переопределенный метод save() модели Order
            order._changed_by = request.user
            order._change_reason = f"Автоматический возврат USDT через API ABCEX. ID выплаты: {refund_result.get('withdrawal_id')}"
            
            order.status = OrderStatus.REFUNDED
            order.save(update_fields=['status'])
            
            notify_status_change(
                order,
                title="Возврат отмечен в админ-панели",
                extra_info=f"Предыдущий статус: {previous_status}. ID выплаты: {refund_result.get('withdrawal_id')}",
            )
            refunded_count += 1

        if refunded_count:
            self.message_user(request, f"Возврат успешно оформлен для {refunded_count} зак.", messages.SUCCESS)
        if skipped_count:
            self.message_user(request, f"Заказов уже было в статусе возврата: {skipped_count}", messages.WARNING)
        if invalid_status_count:
            self.message_user(request, f"Пропущено из-за неверного статуса/отсутствия транзакции: {invalid_status_count}", messages.ERROR)
        if abcex_error_count:
            self.message_user(request, f"Не удалось вернуть через ABCEX (ошибка API): {abcex_error_count}", messages.ERROR)

    @admin.display(description="ID")
    def id_short(self, obj):
        return str(obj.id)[:8] + "..."

    @admin.display(description="Отель")
    def hotel_name_short(self, obj):
        return (obj.hotel_name[:30] + '..') if len(obj.hotel_name) > 30 else obj.hotel_name

    @admin.display(description="Статус")
    def status_colored(self, obj):
        colors = {
            OrderStatus.PAID: '#28a745', OrderStatus.VOUCHER_ISSUED: '#007bff',
            OrderStatus.FAILED: '#dc3545', OrderStatus.PENDING_PAYMENT: '#ffc107',
            OrderStatus.PENDING: '#6c757d', OrderStatus.CANCELLED: '#343a40',
            OrderStatus.REFUNDED: '#6f42c1',
        }
        color = colors.get(obj.status, 'black')
        return format_html(
            '<span style="background: {}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px;">{}</span>',
            color, obj.get_status_display()
        )


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ('tx_hash_short', 'order_link', 'network', 'amount_usdt', 'confirmed_status')
    list_filter = ('network', 'confirmed', 'confirmed_at')
    search_fields = ('tx_hash', 'order__id')
    readonly_fields = ('explorer_link',)

    @admin.display(description="Ссылка")
    def explorer_link(self, obj):
        if obj.tx_hash:
            return format_html('<a href="https://tronscan.org/#/transaction/{}" target="_blank">Открыть</a>', obj.tx_hash)
        return "—"
    
    @admin.display(description="Hash")
    def tx_hash_short(self, obj):
        if obj.tx_hash: return f"{obj.tx_hash[:10]}...{obj.tx_hash[-10:]}"
        return "—"

    @admin.display(description="Заказ")
    def order_link(self, obj):
        url = reverse("admin:core_order_change", args=[obj.order.id])
        return format_html('<a href="{}">{}</a>', url, str(obj.order.id)[:8])

    @admin.display(description="Подтвержден", boolean=True)
    def confirmed_status(self, obj):
        return obj.confirmed


@admin.register(HotelStatic)
class HotelStaticAdmin(admin.ModelAdmin):
    list_display = ('name', 'city', 'star_rating', 'kind', 'hotel_chain')
    list_filter = ('star_rating', 'kind', 'country_code')
    search_fields = ('name', 'hotel_id', 'city', 'address')
    
    # ИСПРАВЛЕНО: Добавили HotelRoomStaticInline, теперь типы номеров видны прямо в отеле
    inlines = [HotelImageInline, HotelRoomStaticInline]
    
    fieldsets = (
        ('Главное', {
            'fields': (('name', 'star_rating'), ('hotel_id', 'hid'), 'hotel_chain', 'kind')
        }),
        ('Контакты и адрес', {
            'fields': ('address', ('city', 'country_code', 'postal_code'), ('phone', 'email'), ('latitude', 'longitude'))
        }),
        ('Условия размещения', {
            'fields': (('check_in_time', 'check_out_time'), 'important_info')
        }),
        ('Контент и удобства', {
            'classes': ('collapse',),
            'fields': ('description', 'amenities_list')
        }),
    )


# --- НОВЫЕ MODEL ADMINS ДЛЯ ДОБАВЛЕННЫХ МОДЕЛЕЙ ---

@admin.register(HotelRoomStatic)
class HotelRoomStaticAdmin(admin.ModelAdmin):
    """Панель управления статическими типами номеров и сопоставлениями (Matching)"""
    list_display = ('name', 'hotel_link', 'room_ext_id', 'created_at', 'images_count')
    list_filter = ('created_at',)
    search_fields = ('name', 'room_ext_id', 'hotel__name')
    inlines = [RoomImageInline]
    
    readonly_fields = ('created_at',)
    
    @admin.display(description="Отель")
    def hotel_link(self, obj):
        if obj.hotel:
            url = reverse("admin:core_hotelstatic_change", args=[obj.hotel.id])
            return format_html('<a href="{}">{}</a>', url, obj.hotel.name)
        return "—"

    @admin.display(description="Кол-во фото")
    def images_count(self, obj):
        return obj.images.count()


@admin.register(OrderStatusHistory)
class OrderStatusHistoryAdmin(admin.ModelAdmin):
    """Глобальный аудит-лог изменения статусов (только для чтения)"""
    list_display = ('changed_at', 'order_link', 'old_status', 'new_status', 'changed_by')
    list_filter = ('new_status', 'changed_at')
    search_fields = ('order__id', 'reason', 'changed_by__username')
    
    readonly_fields = ('order', 'old_status', 'new_status', 'changed_at', 'changed_by', 'reason')

    # Запрещаем изменять системный лог руками
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False

    @admin.display(description="Заказ")
    def order_link(self, obj):
        url = reverse("admin:core_order_change", args=[obj.order.id])
        return format_html('<a href="{}">📁 Заказ #{}</a>', url, str(obj.order.id)[:8])


# --- Остальные регистрации ---

@admin.register(City)
class CityAdmin(admin.ModelAdmin):
    list_display = ('name', 'country_code', 'latitude', 'longitude', 'hotels_count')
    search_fields = ('name',)

    def hotels_count(self, obj):
        return obj.hotels.count()
    hotels_count.short_description = "Кол-во отелей в базе"


@admin.register(HotelNearbyCache)
class HotelNearbyCacheAdmin(admin.ModelAdmin):
    list_display = ('etg_hotel_id', 'hid', 'city', 'metro_count', 'attractions_count', 'stations_count', 'airports_count', 'updated_at')
    list_filter = ('city', 'country_code', 'source')
    search_fields = ('etg_hotel_id', 'hid', 'city', 'hotel__name')
    readonly_fields = ('created_at', 'updated_at')

    @admin.display(description='Метро')
    def metro_count(self, obj):
        return len(obj.metro or [])

    @admin.display(description='Достоприм.')
    def attractions_count(self, obj):
        return len(obj.attractions or [])

    @admin.display(description='Станции')
    def stations_count(self, obj):
        return len(obj.stations or [])

    @admin.display(description='Аэропорты')
    def airports_count(self, obj):
        return len(obj.airports or [])


@admin.register(InboundEmail)
class InboundEmailAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'from_email', 'subject', 'parsed_booking_id', 'order', 'processing_status')
    list_filter = ('processing_status', 'created_at')
    search_fields = ('from_email', 'subject', 'parsed_booking_id', 'body')
    raw_id_fields = ('order',) 
    actions = ['reprocess_emails']

    @admin.action(description="Запустить повторную обработку выделенных писем")
    def reprocess_emails(self, request, queryset):
        success_count = 0
        failed_count = 0
        manual_count = 0
        
        for email in queryset:
            partner_file = email.original_file if email.original_file else None
            VoucherEmailProcessor.process_inbound_email(email, partner_file=partner_file)
            
            email.refresh_from_db()
            if email.processing_status == 'processed':
                success_count += 1
            elif email.processing_status == 'manual':
                manual_count += 1
            else:
                failed_count += 1
                
        self.message_user(
            request, 
            f"Обработка завершена. Успешно: {success_count}, Требует ручного вмешательства: {manual_count}, Ошибки: {failed_count}",
            messages.SUCCESS
        )


@admin.register(VoucherDocument)
class VoucherDocumentAdmin(admin.ModelAdmin):
    list_display = ('order', 'sent_to_email', 'status', 'created_at', 'sent_at')
    search_fields = ('sent_to_email', 'order__id')
    readonly_fields = ('created_at',)


admin.site.register(HotelCache)

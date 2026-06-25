from decimal import Decimal
from django.contrib import admin, messages
from django.db.models import Sum
from django.utils.html import format_html
from django.urls import reverse
from django.shortcuts import render
from django.http import HttpResponseRedirect

# Импортируем старые и новые модели
from .models import (
    City, OrderStatus, NetworkChoices, HotelCache, Order, Transaction,
    HotelStatic, HotelImage, HotelNearbyCache, InboundEmail, VoucherDocument,
    HotelRoomStatic, RoomImage, OrderStatusHistory, MarkupSettings  # <-- Добавили новые модели сюда
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
    change_list_template = 'admin/core/order/change_list.html'

    # Статусы, которые считаем реальной выручкой (деньги получены/бронь идёт)
    REVENUE_STATUSES = (
        OrderStatus.PAID,
        OrderStatus.BOOKING,
        OrderStatus.VOUCHER_ISSUED,
    )

    list_display = (
        'id_short', 'status_colored', 'voucher_status', 'user_email',
        'hotel_name_short', 'revenue_col', 'cost_col', 'abcex_fee_col',
        'profit_col', 'margin_col', 'created_at'
    )
    list_filter = ('status', 'voucher_status', 'created_at', 'check_in')
    search_fields = ('id', 'user_email', 'hotel_name', 'emerging_booking_id')

    @staticmethod
    def _order_profit(obj):
        return ((obj.amount_usdt or Decimal('0'))
                - (obj.cost_price_usdt or Decimal('0'))
                - (obj.abcex_fee_usdt or Decimal('0')))

    @admin.display(description="Клиент заплатил", ordering='amount_usdt')
    def revenue_col(self, obj):
        return format_html('{} ₮', obj.amount_usdt)

    @admin.display(description="Себестоимость ETG", ordering='cost_price_usdt')
    def cost_col(self, obj):
        return format_html('{} ₮', obj.cost_price_usdt)

    @admin.display(description="Комиссия ABCEX", ordering='abcex_fee_usdt')
    def abcex_fee_col(self, obj):
        return format_html('{} ₮', obj.abcex_fee_usdt or Decimal('0'))

    @admin.display(description="Прибыль (чистая)")
    def profit_col(self, obj):
        profit = self._order_profit(obj)
        color = '#1a7f37' if profit >= 0 else '#cf222e'
        return format_html('<b style="color:{}">{} ₮</b>', color, profit)

    @admin.display(description="Маржа")
    def margin_col(self, obj):
        if obj.amount_usdt:
            margin = (self._order_profit(obj) / obj.amount_usdt) * 100
            return f"{margin:.1f}%"
        return "—"

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context=extra_context)
        try:
            qs = response.context_data['cl'].queryset
        except (AttributeError, KeyError):
            return response

        paid = qs.filter(status__in=self.REVENUE_STATUSES)
        agg = paid.aggregate(rev=Sum('amount_usdt'), cost=Sum('cost_price_usdt'), fee=Sum('abcex_fee_usdt'))
        rev = agg['rev'] or Decimal('0')
        cost = agg['cost'] or Decimal('0')
        fee = agg['fee'] or Decimal('0')
        profit = rev - cost - fee
        margin = (profit / rev * 100) if rev else Decimal('0')
        refunded = qs.filter(status=OrderStatus.REFUNDED)
        refunded_sum = refunded.aggregate(s=Sum('amount_usdt'))['s'] or Decimal('0')

        response.context_data['finance_summary'] = {
            'count_all': qs.count(),
            'count_paid': paid.count(),
            'revenue': rev.quantize(Decimal('0.01')),
            'cost': cost.quantize(Decimal('0.01')),
            'abcex_fee': fee.quantize(Decimal('0.01')),
            'profit': profit.quantize(Decimal('0.01')),
            'margin': round(margin, 1),
            'count_refunded': refunded.count(),
            'refunded_sum': refunded_sum.quantize(Decimal('0.01')),
        }
        return response
    
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
            'fields': (
                ('amount_usdt', 'cost_price_usdt'),
                ('markup_percent', 'abcex_fee_usdt'),
                'paid_at',
            )
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


@admin.register(MarkupSettings)
class MarkupSettingsAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'markup_percent', 'updated_at')
    readonly_fields = ('updated_at', 'topup_preview')
    fieldsets = (
        ('Наценка на клиента', {
            'fields': ('markup_percent',),
            'description': 'Применяется ко всем новым броням автоматически.'
        }),
        ('Цепочка пополнения депозита Островка (USDT → USD)', {
            'fields': (
                ('misha_percent', 'extra_exchange_percent'),
                'xbo_rate',
                ('almashrab_fixed_usd', 'abcex_fixed_usd'),
            ),
            'description': 'Комиссии при пополнении долларового депозита Островка криптой.'
        }),
        ('Калькулятор пополнения', {
            'fields': ('preview_amount_usd', 'topup_preview'),
            'description': 'Введите сумму, которую должен получить Островок, и сохраните — ниже расчёт.'
        }),
        ('Контроль минимального баланса депозита', {
            'fields': (('min_balance_usd', 'balance_control_enabled'),),
            'description': 'При включённом контроле в Казне покажется статус LOW, если баланс ниже порога.'
        }),
    )

    @admin.display(description="Расчёт пополнения")
    def topup_preview(self, obj):
        if not obj or not obj.pk:
            return "Сохраните настройки, чтобы увидеть расчёт."
        b = obj.compute_ostrovok_topup(obj.preview_amount_usd)
        return format_html(
            '<div style="line-height:1.9;font-size:14px;">'
            'Островок получит: <b>{} USD</b><br>'
            'Нужно отправить: <b style="color:#1a7f37;font-size:16px;">{} USDT</b>'
            '<hr style="margin:8px 0;border:none;border-top:1px solid #ddd;">'
            'Комиссия Миши ({}%): {} ₮<br>'
            'Потеря на курсе XBO: {} ₮<br>'
            'Доп. комиссия ({}%): {} ₮<br>'
            'AL MASHRAB → Островок: {} USD<br>'
            'ABCex/Aifory: {} USD'
            '<hr style="margin:8px 0;border:none;border-top:1px solid #ddd;">'
            '<b>Итого комиссий: {} USD ({}%)</b>'
            '</div>',
            b['net_usd'], b['usdt_to_send'],
            obj.misha_percent, b['misha'],
            b['xbo_loss'],
            obj.extra_exchange_percent, b['extra'],
            b['almashrab'], b['abcex'],
            b['total_commission'], b['total_percent'],
        )

    def has_add_permission(self, request):
        # Синглтон: запрещаем создавать второй объект, если уже есть
        return not MarkupSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


# ============================================================================
#  ФИНАНСОВЫЕ РАЗДЕЛЫ (Дашборд / Казна / Отчётность) — кастомные страницы
# ============================================================================
from django.template.response import TemplateResponse
from . import finance
from .models import FinanceDashboard, Treasury, FinanceReport


class _FinanceAdminBase(admin.ModelAdmin):
    """База для финансовых разделов: только просмотр, кастомная страница."""
    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return request.user.is_staff

    def _period(self, request):
        p = request.GET.get('period', 'all')
        return p if p in ('day', 'week', 'month', 'all') else 'all'


@admin.register(FinanceDashboard)
class FinanceDashboardAdmin(_FinanceAdminBase):
    def changelist_view(self, request, extra_context=None):
        period = self._period(request)
        try:
            balance = abcex_service.get_usdt_balance()
        except Exception:
            balance = None
        ctx = dict(
            self.admin_site.each_context(request),
            title="Финансы · Дашборд",
            summary=finance.summarize(period),
            period=period,
            abcex_balance=balance,
        )
        return TemplateResponse(request, "admin/core/finance_dashboard.html", ctx)


@admin.register(Treasury)
class TreasuryAdmin(_FinanceAdminBase):
    def changelist_view(self, request, extra_context=None):
        from django.db.models import Sum as _Sum
        all_summary = finance.summarize('all')
        try:
            abcex_balance = abcex_service.get_usdt_balance()
        except Exception:
            abcex_balance = None

        deposit_balance, threshold, is_low, control_on = treasury.balance_status()

        # Итоги по журналу движений депозита
        mv = BalanceMovement.objects.all()
        topups = mv.filter(type=MovementType.TOPUP).aggregate(s=_Sum('amount'))['s'] or Decimal('0')
        spends = mv.filter(type=MovementType.BOOKING_SPEND).aggregate(s=_Sum('amount'))['s'] or Decimal('0')
        refunds = mv.filter(type=MovementType.REFUND).aggregate(s=_Sum('amount'))['s'] or Decimal('0')
        adjustments = mv.filter(type=MovementType.ADJUSTMENT).aggregate(s=_Sum('amount'))['s'] or Decimal('0')
        last_movements = mv[:8]

        ctx = dict(
            self.admin_site.each_context(request),
            title="Финансы · Казна",
            s=all_summary,
            abcex_balance=abcex_balance,
            deposit_balance=deposit_balance,
            threshold=threshold,
            is_low=is_low,
            control_on=control_on,
            topups=topups.quantize(Decimal('0.01')),
            spends=spends.quantize(Decimal('0.01')),
            refunds=refunds.quantize(Decimal('0.01')),
            adjustments=adjustments.quantize(Decimal('0.01')),
            last_movements=last_movements,
            movements_count=mv.count(),
        )
        return TemplateResponse(request, "admin/core/treasury.html", ctx)


@admin.register(FinanceReport)
class FinanceReportAdmin(_FinanceAdminBase):
    def changelist_view(self, request, extra_context=None):
        period = self._period(request)
        ctx = dict(
            self.admin_site.each_context(request),
            title="Финансы · Отчётность",
            summary=finance.summarize(period),
            period=period,
        )
        return TemplateResponse(request, "admin/core/finance_report.html", ctx)


# ============================================================================
#  КАЗНА: журнал движений + заявки на пополнение
# ============================================================================
from django.utils import timezone as _tz
from . import treasury
from .models import BalanceMovement, MovementType, TopupRequest, TopupStatus


@admin.register(BalanceMovement)
class BalanceMovementAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'type_colored', 'amount_col', 'balance_before', 'balance_after', 'initiator', 'source_col', 'comment')
    list_filter = ('type', 'created_at')
    search_fields = ('comment', 'initiator', 'source_id')
    date_hierarchy = 'created_at'
    fields = ('type', 'amount', 'comment', 'balance_before', 'balance_after', 'initiator', 'created_at')
    readonly_fields = ('balance_before', 'balance_after', 'initiator', 'created_at')

    _TYPE_COLORS = {
        MovementType.TOPUP: '#1a7f37', MovementType.REFUND: '#1a7f37',
        MovementType.BOOKING_SPEND: '#cf222e', MovementType.ADJUSTMENT: '#8250df',
    }

    @admin.display(description="Тип")
    def type_colored(self, obj):
        return format_html('<b style="color:{}">{}</b>', self._TYPE_COLORS.get(obj.type, '#333'), obj.get_type_display())

    @admin.display(description="Сумма", ordering='amount')
    def amount_col(self, obj):
        color = '#1a7f37' if (obj.amount or 0) >= 0 else '#cf222e'
        return format_html('<b style="color:{}">{:+} ₮</b>', color, obj.amount)

    @admin.display(description="Источник")
    def source_col(self, obj):
        if not obj.source_type:
            return "—"
        return format_html('{} · {}', obj.source_type, (obj.source_id or '')[:12])

    def has_delete_permission(self, request, obj=None):
        return False  # журнал append-only

    def save_model(self, request, obj, form, change):
        # Ручное движение (корректировка/начальный остаток): считаем before/after сами
        if not change:
            mv = treasury.record_movement(
                obj.type, obj.amount, initiator=request.user.username or "админ",
                source_type='manual', comment=obj.comment or "Ручная корректировка",
            )
            obj.pk = mv.pk  # чтобы админка показала созданную запись
        else:
            super().save_model(request, obj, form, change)


@admin.register(TopupRequest)
class TopupRequestAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'amount_usd', 'usdt_to_send', 'commission_col', 'status_colored', 'confirmed_at')
    list_filter = ('status', 'created_at')
    search_fields = ('comment',)
    actions = ['confirm_topups']
    fields = ('amount_usd', 'comment', 'status', 'usdt_to_send', 'commission_usd', 'commission_percent', 'topup_breakdown', 'confirmed_at')
    readonly_fields = ('usdt_to_send', 'commission_usd', 'commission_percent', 'topup_breakdown', 'confirmed_at')

    _ST_COLORS = {
        TopupStatus.NEW: '#8250df', TopupStatus.PAID: '#bf8700',
        TopupStatus.CONFIRMED: '#1a7f37', TopupStatus.EXPIRED: '#cf222e',
    }

    @admin.display(description="Комиссии")
    def commission_col(self, obj):
        return format_html('{} ₮ ({}%)', obj.commission_usd, obj.commission_percent)

    @admin.display(description="Статус")
    def status_colored(self, obj):
        return format_html('<b style="color:{}">{}</b>', self._ST_COLORS.get(obj.status, '#333'), obj.get_status_display())

    @admin.display(description="Расчёт пополнения")
    def topup_breakdown(self, obj):
        if not obj or not obj.amount_usd:
            return "Укажите сумму и сохраните."
        b = MarkupSettings.load().compute_ostrovok_topup(obj.amount_usd)
        return format_html(
            '<div style="line-height:1.8">Островок получит: <b>{} USD</b><br>'
            'Нужно отправить: <b style="color:#1a7f37">{} USDT</b><br>'
            'Миша: {} · XBO: {} · Доп: {} · AL MASHRAB: {} · ABCex: {}<br>'
            '<b>Итого: {} USD ({}%)</b></div>',
            b['net_usd'], b['usdt_to_send'], b['misha'], b['xbo_loss'], b['extra'],
            b['almashrab'], b['abcex'], b['total_commission'], b['total_percent'])

    def save_model(self, request, obj, form, change):
        obj.recompute()
        super().save_model(request, obj, form, change)

    @admin.action(description='✅ Подтвердить (зачислить на депозит)')
    def confirm_topups(self, request, queryset):
        done = 0
        for t in queryset:
            if t.status != TopupStatus.CONFIRMED:
                treasury.confirm_topup(t, initiator=request.user.username or "админ")
                done += 1
        self.message_user(request, f"Зачислено заявок: {done}", messages.SUCCESS)

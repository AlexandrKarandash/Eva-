import hashlib
import html
import hmac
import math
import time
import logging
import uuid
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse
from django.conf import settings
from django.db import transaction
from django.shortcuts import render
from django.http import JsonResponse
from django.utils import timezone
from core.email_processor import VoucherEmailProcessor
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.decorators import api_view, permission_classes
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .models import EmailProcessingStatus, HotelStatic, InboundEmail, Order, Transaction, OrderStatus, NetworkChoices
from .services import EmergingTravelService, etg_service, abcex_service
from .tasks import schedule_unpaid_order_expiration
from rest_framework.throttling import ScopedRateThrottle
from .utils import send_telegram_notification


logger = logging.getLogger(__name__)
MONEY_QUANT = Decimal("0.01")
ORDER_ACCESS_TOKEN_HEADER = "X-Order-Access-Token"
ETG_WEBHOOK_SIGNATURE_HEADERS = (
    "X-ETG-Signature",
    "X-Signature",
    "X-Hub-Signature-256",
)

def html_escape(value):
    return html.escape(str(value or ""), quote=True)

def calculate_client_price(cost_price: Decimal) -> Decimal:
    """
    Рассчитывает конечную стоимость для клиента с учетом наценки.
    Например, +10% к стоимости партнера.
    """
    markup_percent = Decimal("0.10")  # 10% наценка
    client_price = cost_price * (Decimal("1.00") + markup_percent)
    return client_price.quantize(MONEY_QUANT)

def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

def notify_status_change(order, title="Обновление статуса заказа!", extra_info=""):
    status_emoji = {
        OrderStatus.PENDING_PAYMENT: "⏳",
        OrderStatus.PAID: "💰",
        OrderStatus.PENDING: "🔄",
        OrderStatus.BOOKING: "🏨",
        OrderStatus.VOUCHER_ISSUED: "✅",
        OrderStatus.FAILED: "❌",
        OrderStatus.CANCELLED: "🚫",
        OrderStatus.REFUNDED: "🔙",
    }
    
    emoji = status_emoji.get(order.status, "🔔")
    
    msg = (
        f"{emoji} <b>{title}</b>\n\n"
        f"🆔 ID заказа: <code>{order.id}</code>\n"
        f"🏨 Отель: {html_escape(order.hotel_name)}\n"
        f"📧 Клиент: {html_escape(order.user_email)}\n"
        f"💰 Сумма: {html_escape(order.amount_usdt)} USDT\n"
        f"📈 Статус: <b>{html_escape(order.status)}</b>"
    )
    
    if order.guest_name:
        msg += f"\n👤 Гость: {html_escape(order.guest_name)}"
    
    if order.voucher_url:
        msg += f"\n📄 <a href='{html_escape(order.voucher_url)}'>Скачать ваучер</a>"
        
    if extra_info:
        msg += f"\n\n{extra_info}"
        
    send_telegram_notification(msg)


def _extract_prebook_offer(prebook_result):
    data = prebook_result.get('data', {}) if isinstance(prebook_result, dict) else {}
    hotels = data.get('hotels', [])

    if not hotels or not isinstance(hotels[0], dict):
        raise ValueError("No rates available for this hotel")
    

    hotel_data = hotels[0]
    rates = hotel_data.get('rates', [])
    if not rates or not isinstance(rates[0], dict):
        raise ValueError("No rates available for this hotel")

    rate = rates[0]

    # фиксируем изменение цены
    if rate.get('price_changed'):
        logger.warning("ETG сообщил, что цена изменилась во время prebook!")

    payment_options = rate.get('payment_options', {})
    payment_types = payment_options.get('payment_types', [])
    payment = payment_types[0] if payment_types and isinstance(payment_types[0], dict) else {}
    amount_raw = payment.get('show_amount') or payment.get('amount')

    try:
        price = Decimal(str(amount_raw)).quantize(MONEY_QUANT)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Invalid provider price")

    if price <= 0:
        raise ValueError("Invalid provider price")

    final_booking_hash = rate.get('book_hash') or rate.get('hash')
    if not final_booking_hash:
        raise ValueError("Could not extract booking hash")

    return {
        "hotel_name": hotel_data.get('name') or "Неизвестный отель",
        "book_hash": final_booking_hash,
        "price": price,
        "currency": payment.get('show_currency_code') or payment.get('currency_code') or "USD",
    }


def _get_order_access_token(request):
    token = request.headers.get(ORDER_ACCESS_TOKEN_HEADER)
    if not token:
        data = getattr(request, "data", None)
        if hasattr(data, "get"):
            token = data.get("access_token") or data.get("order_access_token")
    return str(token).strip() if token else ""


def _safe_voucher_url(value):
    if not value:
        return ""
    try:
        parsed = urlparse(str(value))
    except (TypeError, ValueError):
        return ""
    
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        logger.warning("Rejected voucher_url with unsafe scheme or empty host: %r", value)
        return ""
    
    #  ИСПРАВЛЕНО: Белый список разрешенных доменов поставщика (Domain Allowlist)
    host = parsed.netloc.lower()
    
    is_valid_domain = host == "worldota.net" or host.endswith(".worldota.net") or \
                      host == "emergingtravel.com" or host.endswith(".emergingtravel.com")
                      
    if not is_valid_domain:
        logger.error("SECURITY WARNING: Rejected voucher_url with unauthorized domain: %r", value)
        return ""
        
    return str(value)


def _get_authorized_order(request, order_id):
    order = Order.objects.filter(id=order_id).first()
    if not order:
        return None, Response({"error": "Заказ не найден"}, status=404)

    if not order.has_access_token(_get_order_access_token(request)):
        return None, Response({"error": "Invalid or missing order access token"}, status=403)

    return order, None


def _get_etg_webhook_signature(request):
    for header in ETG_WEBHOOK_SIGNATURE_HEADERS:
        value = request.headers.get(header)
        if value:
            return str(value).strip()
    return ""


def _normalize_hmac_signature(signature):
    if "=" in signature:
        algorithm, digest = signature.split("=", 1)
        if algorithm.strip().lower() != "sha256":
            return ""
        return digest.strip()
    return signature.strip()


def _verify_etg_webhook_signature(request):
    secret = str(getattr(settings, "ETG_WEBHOOK_SECRET", "") or "").strip()
    if not secret:
        logger.error("ETG webhook secret is not configured")
        return False

    provided_signature = _normalize_hmac_signature(_get_etg_webhook_signature(request))
    if not provided_signature:
        return False

    expected_signature = hmac.HMAC(
        secret.encode("utf-8"),
        request.body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(provided_signature, expected_signature)

def hotel_demo_view(request):
    return render(request, 'index.html')

def catalog_view(request):
    return render(request, 'catalog.html')

def single_view(request):
    return render(request, 'single.html')

def payment_view(request):
    return render(request, 'payment.html', {
        "test_payment_enabled": getattr(settings, "ALLOW_TEST_PAYMENT", False),
    })

def index_view(request):
    return render(request, 'index.html')


class HotelSearchView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        region = request.query_params.get('region', '2011')
        checkin = request.query_params.get('checkin', '2026-05-22')
        checkout = request.query_params.get('checkout', '2026-05-25')
        language = request.query_params.get('language', 'ru')
        residency = request.query_params.get('residency')
        
        try:
            adults = int(request.query_params.get('adults', 2))
        except (ValueError, TypeError):
            adults = 2

        children = request.query_params.getlist('children')
        try:
            children_list = [int(c) for c in children]
        except (ValueError, TypeError):
            children_list = []
            
        kind_filter = request.query_params.get('kind')
        if kind_filter in ["", "null", "None"]: 
            kind_filter = None

        try:
            page = int(request.query_params.get('page', 1))
        except (ValueError, TypeError):
            page = 1
            
        search_result = etg_service.search_hotels(
            region_id=region, 
            checkin=checkin, 
            checkout=checkout, 
            adults=adults,
            children=children_list,
            language=language,
            kind=kind_filter,
            page=page,
            residency=residency # Передаем в сервис
        )

        total_hotels = search_result.get("total_hotels", 0)
        hotels_list = search_result.get("hotels", [])
        limit = 20
        total_pages = search_result.get("total_pages", math.ceil(total_hotels / limit) if total_hotels > 0 else 1)

        return Response({
            "status": search_result.get("status", "success"),
            "total_hotels": total_hotels,
            "total_pages": total_pages,
            "current_page": page,
            "limit": limit,
            "search_params": {
                "region": region,
                "checkin": checkin,
                "checkout": checkout,
                "adults": adults,
                "children": children_list,
                "language": language,
                "kind": kind_filter,
                "residency": residency # Возвращаем для консистентности
            },
            "hotels": hotels_list
        })

def hotel_detail_view(request, hotel_id):
    clean_id = hotel_id.strip('/')
    checkin = request.GET.get('checkin')
    checkout = request.GET.get('checkout')
    language = request.GET.get('language', 'ru')
    currency = request.GET.get('currency', 'USD')
    residency = request.GET.get('residency') # Добавлено чтение residency [cite: 667]

    try:
        adults = int(request.GET.get('adults', 2))
    except (ValueError, TypeError):
        adults = 2

    children = request.GET.getlist('children')
    try:
        children_list = [int(c) for c in children]
    except (ValueError, TypeError):
        children_list = []

    if not checkin or not checkout:
        return JsonResponse({"error": "Dates required"}, status=400)

    data = etg_service.get_hotel_details(
        hotel_id=clean_id, 
        checkin=checkin, 
        checkout=checkout, 
        adults=adults, 
        children=children_list, 
        language=language, 
        currency=currency,
        residency=residency # Передаем в сервис
    )

    if not data or not data.get('rates'):
        return JsonResponse({
            "error": f"No rates found for hotel {clean_id}",
            "details": "Try different dates or check hotel availability"
        }, status=404)

    return JsonResponse(data)

class PrebookView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'financial'
    permission_classes = [AllowAny]

    def post(self, request):
        search_hash = request.data.get('book_hash')
        hotel_id = request.data.get('hotel_id')
        email = request.data.get('email')
        checkin = request.data.get('checkin') or request.data.get('checkIn')
        checkout = request.data.get('checkout') or request.data.get('checkOut')

        if not all([search_hash, hotel_id, email, checkin, checkout]):
            return Response({"error": "Missing required fields"}, status=400)
            
        result = etg_service.prebook(search_hash)
        if not result or result.get('status') != 'ok':
            return Response({"error": "Отель больше недоступен", "details": result}, status=400)
        
        try:
            offer = _extract_prebook_offer(result)
            final_booking_hash = offer["book_hash"]
            hotel_name_actual = offer["hotel_name"] or f"Hotel {hotel_id}"
            final_price = offer["price"]  # Это цена партнера (нетто)
            client_price = calculate_client_price(final_price)  # Наша цена с наценкой

            with transaction.atomic():
                order = Order.objects.create(
                    user_email=email,
                    hotel_name=hotel_name_actual,
                    check_in=checkin,
                    check_out=checkout,
                    amount_usdt=client_price,       # Клиент платит сумму с наценкой
                    cost_price_usdt=final_price,    # Сохраняем себестоимость партнера
                    status=OrderStatus.PENDING_PAYMENT,
                    rate_key=final_booking_hash
                )
                access_token = order.issue_access_token()
                crypto_address = abcex_service.generate_new_address(network_id="TRX")
                
                if not crypto_address:
                    raise Exception("ABCEX failed to generate address")

                Transaction.objects.create(
                    order=order,
                    to_address=crypto_address,
                    amount_usdt=client_price,    # Транзакция генерируется на сумму с наценкой
                    network=NetworkChoices.TRC20,
                    confirmed=False
                )

                # Отправляем уведомление с адресом кошелька
                info_msg = f"📍 <b>Ожидаем оплату на:</b>\n<code>{html_escape(crypto_address)}</code> (TRC-20)"
                notify_status_change(order, title="Создан новый заказ", extra_info=info_msg)
                schedule_unpaid_order_expiration(order.id)

            return Response({
                "status": "success",
                "book_hash": final_booking_hash,
                "internal_order_id": str(order.id),
                "access_token": access_token,
                "payment": {
                    "address": crypto_address,
                    "amount": client_price,
                    "network": "TRC-20",
                    "currency": "USDT"
                }
            })
            
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        except Exception as e:
            logger.error(f"Error during prebook/payment generation: {e}")
            return Response({"error": "Service temporarily unavailable", "message": str(e)}, status=500)

class BookingFormView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'financial'
    permission_classes = [AllowAny]
    def post(self, request):
        internal_order_id = request.data.get('internal_order_id')
        language = request.data.get('language', 'ru')
        if not internal_order_id:
            return Response({"error": "internal_order_id is required"}, status=400)

        order, error_response = _get_authorized_order(request, internal_order_id)
        if error_response:
            return error_response
        
        user_ip = get_client_ip(request)
        
        result = etg_service.create_booking_process(
            book_hash=order.rate_key, 
            user_ip=user_ip, 
            internal_order_id=order.id,
            language=language
        )

        if result and result.get('status') == 'ok':
            return Response(result)
        
        logger.error(f"Form Creation failed: {result}")
        return Response({
            "error": "ETG Form Error",
            "details": result.get('error') if result else "No Response"
        }, status=400)
    
class BookingFinishView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'financial'
    permission_classes = [AllowAny]

    def post(self, request):
        internal_order_id = request.data.get('internal_order_id')
        guests = request.data.get('guests')
        contact_data = request.data.get('contact_data')
        
        if not all([internal_order_id, guests, contact_data]):
            return Response({
                "error": "internal_order_id, guests and contact_data are required"
            }, status=400)
            

        order_auth, error_response = _get_authorized_order(request, internal_order_id)
        if error_response:
            return error_response

        with transaction.atomic():

            order = Order.objects.select_for_update().get(id=order_auth.id)

            # ЗАЩИТА: Если кто-то уже нажал кнопку и статус изменился, просто говорим "ОК"
            if order.status in [OrderStatus.BOOKING, OrderStatus.VOUCHER_ISSUED, OrderStatus.PENDING]:
                return Response({
                    "message": "Заказ уже оформлен или находится в процессе",
                    "status": "already_processing"
                }, status=200)


            if order.status != OrderStatus.PAID:
                return Response({
                    "error": f"Booking impossible. Current order status: {order.status}. Required: PAID"
                }, status=400)

            # Резервируем заказ (меняем статус) ДО того, как идти в интернет
            order.status = OrderStatus.BOOKING
            if guests and isinstance(guests, list) and len(guests) > 0:
                first_guest = guests[0]
                order.guest_name = f"{first_guest.get('first_name', '')} {first_guest.get('last_name', '')}".strip()
            
            order.save()
        

        notify_status_change(order, title="Бронирование в процессе...")

        # ETG net-модель: в payment_type должна уходить НЕТТО-цена ETG (cost_price_usdt),
        # а не клиентская цена с наценкой (amount_usdt). Иначе ETG отклонит бронь
        # с ошибкой incorrect_chosen_payment_type.
        price = order.cost_price_usdt or order.amount_usdt
        currency = getattr(order, 'currency', 'USD')

        result = etg_service.finish_booking(
            guest_data=guests,
            contact_data=contact_data,
            internal_order_id=internal_order_id,
            price=price,
            currency=currency
        )

        if result and result.get('status') == 'ok':
            data = result.get('data') or {}
            order_id_from_etg = data.get('order_id')
            
            # Обработка асинхронного режима с time.sleep() (теперь это не вешает базу!)
            if not order_id_from_etg:
                logger.info(f"Async mode detected for {internal_order_id}. Polling status...")
                for _ in range(3):
                    time.sleep(2) 
                    status_res = etg_service.check_booking_status(order.id)
                    if status_res and status_res.get('status') == 'ok':
                        data = status_res.get('data') or {}
                        order_id_from_etg = data.get('order_id')
                        if order_id_from_etg:
                            break
            
            if order_id_from_etg:
                order.status = OrderStatus.VOUCHER_ISSUED
                order.emerging_booking_id = str(order_id_from_etg)
            else:
                order.status = OrderStatus.PENDING
            
            order.save()
            notify_status_change(order, title="Бронирование завершено!")
            
            return Response({
                "status": "success",
                "order_id": order_id_from_etg,
                "data": data
            })
    
        order.status = OrderStatus.FAILED
        order.save()
        notify_status_change(order, title="Ошибка бронирования", extra_info=f"Ответ провайдера: {html_escape(result)}")
        
        return Response({
            "error": "Provider rejected the booking", 
            "details": result
        }, status=400)
    
class BookingStatusCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, order_id):
        order, error_response = _get_authorized_order(request, order_id)
        if error_response:
            return error_response
            
        result = etg_service.check_booking_status(order.id)
        
        if result and result.get('status') == 'ok':
            data = result.get('data') or {}
            etg_id = data.get('order_id')
            
            if etg_id:
                if order.status not in (OrderStatus.PAID, OrderStatus.BOOKING, OrderStatus.PENDING):
                    return Response(
                        {
                            "status": order.status,
                            "error": "Invalid status transition",
                        },
                        status=409,
                    )
                order.emerging_booking_id = str(etg_id)
                order.status = OrderStatus.VOUCHER_ISSUED
                safe_url = _safe_voucher_url(data.get('pdf_url'))
                if safe_url:
                    order.voucher_url = safe_url
                notify_status_change(order, title="Ваучер отправлен от провайдера!")
                order.save()
                
                
                
                return Response({
                    "status": "completed",
                    "order_id": etg_id,
                    "data": data
                })
            
            return Response({"status": "processing", "message": "Бронирование еще в очереди"})
            
        return Response({"error": "Не удалось получить статус от провайдера"}, status=400)

@method_decorator(csrf_exempt, name='dispatch')
class ETGWebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        #  Проверка подписи (делаем ДО блокировки базы, чтобы хакеры не могли "вешать" базу левыми запросами)
        if not _verify_etg_webhook_signature(request):
            return Response({"error": "Invalid webhook signature"}, status=403)

        data = request.data
        order_data = data.get('data', {})
        status_name = data.get('event_type', 'status_change')
        
        internal_order_id = order_data.get('partner_order_id')
        etg_status = order_data.get('status')

        old_status = None
        new_voucher_added = False
        
        # Открываем транзакцию и ставим замок на заказ
        with transaction.atomic():
            try:
                # ЗАЩИТА: Блокируем заказ от параллельных изменений
                order = Order.objects.select_for_update().get(id=internal_order_id)
            except Order.DoesNotExist:
                return Response({"error": "Order not found"}, status=404)

            old_status = order.status

            # ЗАЩИТА ОТ ДУБЛЕЙ : 
            # Если провайдер прислал повторный вебхук из-за сбоя сети, а мы его уже обработали
            if etg_status == 'success' and order.status == OrderStatus.VOUCHER_ISSUED:
                return Response({"status": "already_processed"}, status=200)
            if etg_status == 'cancelled' and order.status == OrderStatus.CANCELLED:
                return Response({"status": "already_processed"}, status=200)

            if etg_status == 'success':
                if order.status not in (OrderStatus.PAID, OrderStatus.BOOKING):
                    return Response(
                        {
                            "error": "Invalid status transition",
                            "current_status": order.status,
                        },
                        status=409,
                    )
                order.status = OrderStatus.VOUCHER_ISSUED
                safe_url = _safe_voucher_url(order_data.get('pdf_url'))
                if safe_url:
                    order.voucher_url = safe_url
                    new_voucher_added = True
                    
            elif etg_status == 'cancelled':
                if order.status not in (OrderStatus.PAID, OrderStatus.BOOKING, OrderStatus.PENDING):
                    return Response(
                        {
                            "error": "Invalid status transition",
                            "current_status": order.status,
                        },
                        status=409,
                    )
                order.status = OrderStatus.CANCELLED
            
            order.save()
        
        if old_status != order.status or new_voucher_added:
            notify_status_change(order, title="Обновление от провайдера (Webhook)")

        return Response({"status": "ok"})



def get_empty_nearby_places():
    return {
        'around': [],
        'attractions': [],
        'airports': [],
        'stations': [],
        'metro': [],
    }


def hotel_nearby_places_view(request):
    hotel_id = request.GET.get('hotel_id', '')
    lat = request.GET.get('lat')
    lng = request.GET.get('lng')

    try:
        latitude = float(lat)
        longitude = float(lng)
    except (TypeError, ValueError):
        return JsonResponse({
            'status': 'error',
            'message': 'lat and lng are required',
            'nearby_places': get_empty_nearby_places(),
        }, status=400)

    current_hotel = {
        'id': hotel_id,
        'latitude': latitude,
        'longitude': longitude,
    }

    try:
        nearby_places = etg_service.get_nearby_places(current_hotel)
    except Exception as error:
        logger.exception('[nearby places] failed: %s', error)
        nearby_places = get_empty_nearby_places()

    return JsonResponse({
        'status': 'success',
        'nearby_places': nearby_places or get_empty_nearby_places(),
    })

nearby_places_view = hotel_nearby_places_view

@api_view(['POST'])
@permission_classes([AllowAny])
def initiate_booking_with_crypto(request):
    data = request.data
    book_hash = data.get('book_hash')
    user_email = data.get('email')

    if not all([book_hash, user_email, data.get('checkin'), data.get('checkout')]):
        return Response({"error": "Missing required fields"}, status=400)
    
    prebook_res = etg_service.prebook(book_hash)
    if not prebook_res or prebook_res.get('status') != 'ok':
        return Response({"error": "Отель недоступен для бронирования"}, status=400)

    try:
        offer = _extract_prebook_offer(prebook_res)
    except ValueError as error:
        return Response({"error": str(error)}, status=400)

    final_price = offer["price"]  # Цена партнера
    client_price = calculate_client_price(final_price)  # Наша цена с наценкой
    final_booking_hash = offer["book_hash"]
    
    crypto_address = abcex_service.generate_new_address(network_id="TRX")
    with transaction.atomic():
        order = Order.objects.create(
            user_email=user_email,
            hotel_name=offer["hotel_name"],
            check_in=data.get('checkin'),
            check_out=data.get('checkout'),
            amount_usdt=client_price,       # Клиент платит сумму с наценкой
            cost_price_usdt=final_price,    # Сохраняем себестоимость партнера
            rate_key=final_booking_hash,
            status=OrderStatus.PENDING_PAYMENT
        )
        access_token = order.issue_access_token()

        if not crypto_address:
            transaction.set_rollback(True)
            return Response({"error": "Временно невозможно сгенерировать адрес оплаты"}, status=503)
            
        crypto_tx = Transaction.objects.create(
            order=order,
            network=NetworkChoices.TRC20,
            to_address=crypto_address,
            amount_usdt=client_price,
            confirmed=False
        )

        # Отправляем уведомление
        info_msg = f"📍 <b>Ожидаем оплату на:</b>\n<code>{html_escape(crypto_address)}</code> (TRC-20)"
        notify_status_change(order, title="Создан новый заказ", extra_info=info_msg)
        schedule_unpaid_order_expiration(order.id)
        
    return Response({
        "status": "success",
        "order_id": order.id,
        "access_token": access_token,
        "payment": {
            "address": crypto_address,
            "network": "TRC-20",
            "amount": client_price
        }
    })

class CheckPaymentStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, order_id):
        order, error_response = _get_authorized_order(request, order_id)
        if error_response:
            return error_response

        if order.status != OrderStatus.PENDING_PAYMENT:
            return Response({"status": order.status})

        tx_record = Transaction.objects.filter(order=order).first()
        if not tx_record:
            return Response({"error": "Данные платежа не найдены"}, status=404)

        # Тестовый режим (сертификация ETG): подтверждаем оплату без реальной крипты.
        if getattr(settings, "ALLOW_TEST_PAYMENT", False):
            logger.info("ALLOW_TEST_PAYMENT on — auto-confirming order %s without ABCEX", order.id)
            payment_info = {"paid": True, "txId": "TEST-PAYMENT"}
        else:
            payment_info = abcex_service.check_payment(
                target_address=tx_record.to_address,
                expected_amount=order.amount_usdt
            )

        if payment_info.get("paid"):
            updated_to_paid = False
            with transaction.atomic():
                order = Order.objects.select_for_update().get(id=order.id)
                if order.status != OrderStatus.PENDING_PAYMENT:
                    return Response({"status": order.status})

                tx_record = Transaction.objects.select_for_update().filter(order=order).first()
                if not tx_record:
                    return Response({"error": "Данные платежа не найдены"}, status=404)

                order.status = OrderStatus.PAID 
                order.paid_at = order.paid_at or timezone.now()
                order.save(update_fields=["status", "paid_at"])
                
                tx_record.confirmed = True
                tx_record.tx_hash = payment_info.get("txId") 
                tx_record.save()
                updated_to_paid = True

            if updated_to_paid:
                tx_hash = html_escape(tx_record.tx_hash)
                info = f"🔗 TXID: <a href='https://tronscan.org/#/transaction/{tx_hash}'>Проверить в блокчейне</a>"
                notify_status_change(order, title="Оплата получена!", extra_info=info)

            return Response({"status": "paid", "message": "Оплата получена"})

        # ИСПРАВЛЕНО: Если биржа недоступна (ошибка сети/502)
        elif payment_info.get("reason") == "connection_error":
            return Response({
                "status": "network_error_retry", 
                "message": "Связь с крипто-шлюзом нестабильна, перепроверяем платеж..."
            }, status=503)

        # Если биржа работает, но перевода реально еще нет
        return Response({"status": "waiting", "message": "Ожидаем транзакцию..."})
    
class CancelOrderView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'financial'
    permission_classes = [AllowAny]

    def post(self, request, order_id):
        order, error_response = _get_authorized_order(request, order_id)
        if error_response:
            return error_response
        
        if order.status == OrderStatus.PENDING_PAYMENT:
            order.status = OrderStatus.CANCELLED
            order.save()
            
            # Уведомляем об отмене заказа
            notify_status_change(order, title="Заказ отменен пользователем")
            logger.info(f"Order {order_id} was cancelled by user.")
            
            return Response({"status": "success", "message": "Бронирование отменено"})
        else:
            return Response({"error": "Нельзя отменить уже оплаченный или завершенный заказ"}, status=400)


class CancelAfterPaymentView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, order_id):
        order, error_response = _get_authorized_order(request, order_id)
        if error_response:
            return error_response

        if order.status not in (OrderStatus.PAID, OrderStatus.BOOKING, OrderStatus.VOUCHER_ISSUED):
            return Response(
                {"error": f"Refund impossible from status {order.status}"},
                status=400,
            )

        result = etg_service.cancel_booking(order.id)
        if not result or result.get("status") != "ok":
            notify_status_change(
                order,
                title="Ошибка возврата",
                extra_info=f"Ответ провайдера: {html_escape(result)}",
            )
            return Response(
                {"error": "Provider rejected cancellation", "details": result},
                status=400,
            )

        order.status = OrderStatus.REFUNDED
        order.save(update_fields=["status"])
        notify_status_change(order, title="Бронирование отменено, возврат оформлен")

        return Response(
            {
                "status": "refunded",
                "message": "Бронирование отменено у провайдера, статус заказа обновлен",
                "details": result,
            }
        )
        



# Добавьте этот класс в ваш views.py

@method_decorator(csrf_exempt, name='dispatch')
class InboundEmailWebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        # Структура полей зависит от провайдера webhook'ов.
        # Обычно это: 'sender' или 'from', 'subject', 'body-plain' или 'text'
        from_email = request.data.get('sender') or request.data.get('from', 'Unknown')
        subject = request.data.get('subject', '')
        body = request.data.get('body-plain') or request.data.get('text', '') or request.data.get('body', '')
        
        # Создаем запись в таблице входящих писем
        inbound_email_obj = InboundEmail.objects.create(
            from_email=from_email,
            subject=subject,
            body=body,
            processing_status=EmailProcessingStatus.PENDING
        )
        
        # Извлекаем вложенный файл ваучера от партнёра (ищем первый попавшийся PDF или документ)
        partner_file = None
        if request.FILES:
            for file_key in request.FILES:
                uploaded_file = request.FILES[file_key]
                if uploaded_file.name.endswith(('.pdf', '.doc', '.docx', '.html', '.eml')):
                    partner_file = uploaded_file
                    break
        
        # Если файлы передаются ссылками (как в некоторых API), можно скачать их через requests отдельно
        
        # Запускаем обработку пайплайна
        # Рекомендуется выносить в Celery: process_inbound_email.delay(inbound_email_obj.id)
        # Но для надежности и простоты выполним в синхронном режиме:
        VoucherEmailProcessor.process_inbound_email(inbound_email_obj, partner_file=partner_file)
        
        return Response({"status": "accepted", "email_id": str(inbound_email_obj.id)}, status=200)
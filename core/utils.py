import requests
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

def send_telegram_notification(message):
    token = getattr(settings, 'TELEGRAM_BOT_TOKEN', None)
    chat_id = getattr(settings, 'TELEGRAM_ADMIN_CHAT_ID', None)
    
    if not token or not chat_id:
        logger.error("Telegram settings missing!")
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML"
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        return response.json()
    except Exception as e:
        logger.error(f"Telegram notification error: {e}")


def notify_status_change(order, title="", extra_info=""):
    order_id = getattr(order, "id", order)
    status = getattr(order, "status", "")
    parts = [title or "Статус заказа изменён", f"Заказ #{order_id}", f"Статус: {status}"]
    if extra_info:
        parts.append(extra_info)
    return send_telegram_notification("\n".join(parts))

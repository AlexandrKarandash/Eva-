import os
import hmac
import hashlib
import time
import requests
import json

# Ключи берём из переменных окружения — НИКОГДА не хардкодим секреты в коде.
API_KEY = os.environ.get("ABCEX_API_KEY", "")
SECRET_KEY = os.environ.get("ABCEX_SECRET_KEY", "")
GATEWAY_URL = 'https://api.abcex.io'

def call_abcex(method, path, query_str=None, body=None):
    full_path = f"{path}?{query_str}" if query_str else path
    
    body_str = json.dumps(body, separators=(',', ':')) if body else ''
    timestamp = str(int(time.time() * 1000))
    
    message = f"{timestamp}\n{method.upper()}\n{full_path}\n{body_str}"
    signature = hmac.new(SECRET_KEY.encode(), message.encode(), hashlib.sha256).hexdigest()
    
    return requests.request(
        method=method,
        url=GATEWAY_URL + full_path,
        data=body_str if body_str else None,
        headers={
            'Content-Type': 'application/json',
            'X-API-KEY': API_KEY,
            'X-API-TIMESTAMP': timestamp,
            'X-API-SIGNATURE': signature
        }
    )

def generate_hotel_payment_address(wallet_id, network="TRX"):
    raw_query = f"networkId={network}&walletId={wallet_id}"
    path = "/api/v1/wallet/get-new-crypto-address"
    
    try:
        response = call_abcex('GET', path, query_str=raw_query)
        
        if response.status_code == 200 and response.text:
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                return data[0].get("address")
        return None
    except Exception as e:
        print(f"Ошибка при связи с ABCEX: {e}")
        return None

if __name__ == "__main__":
    TRX_WALLET_ID = os.environ.get("ABCEX_WALLET_ID", "")

    print("Генерируем адрес для нового заказа в отеле...")
    crypto_address = generate_hotel_payment_address(wallet_id=TRX_WALLET_ID, network="TRX")
    
    if crypto_address:
        print(f"Адрес успешно создан! Выведите его гостю для оплаты: {crypto_address}")
    else:
        print("Не удалось сгенерировать адрес.")

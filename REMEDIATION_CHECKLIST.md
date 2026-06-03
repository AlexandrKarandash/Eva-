# Чек-лист доработок — Hotel-Aifory-hotel

**Дата:** 2026-05-19
**База:** `AUDIT_REMEDIATION_DYNAMICS.md` + верификация по текущим исходникам (19 мая)

> С 13 мая код успел сдвинуться — ряд пунктов аудита уже закрыт.
> Раздел **0** перечисляет, что подтверждено в коде и трогать не надо.
> Разделы **1–4** — реально открытые задачи, упорядочены по приоритету.

---

## 0. Уже закрыто (НЕ ТРОГАТЬ, проверено по коду)

Перед тем как чинить — убедись, что не «перечинишь» то, что уже работает:

- ETG `BASE_URL` берётся из env, при `DEBUG=false` нет права на sandbox-URL — `config/settings.py:163–170`
- `process_successful_payment_task` инвертирован: PAID только из `PENDING_PAYMENT` — `core/tasks.py:29–34`
- `expire_unpaid_order_task` планируется через `schedule_unpaid_order_expiration` (`apply_async(countdown=…)` на `transaction.on_commit`) — `core/tasks.py:39–48`, вызов из `initiate_booking_with_crypto` — `core/views.py:663`
- Guard статуса в `BookingStatusCheckView` (`PAID/BOOKING/PENDING`, иначе 409) — `core/views.py:487–494`
- Guard статуса в `ETGWebhookView` для success/cancelled — `core/views.py:535–556`
- `select_for_update` + `transaction.atomic()` в `CheckPaymentStatusView` — `core/views.py:698–714`
- `access_token` принимается из заголовка `X-Order-Access-Token` или body — query-param убран — `core/views.py:119–125`
- HTML-escape для всех подстановок в Telegram-сообщениях — `core/views.py:35–78`
- Платёжные суммы через `Decimal` (`_to_money_decimal/_to_money_string`) — `core/services.py:69–77, 653, 1336`
- `ETG_WEBHOOK_SECRET` fail-fast при `DEBUG=false` — `config/settings.py:172–174`
- `TELEGRAM_BOT_TOKEN` fail-fast при `DEBUG=false` — `config/settings.py:176–179`
- `SECRET_KEY` fail-fast при `DEBUG=false` — `config/settings.py:48–53`
- `.env.*` в `.gitignore`

---

## 1. P0 — критические (блокеры прод-деплоя)

### 1.1 SQLite в продакшне → PostgreSQL
- **Где:** `config/settings.py:122–127`
- **Проблема:** SQLite не выдержит параллельных платёжных транзакций (row-level locking, конкурентный polling `CheckPaymentStatusView` + ETG webhook + Celery → потерянные записи / `database is locked`). `select_for_update` под SQLite NO-OP.
- **Как:**
  1. Добавить в `requirements.txt`: `psycopg[binary]==3.2.*` (или `psycopg2-binary` — что у вас уже стоит). Уточнить версию под Django 5.2.
  2. Заменить блок `DATABASES`:
     ```python
     import dj_database_url  # добавить в requirements: dj-database-url==2.2.0
     DATABASES = {
         "default": dj_database_url.config(
             default=os.environ["DATABASE_URL"],
             conn_max_age=60,
             conn_health_checks=True,
         )
     }
     ```
  3. В `.env.example` добавить `DATABASE_URL=postgres://user:pass@host:5432/aifory`.
  4. Локально/в CI поднять Postgres, прогнать `python manage.py migrate`, повторно прогнать `core/tests.py`.
- **Verify:** `python manage.py dbshell` показывает PostgreSQL; `SELECT 1` работает; интеграционный тест двойного `CheckPaymentStatusView` (два параллельных потока) не даёт `IntegrityError`.

### 1.2 `CORS_ALLOW_ALL_ORIGINS` зависит от `DEBUG`
- **Где:** `config/settings.py:205`
- **Проблема:** Сейчас `CORS_ALLOW_ALL_ORIGINS = env_bool("CORS_ALLOW_ALL_ORIGINS", DEBUG)`. Если случайно поднимут с `DEBUG=true` — любой домен сможет дёргать `/refund`, `/cancel` с креденшалами.
- **Как:** заменить дефолт на `False` и явно требовать список доменов в проде:
  ```python
  CORS_ALLOW_ALL_ORIGINS = env_bool("CORS_ALLOW_ALL_ORIGINS", False)
  CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
  if not DEBUG and not RUNNING_TESTS and not CORS_ALLOWED_ORIGINS and not CORS_ALLOW_ALL_ORIGINS:
      raise ImproperlyConfigured("CORS_ALLOWED_ORIGINS must be set when DJANGO_DEBUG=false")
  CORS_ALLOW_CREDENTIALS = True  # явно
  ```
- **Verify:** `curl -H "Origin: https://evil.example" -I https://travel.aifory.pro/api/...` не возвращает `Access-Control-Allow-Origin`.

### 1.3 Устаревшие зависимости (CVE)
- **Где:** `requirements.txt` (Django 5.2.8, aiohttp 3.9.4, tornado 6.4, urllib3 2.2.1, transformers 4.39.3, pillow 10.3.0 — не менялись с v1)
- **Проблема:** Django 5.2.8 — две SQLi-CVE; остальные тянут ~50 CVE.
- **Как (поэтапно):**
  1. **Быстро:** `Django==5.2.11` (закрывает обе SQLi). Прогнать `pytest`/`python manage.py test`.
  2. Поднять минорки безопасных пакетов: `aiohttp>=3.10.11`, `tornado>=6.4.2`, `urllib3>=2.2.3`, `pillow>=10.4.0`, `transformers>=4.41.0`.
  3. Заморозить через `pip-compile` или `uv pip compile`, чтобы lock-файл был воспроизводимым.
  4. Запустить локально SCA (`pip-audit` или `safety check`), убедиться, что P0/P1 CVE закрыты.
- **Verify:** `pip-audit -r requirements.txt --strict` без HIGH/CRITICAL.

### 1.4 Fail-fast для остальных секретов
- **Где:** `config/settings.py:161, 162, 181, 182`
- **Проблема:** для `SECRET_KEY`, `ETG_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `ETG_BASE_URL` уже есть fail-fast. Но `ETG_KEY_ID`, `ETG_KEY`, `ABCEX_BEARER_TOKEN`, `ABCEX_WALLET_ID` при пустоте просто будут давать 401 от внешних API — это «silent fail».
- **Как:** в конце блока с секретами:
  ```python
  _REQUIRED_PROD_SECRETS = {
      "ETG_KEY_ID": ETG_KEY_ID,
      "ETG_KEY": ETG_KEY,
      "ABCEX_BEARER_TOKEN": ABCEX_BEARER_TOKEN,
      "ABCEX_WALLET_ID": ABCEX_WALLET_ID,
  }
  if not DEBUG and not RUNNING_TESTS:
      _missing = [name for name, value in _REQUIRED_PROD_SECRETS.items() if not value]
      if _missing:
          raise ImproperlyConfigured(
              f"Required secrets are not set when DJANGO_DEBUG=false: {', '.join(_missing)}"
          )
  ```
- **Verify:** `DJANGO_DEBUG=false ETG_KEY= python manage.py check` падает с `ImproperlyConfigured`.

---

## 2. P1 — высокий приоритет

### 2.1 `voucher_url` без валидации схемы
- **Где:** `core/views.py:497–498`, `core/views.py:545–546`
- **Проблема:** ETG возвращает `pdf_url`, мы пишем его в `order.voucher_url` без проверки. В Telegram потом рендерится `<a href='{voucher_url}'>` — `javascript:` или `data:` пройдут.
- **Как:** добавить хелпер рядом с `_get_order_access_token`:
  ```python
  from urllib.parse import urlparse
  def _safe_voucher_url(value):
      if not value:
          return ""
      parsed = urlparse(str(value))
      if parsed.scheme not in ("http", "https") or not parsed.netloc:
          return ""
      return value
  ```
  Применить там, где сейчас `order.voucher_url = data.get('pdf_url')`. Если результат пустой — не сохранять и логировать warning.
- **Verify:** unit-тест: `voucher_url = "javascript:alert(1)"` → не сохраняется, telegram-сообщение без href.

### 2.2 Нет rate-limiting
- **Где:** `config/settings.py` (`REST_FRAMEWORK`), эндпоинты `initiate_booking_with_crypto`, `CheckPaymentStatusView`, `CancelAfterPaymentView`, `ETGWebhookView`.
- **Проблема:** `grep throttle/ratelimit` пуст. Атака AC-004 (исчерпание ABCEX-адресов) делается за минуты.
- **Как:**
  1. В `REST_FRAMEWORK`:
     ```python
     "DEFAULT_THROTTLE_CLASSES": [
         "rest_framework.throttling.AnonRateThrottle",
         "rest_framework.throttling.UserRateThrottle",
     ],
     "DEFAULT_THROTTLE_RATES": {
         "anon": "60/min",
         "user": "120/min",
         "prebook": "5/min",
         "payment_check": "30/min",
     },
     ```
  2. На `initiate_booking_with_crypto` (FBV) — добавить `@throttle_classes([ScopedRateThrottle])` + `throttle_scope = "prebook"`. Аналогично `CheckPaymentStatusView.throttle_scope = "payment_check"`.
  3. Кеш — Redis (уже есть как Celery broker), добавить `CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": settings.CELERY_BROKER_URL}}`.
- **Verify:** 6 быстрых запросов на `/prebook` подряд → 6-й даёт 429.

### 2.3 Нет audit trail переходов статусов
- **Где:** `core/models.py` (нет `OrderStatusHistory`)
- **Проблема:** единственный след финансовых переходов — Telegram. При расследовании инцидента нечего смотреть.
- **Как:**
  1. Добавить модель в `core/models.py`:
     ```python
     class OrderStatusHistory(models.Model):
         order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="status_history")
         from_status = models.CharField(max_length=20, blank=True, default="")
         to_status = models.CharField(max_length=20)
         actor = models.CharField(max_length=64, blank=True, default="system")
         reason = models.CharField(max_length=255, blank=True, default="")
         created_at = models.DateTimeField(auto_now_add=True, db_index=True)
     ```
  2. Создать утилиту `core/state.py: transition_order(order, new_status, *, actor, reason="")` — внутри `transaction.atomic()` блокирует Order через `select_for_update`, пишет историю, делает `order.save(update_fields=["status"])`.
  3. Заменить все прямые `order.status = ...; order.save()` в `views.py`/`tasks.py`/`admin.py` на вызов этой утилиты. Список мест — `grep -n "order.status = OrderStatus" core/`.
  4. Сделать миграцию.
- **Verify:** после оплаты заказа в БД появилось 2 строки `OrderStatusHistory` (PENDING_PAYMENT→PAID, PAID→VOUCHER_ISSUED); admin-action `mark_refunded` тоже пишет историю.

### 2.4 `admin.mark_refunded` без guard допустимых статусов
- **Где:** `core/admin.py:103–119`
- **Проблема:** сейчас скипает только `REFUNDED`. Можно случайно «зарефандить» `PENDING_PAYMENT` или `FAILED`.
- **Как:** перед переводом проверять:
  ```python
  ALLOWED_SOURCE = (OrderStatus.PAID, OrderStatus.BOOKING, OrderStatus.VOUCHER_ISSUED)
  if order.status not in ALLOWED_SOURCE:
      skipped_count += 1
      continue
  ```
  И заменить прямое присвоение на `transition_order(...)` из 2.3.
- **Verify:** в admin отметить «возвращенные» для заказов в статусе `FAILED` → счётчик `skipped_count` увеличился, статус не изменился.

### 2.5 ETG webhook без replay-protection
- **Где:** `core/views.py:515–564` (`ETGWebhookView`)
- **Проблема:** HMAC валиден бесконечно. Перехваченный webhook можно проиграть через час и снова перевести заказ в VOUCHER_ISSUED.
- **Как:**
  1. Требовать заголовок `X-ETG-Timestamp` (или брать `created_at` из payload), проверять, что `|now - ts| < 300` сек.
  2. Включить timestamp в строку для HMAC: `f"{ts}.{body}"` (это потребует согласования с ETG; если их подпись только по body — оставить «прозрачную» проверку timestamp).
  3. `event_id` (или `data.order_id + ts`) хранить в Redis с TTL 24h через `cache.add(key, "1", 86400)`. Если `add` вернул `False` — это replay, отвечать 409.
- **Verify:** повторная отправка того же payload → 409 «Duplicate event».

---

## 3. P2 — средние

### 3.1 `access_token` без TTL и без revoke
- **Где:** `core/models.py:61–83`
- **Как:**
  - Добавить поля `access_token_expires_at = models.DateTimeField(null=True, blank=True)`.
  - В `issue_access_token` ставить `expires_at = now() + 24h` (или другой бюджет).
  - В `has_access_token` дополнительно: `if self.access_token_expires_at and self.access_token_expires_at < now(): return False`.
  - В `CancelOrderView`/после VOUCHER_ISSUED обнулять `access_token_hash`.
- **Verify:** заказ оплачен → 24h+1 минута → запрос с тем же токеном даёт 403.

### 3.2 `DecimalField(decimal_places=2)` для USDT
- **Где:** `core/models.py:48, 50, 109`
- **Проблема:** TRC-20 USDT — 6 знаков. Округление до 0.01 теряет копейки при сравнении с ончейн-суммой.
- **Как:** `max_digits=20, decimal_places=6` на `Order.amount_usdt`, `Order.cost_price_usdt`, `Transaction.amount_usdt`. Подправить `MONEY_QUANT = Decimal("0.000001")` там, где это для сумм USDT (а где для USD/RUB — оставить 0.01, разделить две константы). Сделать миграцию `python manage.py makemigrations core`.
- **Verify:** записать сумму `12.345678` → читается без потерь.

### 3.3 Security headers
- **Где:** `config/settings.py` (после блока SSL)
- **Как:** добавить:
  ```python
  SESSION_COOKIE_HTTPONLY = True
  CSRF_COOKIE_HTTPONLY = True
  SESSION_COOKIE_SAMESITE = "Lax"
  CSRF_COOKIE_SAMESITE = "Lax"
  SECURE_REFERRER_POLICY = "same-origin"
  SECURE_CONTENT_TYPE_NOSNIFF = True
  X_FRAME_OPTIONS = "DENY"
  ```
  CSP — поставить `django-csp` и сконфигурировать минимальную политику под фронт.
- **Verify:** `curl -I` показывает заголовки; `python manage.py check --deploy` без security-варнингов.

### 3.4 `.gitignore` дополнить
- **Где:** `.gitignore`
- **Как:** добавить
  ```
  *.key
  *.pem
  *.crt
  *.pfx
  .env
  ```
  (`.env.*` уже есть с исключением `.env.example`, голый `.env` тоже стоит явно перечислить.)
- **Verify:** `git check-ignore -v test.pem` → matches gitignore.

### 3.5 ETG webhook — двойной `order.save()` без `atomic`
- **Где:** `core/views.py:515–564` (вместе с 2.5)
- **Как:** обернуть ветки success/cancelled в `with transaction.atomic(): order = Order.objects.select_for_update().get(...)`. При переходе на утилиту из 2.3 этот пункт закроется автоматически.

---

## 4. P3 — низкие

### 4.1 Overpass-координаты без range-check
- **Где:** `core/services.py` — функции, формирующие Overpass QL (искать через `grep -n "around:\|node\[" core/services.py`)
- **Как:** перед подстановкой `lat`/`lng` валидировать `-90 <= lat <= 90` и `-180 <= lng <= 180`, иначе возвращать пустой `nearby_places`.

### 4.2 Автоматизация refund USDT
- **Где:** `core/` (нет workflow возврата TRC-20)
- **Как:** отдельный спринт. Введите `RefundRequest`-модель + state-machine: `REQUESTED → APPROVED → SUBMITTED → CONFIRMED`. Celery-таск отправляет TRC-20 транзакцию через ABCEX и пишет hash в `Transaction.tx_hash`.

### 4.3 Vault для секретов (вместо env)
- **Где:** `.env`, prod-окружение
- **Как:** HashiCorp Vault / AWS Secrets Manager + `django-environ` с подгрузкой из vault на startup. Это отдельная инфраструктурная задача.

---

## 5. Порядок выполнения (один спринт ≈ 1 неделя)

**Сегодня (≤ 2 часа, минимально для безопасного прод-деплоя):**
1. 1.2 `CORS_ALLOW_ALL_ORIGINS = env_bool(..., False)` явно
2. 1.3 шаг 1: `Django==5.2.11`
3. 1.4 fail-fast для `ETG_KEY/ABCEX_*`
4. 2.1 `urlparse`-проверка `voucher_url`
5. 3.4 дополнить `.gitignore`

**Спринт 1:**
- 1.1 PostgreSQL вместо SQLite
- 1.3 шаг 2: апгрейд остальных зависимостей
- 2.2 rate-limiting
- 2.4 guard в `mark_refunded`
- 3.3 security headers

**Спринт 2:**
- 2.3 `OrderStatusHistory` + утилита `transition_order` + перевод всех call-sites
- 2.5 webhook replay-protection (+ 3.5 закрывается заодно)
- 3.1 TTL для `access_token`
- 3.2 `decimal_places=6` для USDT

**Спринт 3:**
- 4.1 range-check координат
- 4.2 автоматизация refund
- 4.3 vault
- 1.3 шаг 3: pip-compile, lockfile, CI с pip-audit

---

## 6. Definition of Done для каждого пункта

Чек-лист считается закрытым только если:
1. Изменения **минимальны** и не трогают соседний код (см. CLAUDE.md §3).
2. К каждой правке P0/P1 есть тест в `core/tests.py`, который **сначала падает** на старом коде и **проходит** на новом (см. CLAUDE.md §4).
3. `python manage.py check --deploy` без новых варнингов.
4. `python manage.py test` зелёный.
5. Локально прогнан `pip-audit` — нет новых HIGH/CRITICAL.

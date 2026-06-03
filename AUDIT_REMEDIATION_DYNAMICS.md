# Динамика устранения дефектов — Hotel-Aifory-hotel-v3

**Дата отчёта:** 2026-05-15
**Сравниваемые прогоны:** `docs_v1` (9 мая) → `docs_v2` (13 мая) → `docs` (14–15 мая)
**Pipeline:** audit-service-v10

---

## 0. Методологическая оговорка (читать первой)

Сравнение прогонов осложнено двумя факторами, которые **обязательно** надо учитывать,
иначе цифры вводят в заблуждение:

1. **Код заморожен с 13 мая 00:19.** Все исходники (`config/settings.py`, `core/views.py`,
   `core/services.py`, `core/tasks.py`, `core/models.py`, `core/admin.py`) и `requirements.txt`
   последний раз менялись **12–13 мая**. Прогоны `docs_v2` (13 мая ~18:00) и `docs` (14–15 мая)
   выполнялись по **идентичному коду**. → Разница между v2 и v3 — это **разброс методики аудита**,
   а не регрессия и не новые фиксы.

2. **В `docs_v2` фаза сканеров отработала вхолостую.** `docs_v2/SCANNER_FINDINGS.json` содержит
   **0 находок** (в v1 — 141, в v3 — 131). Поэтому заявление из `docs_v2/AUDIT_COMPARISON_OLD_VS_NEW.md`
   о том, что «40+ SCA findings закрыто», — **артефакт**, а не реальность: `requirements.txt`
   между v1 и v3 не менялся ни на одну строку (Django 5.2.8, aiohttp 3.9.4, tornado 6.4,
   urllib3 2.2.1, transformers 4.39.3, pillow 10.3.0 и т.д. — те же уязвимые версии).

**Вывод:** реальная работа по устранению дефектов произошла **между v1 и v2** (правки в коде
9–13 мая). Между v2 и v3 код не трогали — это два аудита одного и того же состояния.

---

## 1. Объём findings по прогонам

| Метрика | docs_v1 (9 мая) | docs_v2 (13 мая) | docs (14–15 мая) |
|---|---|---|---|
| **Total findings** | 169 | 41 | 165 |
| P0 | 19 | 2 | 5 |
| P1 | 56 | 11 | 43 |
| P2 | 70 | 21 | 76 |
| P3 | 24 | 7 | 41 |
| SCA-находок в сканере | 137 | **0** ⚠️ | 126 |
| **Не-SCA дефекты (код/конфиг)** | **~46** | **41** | **~51** |
| EVAL precision@P0 / recall | 0% / 0% | 0% / 0% | 0% / 0% |

### Как это читать

- **Total 169 → 41 → 165** — *не* линия улучшения и не регрессия. Скачок 41→165 на 100%
  объясняется тем, что в v2 не собрались SCA-CVE (фаза сканера пустая), а в v3 собрались.
- **Сопоставимая метрика — «не-SCA дефекты»**: 46 → 41 → 51. Практически стабильна, что
  логично при замороженном коде. Колебание ±5 — это шум LLM-агентов и разброс покрытия
  (в v3 дополнительно отработал bandit → +5 SAST, и config-auditor разложил security-headers
  на отдельные находки).
- **EVAL = 0% во всех трёх прогонах** — gold-set `SecurityGate_decisions.txt` не сматчился
  ни разу (0 пересечений по координатам file:line). Это не сигнал качества аудита, а
  несовпадение системы координат gold-set с выводом pipeline. Метрика неинформативна для
  всех трёх версий одинаково.

---

## 2. Что реально устранено (v1 → v2, подтверждённые правки кода)

Это настоящий прогресс — внесён в код между 9 и 13 мая. Проверено по текущему состоянию исходников.

### Конфигурация (`config/settings.py`)

| Было в v1 | Статус сейчас | Подтверждение |
|---|---|---|
| `DEBUG=True` хардкодом | ✅ исправлено | `settings.py:43` — `env_bool("DJANGO_DEBUG", ..., False)` |
| `ALLOWED_HOSTS` пуст | ✅ исправлено | `settings.py:55` — `env_list("DJANGO_ALLOWED_HOSTS", ...)` |
| `ETG_KEY`/`ABCEX_*` хардкодом | ✅ вынесены в env | `settings.py:161–169` — `os.environ.get(...)` |
| `SECRET_KEY` хардкодом | ✅ улучшено | `settings.py:48–53` — из env, при `DEBUG=false` без ключа → `ImproperlyConfigured` (закрывает старый SEC-002 из v2) |
| Глобальный `AllowAny` на всё API | ✅ переделано | per-view permissions + `access_token`-gate |
| `CORS_ALLOW_ALL_ORIGINS=True` | ⚠️ частично | хардкод `True` убран, но осталась привязка к `DEBUG` — см. §4 |
| `@csrf_exempt` на views | ✅ убрано | в коде не осталось |

### Бизнес-логика (`core/`)

| Было в v1 | Статус сейчас | Подтверждение |
|---|---|---|
| ETGWebhookView без HMAC-подписи | ✅ HMAC добавлен | `_verify_etg_webhook_signature` присутствует |
| `initiate_booking_with_crypto` берёт `price_usdt` из request | ✅ убрано | цена приходит из ETG |
| `process_successful_payment_task` зовёт несуществующий метод | ✅ исправлено | `tasks.py:16–28` переписан |
| float-сравнение USDT в `check_payment` | ✅ переписано на `Decimal` | подтверждено в v2 |
| Инвертированное условие в auth | ✅ исправлено | — |
| Хардкод IP `127.0.0.1 → 82.29.0.86` для ETG | ✅ убрано | — |
| `CancelOrderView` / `BookingFinishView` без IDOR-проверки | ✅ `access_token`-gate | — |

**Итог v1→v2:** закрыто ~13 настоящих P0/P1-блокеров. Это качественный скачок —
из 19 P0 прогона v1 в коде подтвердились лишь единицы.

---

## 3. Что НЕ изменилось (v2 → v3)

Между прогонами v2 и v3 — **ноль правок кода**. Все дефекты ниже присутствуют в текущих
исходниках в том же виде, что и при прогоне v2. v3 не нашёл новых багов в коде — он лишь:

- доукомплектовал список SCA-CVE (фаза сканера в v2 была пустой);
- прогнал bandit (+5 SAST-находок);
- детальнее разложил конфигурационные дефекты.

**Регрессий в коде между v2 и v3 нет.** Но и устранения — тоже нет.

---

## 4. Что ещё нужно исправить (открыто в текущем коде)

Все позиции ниже **проверены по актуальным исходникам** (код заморожен 13 мая, поэтому
то, что нашёл v3, = текущее состояние).

### 🔴 P0 — критические, чинить немедленно

| # | Дефект | Файл:строка | Что сделать |
|---|---|---|---|
| 1 | **ETG `BASE_URL` хардкодом на sandbox** — прод принимает реальные USDT, но бронирует в тестовой среде; ваучеры невалидны | `core/services.py:18` | `BASE_URL = os.environ["ETG_BASE_URL"]`; в `.env` — прод-URL |
| 2 | **SQLite как основная БД** — нет row-level locking, параллельные платёжные транзакции теряют записи | `config/settings.py:122–125` | Перейти на PostgreSQL; `DATABASES` через `DATABASE_URL` из env, убрать SQLite-fallback |
| 3 | **CORS зависит от `DEBUG`** — при случайном `DEBUG=True` любой домен шлёт XHR с кредами на `/refund`, `/cancel` | `config/settings.py:188` | `CORS_ALLOW_ALL_ORIGINS = False` явно; заполнить `CORS_ALLOWED_ORIGINS` |
| 4 | **Django 5.2.8 — две SQL Injection CVE** (CVE-2026-1312, RasterField) + ~50 других SCA-CVE; `requirements.txt` не обновлялся с v1 | `requirements.txt` | `Django==5.2.11+`; прогнать полный апгрейд зависимостей (см. §5) |
| 5 | **Секреты ETG/ABCEX/Telegram без vault и без startup-guard** (для них, в отличие от `SECRET_KEY`, fail-fast нет) | `config/settings.py:161–169` | Vault/Secrets Manager + startup-guard: при пустом `ETG_KEY`/`ABCEX_BEARER_TOKEN`/`TELEGRAM_BOT_TOKEN` и `DEBUG=false` → `sys.exit` |

### 🟠 P1 — высокий приоритет

| # | Дефект | Файл:строка | Что сделать |
|---|---|---|---|
| 6 | **`process_successful_payment_task`: `FAILED`/`PENDING_PAYMENT` → `PAID`** — guard блокирует только `VOUCHER_ISSUED/BOOKING/REFUNDED`; звено attack-chain AC-001 | `core/tasks.py:23` | Инвертировать логику: переводить в `PAID` **только** из `PENDING_PAYMENT`; всё прочее → `return` |
| 7 | **`BookingStatusCheckView` → `VOUCHER_ISSUED` без guard статуса** — работает из любого статуса, включая `REFUNDED`/`FAILED` | `core/views.py:484` | Перед переводом: `if order.status not in (OrderStatus.PAID, OrderStatus.BOOKING): return 409` |
| 8 | **Race condition в `CheckPaymentStatusView`** — check-and-set без `select_for_update`, параллельный polling даёт `IntegrityError`/двойную обработку | `core/views.py:663+` | Обернуть в `transaction.atomic()` + `Order.objects.select_for_update().get(...)` |
| 9 | **`access_token` принимается из `query_params`** — оседает в nginx access.log, `Referer`, истории браузера; звено AC-002 | `core/views.py:121` | Принимать только из заголовка `X-Order-Access-Token`; query-param убрать |
| 10 | **HTML-инъекция в Telegram** — `voucher_url`/`guest_name`/`hotel_name` вставляются в сообщение с `parse_mode=HTML` без экранирования; звено AC-003 | `core/views.py:67–68`, `core/utils.py:19` | `from html import escape` ко всем подстановкам; для `voucher_url` — ещё и проверка схемы |
| 11 | **`voucher_url` из ETG без валидации схемы** — `pdf_url` пишется в `href` как есть, возможен `javascript:`/фишинг | `core/views.py:486`, `core/views.py:534` | `urlparse(url).scheme in ('http','https')` перед сохранением |
| 12 | **`ETG_WEBHOOK_SECRET` может быть пустым** — при пустом значении HMAC-проверка либо всегда `403` (webhook не работает), либо обходится | `config/settings.py:163` | Startup fail-fast: `if not ETG_WEBHOOK_SECRET and not DEBUG: raise ImproperlyConfigured` |
| 13 | **Нет rate-limiting ни на одном endpoint** — `grep throttle/ratelimit` по `core/` и `config/` пуст; основа AC-004 (исчерпание ABCEX-адресов) | `config/settings.py` (DRF) | `DEFAULT_THROTTLE_CLASSES` + `AnonRateThrottle` 5/min на `/prebook`, `/check-payment` |
| 14 | **Нет audit trail в БД** — `grep StatusHistory/AuditLog` пуст; единственный след финансовых переходов — Telegram | `core/models.py` | Модель `OrderStatusHistory` (order, from→to, ts, actor); запись при каждом переходе |
| 15 | **`float()` в платёжных путях** — `finish_booking` шлёт в ETG `formatted_price = float(price)`; `_process_full_data` — `float(price_val)`; потеря точности на суммах USDT | `core/services.py:1328`, `:1245`, `:643` | `str(price)` или `Decimal(...).quantize(...)`; убрать голый `except: formatted_price = 0.0` |
| 16 | **`expire_unpaid_order_task` нигде не планируется** — `grep apply_async/CELERY_BEAT` пуст; неоплаченные заказы не истекают | `core/tasks.py:6`, `config/` | `CELERY_BEAT_SCHEDULE` или `apply_async(countdown=1200)` при создании Order |

### 🟡 P2 / P3 — средние и низкие (выборка значимых)

| Дефект | Файл | Действие |
|---|---|---|
| `access_token` без TTL и без отзыва | `core/models.py` | Поле `access_token_expires_at` + проверка в `has_access_token` + revoke-API |
| ETG webhook без nonce/timestamp — replay (AC-005) | `core/views.py` (ETGWebhookView) | `event_id`-store в Redis TTL 24h + проверка timestamp |
| Двойной `order.save()` без `atomic` в `BookingFinishView` | `core/views.py` | Обернуть переходы в `transaction.atomic()` |
| `admin.mark_refunded` без guard по статусам | `core/admin.py` | Проверка допустимого исходного статуса |
| Security headers: CSP, HSTS preload, `*_COOKIE_HTTPONLY` не настроены | `config/settings.py` | Добавить CSP, `SESSION/CSRF_COOKIE_HTTPONLY = True` |
| `.gitignore` не игнорирует `*.key`, `*.pem`, `.env.*` | `.gitignore` | Дополнить паттерны |
| Overpass QL: float-координаты без range-check | `core/services.py` | Проверка диапазона `[-90,90]/[-180,180]` |
| `DecimalField(decimal_places=2)` для USDT (TRC-20 — 6 знаков) | `core/models.py:109` | `decimal_places=6` + миграция |
| Возврат USDT не автоматизирован | `core/` | Структурированный refund-workflow |

---

## 5. Quick Wins (эффект < 30 мин каждый)

| # | Действие | Файл | Время |
|---|---|---|---|
| 1 | `Django==5.2.11` в `requirements.txt` — закрывает обе SQLi-CVE одним апдейтом | `requirements.txt` | 10 мин |
| 2 | `CORS_ALLOW_ALL_ORIGINS = False` явно | `config/settings.py:188` | 2 мин |
| 3 | `ETG_BASE_URL` из env вместо хардкода sandbox | `core/services.py:18` | 15 мин |
| 4 | Startup-guard fail-fast для `ETG_KEY`/`ABCEX_*`/`TELEGRAM_BOT_TOKEN`/`ETG_WEBHOOK_SECRET` | `config/settings.py` | 15 мин |
| 5 | `html.escape()` на подстановки в Telegram-сообщение | `core/views.py:64–68` | 10 мин |
| 6 | `urlparse`-проверка схемы `voucher_url` | `core/views.py:486,534` | 5 мин |
| 7 | Инвертировать guard в `process_successful_payment_task` (только из `PENDING_PAYMENT`) | `core/tasks.py:23` | 10 мин |
| 8 | Guard статуса в `BookingStatusCheckView` | `core/views.py:484` | 15 мин |
| 9 | `*.key`, `*.pem`, `.env.*` в `.gitignore` | `.gitignore` | 2 мин |

~1.5 часа работы закрывают 9 пунктов, включая 3 из 5 P0 и привязку к двум attack-chain.

---

## 6. Рекомендуемый порядок

1. **Сегодня (P0):** quick-wins 1–4 (Django-апдейт, CORS, ETG-URL, startup-guards) — это
   минимально необходимое для безопасного прод-деплоя.
2. **Спринт 1:** PostgreSQL вместо SQLite (#2 P0); state-machine guards и `select_for_update`
   (#6–8 P1); `access_token` из заголовка + TTL (#9); rate-limiting (#13); HTML-escape +
   `voucher_url` (#10–11).
3. **Спринт 2:** `OrderStatusHistory` audit trail (#14); webhook replay-protection;
   `Decimal` вместо `float` в платёжных путях (#15); планировщик `expire_unpaid_order_task` (#16);
   security headers.
4. **Спринт 3:** полный апгрейд оставшихся SCA-зависимостей; автоматизация refund USDT;
   column-level encryption PII; Django Admin rate-limit + MFA.

---

## 7. Замечания по самому процессу аудита

1. **`docs_v2` фаза сканера была пустой** — это надо чинить в pipeline, иначе сравнение
   прогонов искажается. Стоит добавить assert: если `SCANNER_FINDINGS.json` пуст при наличии
   `requirements.txt` — это FAILED, а не DONE.
2. **EVAL-метрика бесполезна во всех трёх прогонах** (0% matched). Нужно либо привести
   `SecurityGate_decisions.txt` к той же системе координат (file:line), либо матчить по
   нормализованному описанию/CWE, а не по координатам.
3. **Taint-labels во всех прогонах только из LLM** (`rule=0, lsp=0`). LSP-серверы (pyright/pylsp)
   не установлены — `lsp_type_labels.py` стабильно падает (FAILED во всех версиях). Для
   доверия к taint-анализу стоит поставить LSP и настроить semgrep taint-правила под Django/DRF.
4. **`AUDIT_COMPARISON_OLD_VS_NEW.md` в `docs_v2` содержит неверный вывод** про «40+ SCA closed» —
   при использовании держать в уме §0 этого отчёта.

---

_Сгенерировано на основе `docs_v1/`, `docs_v2/`, `docs/` и верификации по текущим исходникам
(код заморожен 2026-05-13 00:19). Все line-номера проверены по актуальному коду._

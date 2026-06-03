import os
import hashlib
import hmac
import json
import subprocess
import sys
from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.contrib.admin.sites import AdminSite
from django.contrib.messages.storage.fallback import FallbackStorage
from django.contrib.sessions.middleware import SessionMiddleware
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory

from .admin import OrderAdmin
from .models import NetworkChoices, Order, OrderStatus, Transaction
from .services import AbcexPaymentService, EmergingTravelService
from .tasks import process_successful_payment_task
from .views import _safe_voucher_url, initiate_booking_with_crypto


def create_order(**overrides):
    defaults = {
        "user_email": "guest@example.com",
        "hotel_name": "Server Hotel",
        "check_in": "2026-06-01",
        "check_out": "2026-06-05",
        "amount_usdt": Decimal("120.50"),
        "cost_price_usdt": Decimal("120.50"),
        "rate_key": "server-book-hash",
        "status": OrderStatus.PENDING_PAYMENT,
    }
    defaults.update(overrides)
    return Order.objects.create(**defaults)


class SecuritySettingsTests(TestCase):
    def test_security_defaults_do_not_expose_debug_or_blanket_allow_any(self):
        self.assertFalse(settings.DEBUG)
        self.assertTrue(settings.ALLOWED_HOSTS)
        self.assertEqual(
            settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"],
            ["rest_framework.permissions.IsAuthenticated"],
        )
        self.assertFalse(str(settings.SECRET_KEY).startswith("django-insecure-"))
        self.assertFalse(str(getattr(settings, "ABCEX_BEARER_TOKEN", "")).startswith("eyJ"))

    def test_production_settings_require_explicit_secret_key(self):
        env = os.environ.copy()
        env.pop("DJANGO_SECRET_KEY", None)
        env.pop("SECRET_KEY", None)
        env["DJANGO_DEBUG"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "import config.settings"],
            cwd=settings.BASE_DIR,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DJANGO_SECRET_KEY", result.stderr)


class BookingSecurityTests(TestCase):
    def test_crypto_booking_uses_etg_prebook_price_not_request_price(self):
        request = APIRequestFactory().post(
            "/api/booking/crypto/",
            {
                "book_hash": "client-book-hash",
                "price": "0.01",
                "email": "guest@example.com",
                "hotel_name": "Client Hotel",
                "checkin": "2026-06-01",
                "checkout": "2026-06-05",
            },
            format="json",
        )
        prebook_response = {
            "status": "ok",
            "data": {
                "hotels": [
                    {
                        "name": "Server Hotel",
                        "rates": [
                            {
                                "book_hash": "server-book-hash",
                                "payment_options": {
                                    "payment_types": [
                                        {
                                            "show_amount": "120.50",
                                            "show_currency_code": "USD",
                                        }
                                    ]
                                },
                            }
                        ],
                    }
                ]
            },
        }

        with (
            patch("core.views.etg_service.prebook", return_value=prebook_response),
            patch("core.views.abcex_service.generate_new_address", return_value="TRX123"),
            patch("core.views.notify_status_change"),
        ):
            response = initiate_booking_with_crypto(request)

        self.assertEqual(response.status_code, 200)
        order = Order.objects.get()
        transaction = Transaction.objects.get(order=order)
        self.assertEqual(order.hotel_name, "Server Hotel")
        self.assertEqual(order.rate_key, "server-book-hash")
        self.assertEqual(order.amount_usdt, Decimal("120.50"))
        self.assertEqual(order.cost_price_usdt, Decimal("120.50"))
        self.assertEqual(transaction.amount_usdt, Decimal("120.50"))
        self.assertEqual(str(response.data["payment"]["amount"]), "120.50")
        self.assertIn("access_token", response.data)
        self.assertTrue(response.data["access_token"])
        self.assertNotEqual(order.access_token_hash, response.data["access_token"])

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_valid_access_token_allows_cancel_order(self):
        order = create_order()
        token = order.issue_access_token()
        client = APIClient()

        with patch("core.views.notify_status_change"):
            response = client.post(
                f"/api/booking/cancel/{order.id}/",
                {},
                format="json",
                HTTP_X_ORDER_ACCESS_TOKEN=token,
            )

        order.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(order.status, OrderStatus.CANCELLED)

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_cancel_order_requires_access_token_not_only_uuid(self):
        order = create_order()
        client = APIClient()

        with patch("core.views.notify_status_change") as notify:
            response = client.post(f"/api/booking/cancel/{order.id}/", {}, format="json")

        order.refresh_from_db()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(order.status, OrderStatus.PENDING_PAYMENT)
        notify.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_check_payment_requires_access_token_before_payment_lookup(self):
        order = create_order()
        Transaction.objects.create(
            order=order,
            to_address="TRX123",
            amount_usdt=order.amount_usdt,
            network=NetworkChoices.TRC20,
            confirmed=False,
        )
        client = APIClient()

        with patch("core.views.abcex_service.check_payment", return_value={"paid": False}) as check_payment:
            response = client.get(f"/api/booking/check-payment/{order.id}/")

        self.assertEqual(response.status_code, 403)
        check_payment.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_booking_form_requires_access_token_before_provider_call(self):
        order = create_order()
        client = APIClient()

        with patch("core.views.etg_service.create_booking_process") as create_form:
            response = client.post(
                "/api/booking/form/",
                {
                    "book_hash": "client-book-hash",
                    "internal_order_id": str(order.id),
                },
                format="json",
            )

        self.assertEqual(response.status_code, 403)
        create_form.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_booking_status_requires_access_token_before_provider_call(self):
        order = create_order()
        client = APIClient()

        with patch("core.views.etg_service.check_booking_status") as check_status:
            response = client.get(f"/api/booking/status/{order.id}/")

        self.assertEqual(response.status_code, 403)
        check_status.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_access_token_in_query_string_is_rejected(self):
        order = create_order()
        token = order.issue_access_token()
        client = APIClient()

        with patch("core.views.abcex_service.check_payment") as check_payment:
            response = client.get(f"/api/booking/check-payment/{order.id}/?access_token={token}")

        self.assertEqual(response.status_code, 403)
        check_payment.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_valid_access_token_allows_payment_check(self):
        order = create_order()
        token = order.issue_access_token()
        tx = Transaction.objects.create(
            order=order,
            to_address="TRX123",
            amount_usdt=order.amount_usdt,
            network=NetworkChoices.TRC20,
            confirmed=False,
        )
        client = APIClient()

        with (
            patch("core.views.abcex_service.check_payment", return_value={"paid": True, "txId": "tx-1"}),
            patch("core.views.notify_status_change"),
        ):
            response = client.get(
                f"/api/booking/check-payment/{order.id}/",
                HTTP_X_ORDER_ACCESS_TOKEN=token,
            )

        order.refresh_from_db()
        tx.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "paid")
        self.assertEqual(order.status, OrderStatus.PAID)
        self.assertTrue(tx.confirmed)
        self.assertEqual(tx.tx_hash, "tx-1")

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_booking_form_uses_server_rate_key_with_valid_access_token(self):
        order = create_order(rate_key="server-book-hash")
        token = order.issue_access_token()
        client = APIClient()

        with patch("core.views.etg_service.create_booking_process", return_value={"status": "ok"}) as create_form:
            response = client.post(
                "/api/booking/form/",
                {
                    "book_hash": "client-tampered-book-hash",
                    "internal_order_id": str(order.id),
                    "access_token": token,
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(create_form.call_args.kwargs["book_hash"], "server-book-hash")
        self.assertEqual(create_form.call_args.kwargs["internal_order_id"], order.id)

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_finish_requires_access_token_before_provider_call(self):
        order = create_order(status=OrderStatus.PAID)
        client = APIClient()
        payload = {
            "internal_order_id": str(order.id),
            "guests": [{"first_name": "Ada", "last_name": "Lovelace"}],
            "contact_data": {"email": "guest@example.com", "phone": "+77001234567"},
        }

        with (
            patch("core.views.etg_service.finish_booking", return_value={"status": "error"}) as finish_booking,
            patch("core.views.notify_status_change") as notify,
        ):
            response = client.post("/api/booking/finish/", payload, format="json")

        order.refresh_from_db()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(order.status, OrderStatus.PAID)
        finish_booking.assert_not_called()
        notify.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False, ETG_WEBHOOK_SECRET="webhook-secret")
    def test_webhook_rejects_invalid_signature_before_order_update(self):
        order = create_order(status=OrderStatus.PAID)
        client = APIClient()
        payload = {
            "data": {
                "partner_order_id": str(order.id),
                "status": "success",
                "pdf_url": "https://example.test/voucher.pdf",
            }
        }

        with patch("core.views.notify_status_change") as notify:
            response = client.post(
                "/api/booking/webhook/etg/",
                payload,
                format="json",
                HTTP_X_ETG_SIGNATURE="bad-signature",
            )

        order.refresh_from_db()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(order.status, OrderStatus.PAID)
        self.assertFalse(order.voucher_url)
        notify.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False, ETG_WEBHOOK_SECRET="webhook-secret")
    def test_webhook_blocks_voucher_transition_from_cancelled_order(self):
        order = create_order(status=OrderStatus.CANCELLED)
        client = APIClient()
        payload = {
            "data": {
                "partner_order_id": str(order.id),
                "status": "success",
                "pdf_url": "https://example.test/voucher.pdf",
            }
        }
        raw_payload = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        signature = hmac.new(b"webhook-secret", raw_payload, hashlib.sha256).hexdigest()

        with patch("core.views.notify_status_change") as notify:
            response = client.generic(
                "POST",
                "/api/booking/webhook/etg/",
                raw_payload,
                content_type="application/json",
                HTTP_X_ETG_SIGNATURE=f"sha256={signature}",
            )

        order.refresh_from_db()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertFalse(order.voucher_url)
        notify.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_booking_status_blocks_voucher_transition_from_cancelled_order(self):
        order = create_order(status=OrderStatus.CANCELLED)
        token = order.issue_access_token()
        client = APIClient()

        with (
            patch(
                "core.views.etg_service.check_booking_status",
                return_value={
                    "status": "ok",
                    "data": {
                        "order_id": "etg-123",
                        "pdf_url": "https://example.test/voucher.pdf",
                    },
                },
            ),
            patch("core.views.notify_status_change") as notify,
        ):
            response = client.get(
                f"/api/booking/status/{order.id}/",
                HTTP_X_ORDER_ACCESS_TOKEN=token,
            )

        order.refresh_from_db()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(order.status, OrderStatus.CANCELLED)
        self.assertFalse(order.emerging_booking_id)
        self.assertFalse(order.voucher_url)
        notify.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=False)
    def test_paid_order_can_be_cancelled_with_provider_and_marked_refunded(self):
        order = create_order(status=OrderStatus.PAID)
        token = order.issue_access_token()
        client = APIClient()

        with (
            patch("core.views.etg_service.cancel_booking", return_value={"status": "ok"}) as cancel_booking,
            patch("core.views.notify_status_change"),
        ):
            response = client.post(
                f"/api/booking/refund/{order.id}/",
                {},
                format="json",
                HTTP_X_ORDER_ACCESS_TOKEN=token,
            )

        order.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "refunded")
        self.assertEqual(order.status, OrderStatus.REFUNDED)
        cancel_booking.assert_called_once_with(order.id)


class PaymentTaskTests(TestCase):
    def test_successful_payment_task_marks_order_paid_without_final_booking_call(self):
        order = create_order()

        process_successful_payment_task(str(order.id))

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.PAID)
        self.assertFalse(order.emerging_booking_id)
        self.assertFalse(order.voucher_url)

    def test_successful_payment_task_does_not_revive_cancelled_order(self):
        order = create_order(status=OrderStatus.CANCELLED)

        process_successful_payment_task(str(order.id))

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)

    def test_successful_payment_task_does_not_revive_failed_order(self):
        order = create_order(status=OrderStatus.FAILED)

        process_successful_payment_task(str(order.id))

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.FAILED)


class EmergingTravelServiceTests(TestCase):
    @override_settings(ETG_BASE_URL="https://api.worldota.net/api/b2b/v3")
    def test_finish_booking_sends_exact_decimal_amount_as_string(self):
        service = EmergingTravelService()

        with patch.object(service.session, "post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = {"status": "ok"}

            result = service.finish_booking(
                guest_data=[{"first_name": "Ada", "last_name": "Lovelace"}],
                contact_data={"email": "guest@example.com", "phone": "+77001234567"},
                internal_order_id="order-1",
                price=Decimal("120.50"),
                currency="USD",
            )

        self.assertEqual(result["status"], "ok")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["payment_type"]["amount"], "120.50")


class AbcexPaymentServiceTests(TestCase):
    def test_check_payment_accepts_tron_precision_rounding_dust(self):
        service = AbcexPaymentService()
        response_payload = {
            "data": [
                {
                    "addressTo": "TRX123",
                    "amount": "189.98999999",
                    "txId": "tx-1",
                }
            ]
        }

        with patch("core.services.requests.get") as request_get:
            request_get.return_value.status_code = 200
            request_get.return_value.json.return_value = response_payload

            result = service.check_payment(
                target_address="TRX123",
                expected_amount=Decimal("189.99"),
            )

        self.assertTrue(result["paid"])
        self.assertEqual(result["txId"], "tx-1")
        self.assertEqual(result["actual_amount"], Decimal("189.98999999"))


class VoucherUrlGuardTests(TestCase):
    def test_safe_voucher_url_accepts_http_and_https(self):
        self.assertEqual(
            _safe_voucher_url("https://etg.example/v.pdf"),
            "https://etg.example/v.pdf",
        )
        self.assertEqual(
            _safe_voucher_url("http://etg.example/v.pdf"),
            "http://etg.example/v.pdf",
        )

    def test_safe_voucher_url_rejects_unsafe_schemes(self):
        self.assertEqual(_safe_voucher_url("javascript:alert(1)"), "")
        self.assertEqual(_safe_voucher_url("data:text/html,<script>"), "")
        self.assertEqual(_safe_voucher_url("file:///etc/passwd"), "")
        self.assertEqual(_safe_voucher_url("ftp://etg.example/v.pdf"), "")

    def test_safe_voucher_url_rejects_empty_and_relative(self):
        self.assertEqual(_safe_voucher_url(""), "")
        self.assertEqual(_safe_voucher_url(None), "")
        self.assertEqual(_safe_voucher_url("/voucher.pdf"), "")
        self.assertEqual(_safe_voucher_url("etg.example/v.pdf"), "")


class RefundAdminTests(TestCase):
    def test_admin_action_marks_paid_order_refunded(self):
        self.assertIn("mark_refunded", OrderAdmin.actions)

        order = create_order(status=OrderStatus.PAID)
        request = RequestFactory().post("/admin/core/order/")
        SessionMiddleware(lambda req: None).process_request(request)
        request.session.save()
        request._messages = FallbackStorage(request)

        order_admin = OrderAdmin(Order, AdminSite())

        with patch("core.admin.notify_status_change"):
            order_admin.mark_refunded(request, Order.objects.filter(id=order.id))

        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.REFUNDED)

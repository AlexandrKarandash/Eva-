from django.urls import path
from . import views

urlpatterns = [
    # Pages
    path('', views.index_view, name='index'),
    path('index.html', views.index_view, name='index_html'),

    path('catalog/', views.catalog_view, name='catalog'),
    path('catalog.html', views.catalog_view, name='catalog_html'),

    path('single/', views.single_view, name='single'),
    path('single.html', views.single_view, name='single_html'),

    path('payment/', views.payment_view, name='payment'),
    path('payment.html', views.payment_view, name='payment_html'),


    # API hotels
    path('api/hotels/search/', views.HotelSearchView.as_view(), name='hotel-search'),
    path('api/hotels/nearby-places/', views.hotel_nearby_places_view, name='hotel-nearby-places'),
    path('api/hotels/<path:hotel_id>/', views.hotel_detail_view, name='hotel_detail'),

    #webhook emails
    path('api/v1/vouchers/inbound-webhook/', views.InboundEmailWebhookView.as_view(), name='inbound_email_webhook'),

    # API booking
    path('api/booking/prebook/', views.PrebookView.as_view(), name='prebook'),
    path('api/booking/form/', views.BookingFormView.as_view(), name='booking-form'),
    path('api/booking/finish/', views.BookingFinishView.as_view(), name='booking-finish'),
    path('api/booking/status/<uuid:order_id>/', views.BookingStatusCheckView.as_view(), name='booking-status'),
    path('api/booking/check-payment/<uuid:order_id>/', views.CheckPaymentStatusView.as_view(), name='check_payment'),
    path('api/booking/cancel/<uuid:order_id>/', views.CancelOrderView.as_view(), name='cancel_order'),
    path('api/booking/refund/<uuid:order_id>/', views.CancelAfterPaymentView.as_view(), name='booking_refund'),
    path('api/booking/webhook/etg/', views.ETGWebhookView.as_view(), name='etg_webhook'),
]

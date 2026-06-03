(function () {
    'use strict';

    window.PaymentApi = window.PaymentApi || {};

    window.PaymentApi.getBookingForm = async function (booking, paymentState) {
        const payload = {
            book_hash: paymentState.book_hash || booking.book_hash,
            internal_order_id: paymentState.internal_order_id,
            access_token: window.PaymentCore.orderAccessToken(paymentState)
        };

        // console.log('=== BOOKING FORM REQUEST ===');
        // console.log(payload);

        return window.PaymentCore.request(window.PaymentCore.BOOKING_FORM_API, window.PaymentCore.withOrderAccessToken({
            method: 'POST',
            body: JSON.stringify(payload)
        }, payload.access_token));
    };
})();

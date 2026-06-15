(function () {
    'use strict';

    window.PaymentApi = window.PaymentApi || {};

    window.PaymentApi.prebook = async function (booking) {
        const payload = {
            book_hash: booking.book_hash,
            hotel_id: booking.hotel_id,
            email: booking.email || 'test@example.com',
            checkin: booking.checkin,
            checkout: booking.checkout,
            residency: booking.residency || 'ru'
        };

        // console.log('=== PREBOOK REQUEST ===');
        // console.log('booking:', booking);
        // console.log('payload:', payload);

        return window.PaymentCore.request(window.PaymentCore.PREBOOK_API, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    };
})();

(function () {
    'use strict';

    window.PaymentApi = window.PaymentApi || {};

    window.PaymentApi.finishBooking = async function (payload) {
        // console.log('=== FINISH REQUEST ===');
        // console.log('payload:', payload);
        const accessToken = window.PaymentCore.orderAccessToken(payload);

        return window.PaymentCore.request(window.PaymentCore.FINISH_API, window.PaymentCore.withOrderAccessToken({
            method: 'POST',
            body: JSON.stringify(payload)
        }, accessToken));
    };
})();

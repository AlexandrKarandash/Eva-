(function () {
    'use strict';

    window.PaymentApi = window.PaymentApi || {};

    window.PaymentApi.cancelBooking = async function (orderId, accessToken) {
        return window.PaymentCore.request(window.PaymentCore.CANCEL_API + encodeURIComponent(orderId) + '/', window.PaymentCore.withOrderAccessToken({
            method: 'POST',
            body: JSON.stringify({ access_token: accessToken || '' })
        }, accessToken));
    };
})();

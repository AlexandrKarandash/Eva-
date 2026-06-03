(function () {
    'use strict';

    window.PaymentApi = window.PaymentApi || {};

    window.PaymentApi.checkBookingStatus = async function (orderId, accessToken) {
        return window.PaymentCore.request(window.PaymentCore.STATUS_API + encodeURIComponent(orderId) + '/', window.PaymentCore.withOrderAccessToken({
            method: 'GET'
        }, accessToken));
    };
})();

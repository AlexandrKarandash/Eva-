(function () {
    'use strict';

    window.PaymentApi = window.PaymentApi || {};

    window.PaymentApi.checkPayment = async function (internalOrderId, accessToken) {
        return window.PaymentCore.request(window.PaymentCore.CHECK_PAYMENT_API + encodeURIComponent(internalOrderId) + '/', window.PaymentCore.withOrderAccessToken({
            method: 'GET'
        }, accessToken));
    };
})();

(function () {
    'use strict';

    window.PaymentCore = {
        BOOKING_STORAGE_KEY: 'aifory_hotel_booking_state',
        PAYMENT_STORAGE_KEY: 'aifory_hotel_payment_state',
        FINISH_STORAGE_KEY: 'aifory_hotel_finish_state',
        PAYMENT_TTL: 15 * 60 * 1000,

        PREBOOK_API: '/api/booking/prebook/',
        CHECK_PAYMENT_API: '/api/booking/check-payment/',
        BOOKING_FORM_API: '/api/booking/form/',
        FINISH_API: '/api/booking/finish/',
        STATUS_API: '/api/booking/status/',
        CANCEL_API: '/api/booking/cancel/',
        REFUND_API: '/api/booking/refund/',

        qs: function (selector, root) {
            return (root || document).querySelector(selector);
        },

        qsa: function (selector, root) {
            return Array.prototype.slice.call((root || document).querySelectorAll(selector));
        },

        escapeHtml: function (value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },

        loadStorage: function (key) {
            try {
                return JSON.parse(localStorage.getItem(key)) || null;
            } catch (e) {
                return null;
            }
        },

        saveStorage: function (key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        },

        getCookie: function (name) {
            const value = '; ' + document.cookie;
            const parts = value.split('; ' + name + '=');
            if (parts.length === 2) return parts.pop().split(';').shift();
            return '';
        },

        cleanPhone: function (value) {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (raw.charAt(0) === '+') return '+' + raw.replace(/[^\d]/g, '');
            return raw.replace(/[^\d]/g, '');
        },

        orderAccessToken: function (source) {
            if (!source) return '';
            return String(source.access_token || source.order_access_token || '').trim();
        },

        withOrderAccessToken: function (options, token) {
            options = options || {};
            options.headers = options.headers || {};

            if (token) {
                options.headers['X-Order-Access-Token'] = token;
            }

            return options;
        },

        request: function (url, options) {
            options = options || {};
            options.headers = options.headers || {};

            if (!options.headers['Content-Type'] && options.body) {
                options.headers['Content-Type'] = 'application/json';
            }

            options.headers.Accept = 'application/json';

            const csrf = window.PaymentCore.getCookie('csrftoken');
            if (csrf) options.headers['X-CSRFToken'] = csrf;

            options.credentials = 'same-origin';

            // console.log('=== FETCH ===');
            // console.log('URL:', url);
            // console.log('OPTIONS:', options);

            return fetch(url, options).then(async function (response) {
                const data = await response.json().catch(function () {
                    return null;
                });

                // console.log('=== RESPONSE ===');
                // console.log('STATUS:', response.status);
                // console.log('DATA:', data);

                if (!response.ok) {
                    const error = new Error((data && (data.detail || data.message || data.error)) || 'Ошибка запроса');
                    error.response = data;
                    error.status = response.status;
                    throw error;
                }

                return data;
            });
        }
    };
})();

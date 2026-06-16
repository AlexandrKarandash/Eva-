(function () {
    'use strict';

    const Core = window.PaymentCore;
    const Api = window.PaymentApi || {};

    const qs = Core.qs;
    const qsa = Core.qsa;
    const escapeHtml = Core.escapeHtml;

    const TEST_PAYMENT = !!window.AIFORY_TEST_PAYMENT;
    const PAYMENT_POLL_INTERVAL_MS = TEST_PAYMENT ? 2500 : 15000;
    const PAYMENT_POLL_MAX_ATTEMPTS = 59;
    const BOOKING_STATUS_POLL_INTERVAL_MS = TEST_PAYMENT ? 4000 : 15000;
    const BOOKING_STATUS_POLL_MAX_ATTEMPTS = 60;

    const BOOKING_ERROR_TEXT = 'Произошла ошибка при бронировании. Пожалуйста, попробуйте ещё раз или обратитесь в поддержку.';
    const BOOKING_PROCESSING_TEXT = 'Бронирование обрабатывается. Пожалуйста, подождите, мы проверяем финальный статус бронирования.';
    const BOOKING_SUCCESS_TEXT = 'Бронирование подтверждено. Ваучер будет отправлен на email.';

    let pollingTimer = null;
    let expireTimer = null;
    let pollingStarted = false;
    let pollingAttempts = 0;
    let currentBooking = null;
    let currentPaymentState = null;
    let isPaid = false;

    function getOrderAccessToken(source) {
        return Core.orderAccessToken(source);
    }

    function isPaymentStateForCurrentBooking(paymentState, booking) {
    if (!paymentState || !booking) return false;

    const stateBooking = paymentState.booking || {};

    return String(stateBooking.book_hash || paymentState.book_hash || '') === String(booking.book_hash || '') &&
        String(stateBooking.hotel_id || '') === String(booking.hotel_id || '') &&
        String(stateBooking.checkin || '') === String(booking.checkin || '') &&
        String(stateBooking.checkout || '') === String(booking.checkout || '');
}
    function ensureSkeletonStyles() {
        if (document.getElementById('payment-skeleton-styles')) return;

        const style = document.createElement('style');
        style.id = 'payment-skeleton-styles';
        style.textContent = '' +
            '.payment.is-loading .payment-wrap,.payment.is-loading .payment-dop{display:none!important;}' +
            '.payment-skeleton{display:grid;grid-template-columns:1fr 360px;gap:24px;margin-top:24px;}' +
            '.payment-skeleton__card{border-radius:28px;background:#fff;padding:24px;box-shadow:0 8px 30px rgba(15,23,42,.06);}' +
            '.payment-skeleton__line{display:block;border-radius:12px;background:linear-gradient(90deg,#eef0f4 0%,#f7f8fb 45%,#eef0f4 90%);background-size:240% 100%;animation:paymentSkeleton 1.15s ease-in-out infinite;}' +
            '.payment-skeleton__title{width:58%;height:34px;margin-bottom:22px;}' +
            '.payment-skeleton__text{height:16px;margin-bottom:14px;}' +
            '.payment-skeleton__text.w80{width:80%;}' +
            '.payment-skeleton__text.w65{width:65%;}' +
            '.payment-skeleton__text.w45{width:45%;}' +
            '.payment-skeleton__price{width:170px;height:42px;margin-bottom:22px;}' +
            '.payment-skeleton__btn{height:54px;border-radius:16px;}' +
            '.payment-cancelled{margin-top:20px;padding:24px;border-radius:20px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.05);}' +
            '.payment-cancelled h2{margin-bottom:10px;}' +
            '@keyframes paymentSkeleton{0%{background-position:120% 0}100%{background-position:-120% 0}}' +
            '@media(max-width:767px){.payment-skeleton{grid-template-columns:1fr}.payment-skeleton__card{border-radius:20px;padding:18px}}';

        document.head.appendChild(style);
    }

    function hideSkeleton() {
        const payment = qs('.payment');
        const skeleton = qs('.payment-skeleton');

        if (payment) payment.classList.remove('is-loading');
        if (skeleton) skeleton.remove();
    }

    function stopTimers() {
        if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
        }

        if (expireTimer) {
            clearInterval(expireTimer);
            expireTimer = null;
        }

        pollingStarted = false;
        pollingAttempts = 0;
    }

    function showError(message) {
        if (message) {
            console.error('[payment user-hidden error]', message);
        }

        hideSkeleton();
        stopTimers();

        const wrap = qs('.payment-wrap');
        if (!wrap) return;

        wrap.innerHTML = '' +
            '<div class="payment-wrap-item">' +
                '<p class="payment-info-title">Ошибка</p>' +
                '<p class="payment-item__info">' + escapeHtml(BOOKING_ERROR_TEXT) + '</p>' +
            '</div>';
    }

    function setBookingMessage(text) {
        const reserveText = qs('.payment-reserve p');
        if (reserveText) reserveText.textContent = text;
    }

    function normalizeBookingStatus(response) {
        if (!response) return '';

        return String(
            response.status ||
            response.booking_status ||
            response.order_status ||
            response.voucher_status ||
            response.etg_status ||
            response.state ||
            ''
        ).toLowerCase();
    }

    function isFinalBookingSuccess(status) {
        return [
            'completed',
            'complete',
            'confirmed',
            'success',
            'succeeded',
            'vouchered',
            'voucher_ready',
            'done'
        ].indexOf(status) !== -1;
    }

    function isFinalBookingFailed(status) {
        return [
            'failed',
            'fail',
            'error',
            'rejected',
            'cancelled',
            'canceled',
            'expired',
            'declined'
        ].indexOf(status) !== -1;
    }

    function showCancelledState(reason) {
        hideSkeleton();
        stopTimers();

        const wrap = qs('.payment-wrap');
        const dop = qs('.payment-dop');
        const form = qs('.js-payment-form');

        if (wrap) wrap.style.display = 'none';
        if (dop) dop.style.display = 'none';
        if (form) form.style.display = 'none';

        let block = qs('.payment-cancelled');
        const frame = qs('.payment .section-frame');

        if (!block && frame) {
            block = document.createElement('div');
            block.className = 'payment-cancelled';
            block.innerHTML = '' +
                '<h2>Заказ отменён</h2>' +
                '<p class="payment-cancelled-text"></p>' +
                '<a href="/" class="payment-pay" style="margin-top:16px;display:inline-block;">Вернуться к поиску</a>';

            frame.appendChild(block);
        }

        const text = qs('.payment-cancelled-text', block);
        if (text) text.textContent = reason || 'Время оплаты истекло.';
    }

    function formatPrice(value) {
        const number = parseFloat(value || 0);
        if (!Number.isFinite(number) || number <= 0) return '0';
        return number.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    }

    function getGuestCount(booking) {
        const adults = parseInt(booking && booking.adults, 10) || 0;
        const children = Array.isArray(booking && booking.children) ? booking.children.length : 0;
        return Math.max(adults + children, 1);
    }

    function updateTimerText(msLeft) {
        const node = qs('.payment-time span');
        if (!node) return;

        const safe = Math.max(msLeft, 0);
        const minutes = Math.floor(safe / 60000);
        const seconds = Math.floor((safe % 60000) / 1000);

        node.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    function renderGuestItem(number, isFirst, isChild, age) {
        const childAttr = isChild ? ' data-is-child="true" data-age="' + age + '"' : '';
        const title = isChild
            ? ('Ребёнок ' + number + ' (возраст: ' + age + ')')
            : ('Гость ' + number);
        let html = '' +
            '<div class="payment-form__item"' + childAttr + '>' +
                '<p class="payment-form__item-title">' + title + '</p>' +
                '<label class="payment-form__label">' +
                    '<span class="payment-form__label-title">Имя</span>' +
                    '<input type="text" name="guest_first_name_' + number + '" class="payment-form__input js-payment-required" placeholder="Иван" required>' +
                '</label>' +
                '<label class="payment-form__label">' +
                    '<span class="payment-form__label-title">Фамилия</span>' +
                    '<input type="text" name="guest_last_name_' + number + '" class="payment-form__input js-payment-required" placeholder="Иванов" required>' +
                '</label>';

        if (isFirst) {
            html += '' +
                '<label class="payment-form__label">' +
                    '<span class="payment-form__label-title">Телефон</span>' +
                    '<input type="text" name="phone" class="payment-form__input input-mask js-payment-required" placeholder="+7 999 999 99 99" required>' +
                '</label>' +
                '<label class="payment-form__label">' +
                    '<span class="payment-form__label-title">Почта</span>' +
                    '<input type="email" name="email" class="payment-form__input js-payment-required" placeholder="mail@example.com" required>' +
                '</label>';
        }

        html += '</div>';
        return html;
    }

    function getOccupancy(booking) {
        const adults = parseInt(booking && booking.adults, 10) || 0;
        let children = [];
        const raw = (booking && booking.children) || [];
        if (Array.isArray(raw)) {
            children = raw.map(function (c) {
                if (typeof c === 'number') return c;
                if (c && typeof c === 'object') return parseInt(c.age, 10);
                return parseInt(c, 10);
            }).filter(function (a) { return !Number.isNaN(a); });
        }
        return { adults: adults, children: children };
    }

    function renderGuestForm(booking) {
        const form = qs('.js-payment-form');
        if (!form) return;

        const occ = getOccupancy(booking);
        let html = '';
        let n = 0;

        // Сначала взрослые, затем дети (с указанием возраста) — порядок и состав
        // должны совпадать с тем, что отправлено в поиске/тарифе.
        for (let a = 0; a < occ.adults; a += 1) {
            n += 1;
            html += renderGuestItem(n, n === 1, false, null);
        }
        occ.children.forEach(function (age) {
            n += 1;
            html += renderGuestItem(n, n === 1, true, age);
        });
        if (n === 0) {
            html = renderGuestItem(1, true, false, null);
        }

        form.innerHTML = html;
        form.style.display = '';

        if (typeof window.jQuery !== 'undefined' && typeof window.jQuery.fn.mask === 'function') {
            window.jQuery('.input-mask', form).mask('+7 (999) 999-99-99');
        }

        bindPaymentFormValidation();
    }

    function isPaymentFormFilled() {
        const form = qs('.js-payment-form');
        if (!form) return false;

        const required = qsa('.js-payment-required', form);
        if (!required.length) return false;

        return required.every(function (input) {
            return String(input.value || '').trim().length > 0;
        });
    }

    function updatePaymentButtonState() {
        const payBtn = qs('.payment-pay');
        if (!payBtn || isPaid) return;

        payBtn.classList.toggle('disabled', !isPaymentFormFilled());
    }

    function bindPaymentFormValidation() {
        const form = qs('.js-payment-form');
        const payBtn = qs('.payment-pay');

        if (!form || !payBtn) return;

        if (!form.__paymentValidationBound) {
            form.__paymentValidationBound = true;
            form.addEventListener('input', updatePaymentButtonState);
            form.addEventListener('change', updatePaymentButtonState);
        }

        updatePaymentButtonState();
    }
    function cleanName(value) {
        if (!value) return '';

        return value
            .replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '')
            .replace(/\s+/g, ' ')                 
            .trim();
    }
    function collectGuestsFromForm(form) {
        const items = qsa('.payment-form__item', form);

        return items.map(function (item) {
            const firstName = qs('input[name^="guest_first_name_"]', item);
            const lastName = qs('input[name^="guest_last_name_"]', item);

            const guest = {
                first_name: cleanName(firstName ? firstName.value : ''),
                last_name: cleanName(lastName ? lastName.value : '')
            };
            // ETG требует для детей is_child:true и age (возраст из поиска)
            if (item.getAttribute('data-is-child') === 'true') {
                guest.is_child = true;
                guest.age = parseInt(item.getAttribute('data-age'), 10);
            }
            return guest;
        }).filter(function (guest) {
            return guest.first_name || guest.last_name;
        });
    }

    function getContactDataFromForm(form, booking) {
        const emailInput = qs('input[type="email"], input[name="email"]', form);
        const phoneInput = qs('input[name="phone"], input[type="tel"], .input-mask', form);

        return {
            email: emailInput ? emailInput.value.trim() : (booking.email || 'test@example.com'),
            phone: phoneInput ? Core.cleanPhone(phoneInput.value) : Core.cleanPhone(booking.phone || '')
        };
    }

    function showBookingSentState() {
        const reserveText = qs('.payment-reserve p');
        const paymentTime = qs('.payment-time');
        const paymentRemove = qs('.payment-remove');
        const paymentPay = qs('.payment-pay');

        if (reserveText) reserveText.textContent = BOOKING_PROCESSING_TEXT;
        if (paymentTime) paymentTime.style.display = 'none';
        if (paymentRemove) paymentRemove.style.display = 'none';
        if (paymentPay) paymentPay.style.display = 'none';
    }

async function waitFinalBookingStatus(orderId, accessToken) {
    if (!Api.checkBookingStatus || !orderId) {
        setBookingMessage(BOOKING_PROCESSING_TEXT);
        return null;
    }

    for (let attempt = 0; attempt < BOOKING_STATUS_POLL_MAX_ATTEMPTS; attempt += 1) {
        try {
            const statusResponse = await Api.checkBookingStatus(orderId, accessToken);
            const status = normalizeBookingStatus(statusResponse);

            Core.saveStorage(Core.FINISH_STORAGE_KEY, {
                status_response: statusResponse,
                checked_at: new Date().toISOString()
            });

            if (isFinalBookingSuccess(status)) {
                setBookingMessage(BOOKING_SUCCESS_TEXT);
                return statusResponse;
            }

            if (isFinalBookingFailed(status)) {
                console.error('[booking final status failed]', statusResponse);
                setBookingMessage(BOOKING_ERROR_TEXT);
                return statusResponse;
            }

            setBookingMessage(BOOKING_PROCESSING_TEXT);
        } catch (error) {
            console.error('[booking final status]', error);
            setBookingMessage(BOOKING_ERROR_TEXT);
            return null;
        }

        await new Promise(function (resolve) {
            setTimeout(resolve, BOOKING_STATUS_POLL_INTERVAL_MS);
        });
    }

    setBookingMessage(BOOKING_PROCESSING_TEXT);
    return null;
}

async function submitFinishAfterPaid(paymentState) {
    const source = paymentState && paymentState.finish_payload
        ? paymentState.finish_payload
        : paymentState;

    const finalPayload = {
        internal_order_id: String(source && source.internal_order_id ? source.internal_order_id : ''),
        access_token: getOrderAccessToken(source || paymentState),
        guests: Array.isArray(source && source.guests)
            ? source.guests.map(function (guest) {
                const g = {
                    first_name: guest.first_name || '',
                    last_name: guest.last_name || ''
                };
                if (guest.is_child) {
                    g.is_child = true;
                    g.age = guest.age;
                }
                return g;
            })
            : [],
        contact_data: {
            email: source && source.contact_data && source.contact_data.email
                ? source.contact_data.email
                : '',
            phone: source && source.contact_data && source.contact_data.phone
                ? source.contact_data.phone
                : '',
            language: 'ru'
        }
    };

    if (
        !finalPayload.internal_order_id ||
        !finalPayload.access_token ||
        !finalPayload.guests.length ||
        !finalPayload.contact_data.email ||
        !finalPayload.contact_data.phone
    ) {
        console.error('FINISH payload invalid:', finalPayload);
        setBookingMessage(BOOKING_ERROR_TEXT);
        return;
    }

    try {
        setBookingMessage(BOOKING_PROCESSING_TEXT);

        const result = await Api.finishBooking(finalPayload);
        Core.saveStorage(Core.FINISH_STORAGE_KEY, {
            finish_response: result,
            finished_at: new Date().toISOString()
        });

        await waitFinalBookingStatus(finalPayload.internal_order_id, finalPayload.access_token);
    } catch (error) {
        console.error('[finish booking]', error);
        console.error('ERROR STATUS:', error.status);
        console.error('ERROR RESPONSE:', error.response);
        console.error('FAILED FINISH PAYLOAD:', finalPayload);

        setBookingMessage(BOOKING_ERROR_TEXT);
    }
}

    function showPaidState(booking, paymentState) {
        isPaid = true;

        if (pollingTimer) clearInterval(pollingTimer);
        if (expireTimer) clearInterval(expireTimer);

        const info = qs('.js-payment-info');
        const reserveText = qs('.payment-reserve p');
        const paymentTime = qs('.payment-time');
        const paymentRemove = qs('.payment-remove');
        const paymentPay = qs('.payment-pay');

        if (info) info.classList.remove('hide');
        if (reserveText) reserveText.textContent = BOOKING_PROCESSING_TEXT;
        if (paymentTime) paymentTime.style.display = 'none';
        if (paymentRemove) paymentRemove.style.display = 'none';
        if (paymentPay) paymentPay.style.display = 'none';

        paymentState.paid = true;
        paymentState.paid_at = new Date().toISOString();
        Core.saveStorage(Core.PAYMENT_STORAGE_KEY, paymentState);

        submitFinishAfterPaid(paymentState);
    }

    function startPolling(booking, paymentState) {
        if (pollingStarted || !paymentState.internal_order_id || paymentState.cancelled || paymentState.paid) return;

        pollingStarted = true;
        pollingAttempts = 0;

        pollingTimer = setInterval(async function () {
            if (pollingAttempts >= PAYMENT_POLL_MAX_ATTEMPTS) {
                if (pollingTimer) {
                    clearInterval(pollingTimer);
                    pollingTimer = null;
                }
                pollingStarted = false;
                return;
            }

            pollingAttempts += 1;

            try {
                const status = await Api.checkPayment(
                    paymentState.internal_order_id,
                    getOrderAccessToken(paymentState)
                );

                if (status.status === 'booking') {
                    stopTimers();
                    showBookingSentState();
                    return;
                }

                if (status.status !== 'paid') return;

                await Api.getBookingForm(booking, paymentState);
                showPaidState(booking, paymentState);
            } catch (error) {
                console.error('[payment polling]', error);
            }
        }, PAYMENT_POLL_INTERVAL_MS);
    }

    function startExpireTimer(paymentState) {
        if (!paymentState.started_at || !paymentState.internal_order_id || paymentState.cancelled || paymentState.paid) return;

        if (expireTimer) clearInterval(expireTimer);

        async function checkExpire() {
            if (isPaid) return;

            const left = Core.PAYMENT_TTL - (Date.now() - paymentState.started_at);
            updateTimerText(left);

            if (left > 0) return;

            clearInterval(expireTimer);
            expireTimer = null;

            try {
                await Api.cancelBooking(paymentState.internal_order_id, getOrderAccessToken(paymentState));
            } catch (error) {
                console.error('[payment auto cancel]', error);
            }

            paymentState.cancelled = true;
            paymentState.cancelled_reason = 'expired';
            paymentState.cancelled_at = new Date().toISOString();
            Core.saveStorage(Core.PAYMENT_STORAGE_KEY, paymentState);

            showCancelledState('Время на оплату истекло.');
        }

        checkExpire();
        expireTimer = setInterval(checkExpire, 1000);
    }

    function formatDateRu(dateString) {
    if (!dateString) return '—';

    const date = new Date(dateString + 'T00:00:00');

    if (Number.isNaN(date.getTime())) return dateString;

    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        weekday: 'short'
    });
}

function formatMeal(value) {
    if (!value || value === 'nomeal') return 'Без питания';
    if (value.indexOf('breakfast') !== -1) return 'Завтрак включён';
    return value;
}

function renderPaymentInfo(booking) {
    const info = qs('.js-payment-info');
    if (!info || !booking) return;

    const guests = Array.isArray(booking.guests)
        ? booking.guests.map(function (guest) {
            return [guest.first_name, guest.last_name].filter(Boolean).join(' ');
        }).filter(Boolean)
        : [];

        info.innerHTML = '' +
            '<p class="payment-info-title">Информация по заказу</p>' +
            '<div class="payment-list">' +
                '<div class="payment-item">' +
                    '<p class="payment-item__title">Отель ' + escapeHtml(booking.hotel_name || booking.name || '—') + '</p>' +
                    '<p class="payment-item__info">Заезд: <b>' + escapeHtml(formatDateRu(booking.checkin)) + '</b></p>' +
                    '<p class="payment-item__info">Выезд: <b>' + escapeHtml(formatDateRu(booking.checkout)) + '</b></p>' +
                '</div>' +
                '<div class="payment-item">' +
                    '<p class="payment-item__title">' + escapeHtml(booking.room_name || booking.rate_name || 'Номер') + '</p>' +
                    '<p class="payment-item__info">Тип питания: <b>' + escapeHtml(formatMeal(booking.meal)) + '</b></p>' +
                    '<p class="payment-item__info">Тип кровати: <b>' + escapeHtml(booking.bed_type || 'Уточняется') + '</b></p>' +
                '</div>' +
                '<div class="payment-item">' +
                    '<p class="payment-item__info">Проживающие:</p>' +
                    '<p class="payment-item__person">' + escapeHtml(guests.length ? guests.join(', ') : 'Будут указаны после заполнения формы') + '</p>' +
                '</div>' +
            '</div>';

        info.classList.remove('hide');
    }

    function renderPaymentAfterPrebook(booking, paymentState) {
        const form = qs('.js-payment-form');
        const info = qs('.js-payment-info');
        const payBtn = qs('.payment-pay');
        const addressNode = qs('.js-payment-address');
        const priceValue = qs('.payment-price__value p');
        const titleSpan = qs('.payment-title h1 span');
        const copyBtn = qs('.payment-copy');

        const payment = paymentState.payment || {};
        const address = payment.address || '';
        const orderId = paymentState.internal_order_id || '';

        if (form) form.style.display = 'none';
        if (info) info.classList.remove('hide');
        if (titleSpan) titleSpan.textContent = orderId || '—';
        if (copyBtn) copyBtn.setAttribute('data-copy', orderId);
        if (priceValue) priceValue.textContent = formatPrice(payment.amount);

        if (TEST_PAYMENT) {
            // Тестовый режим: крипто-оплата не нужна, не рисуем QR и блокируем кнопку.
            if (addressNode) addressNode.textContent = 'Тестовый режим — оплата подтверждается автоматически…';
            if (payBtn) {
                payBtn.classList.add('disabled');
                payBtn.dataset.paymentReady = 'false';
                payBtn.textContent = 'Подтверждаем оплату…';
            }
        } else {
            if (addressNode) addressNode.textContent = address || 'Адрес оплаты не получен';
            renderPaymentQr(address);
            if (payBtn) {
                payBtn.classList.remove('disabled');
                payBtn.dataset.paymentReady = 'true';
                payBtn.textContent = 'Оплата через ' + (payment.currency || 'USDT') + ' ' + (payment.network || 'TRC-20');
                payBtn.setAttribute('data-address', address);
            }
        }
        renderPaymentInfo(booking);
    }

    function attachGuestDataToPaymentState(paymentState, guests, contactData) {
        paymentState = paymentState || {};

        paymentState.form_submitted = true;
        paymentState.payment_visible = true;
        paymentState.guests_saved_at = new Date().toISOString();
        paymentState.finish_payload = {
            internal_order_id: paymentState.internal_order_id,
            access_token: paymentState.access_token,
            guests: guests,
            contact_data: {
                email: contactData.email,
                phone: contactData.phone,
                language: 'ru'
            }
        };

        return paymentState;
    }

    async function startPaymentAfterFormFilled(payBtn) {
        if (!currentBooking) return;

        const form = qs('.js-payment-form');

        if (!isPaymentFormFilled()) {
            payBtn.classList.add('disabled');
            alert('Заполните все поля гостей.');
            return;
        }

        const guests = collectGuestsFromForm(form);
        const contactData = getContactDataFromForm(form, currentBooking);

        currentBooking.email = contactData.email;
        currentBooking.phone = contactData.phone;
        currentBooking.guests = guests;

        Core.saveStorage(Core.BOOKING_STORAGE_KEY, currentBooking);

        payBtn.classList.add('disabled');
        payBtn.textContent = 'Открываем оплату...';

        try {
            if (!currentPaymentState || !currentPaymentState.internal_order_id) {
                const prebookData = await Api.prebook(currentBooking);

                currentPaymentState = Object.assign({}, prebookData, {
                    book_hash: prebookData.book_hash || currentBooking.book_hash,
                    booking: {
                        book_hash: prebookData.book_hash || currentBooking.book_hash,
                        hotel_id: currentBooking.hotel_id,
                        checkin: currentBooking.checkin,
                        checkout: currentBooking.checkout
                    },
                    started_at: Date.now(),
                    created_at: new Date().toISOString(),
                    cancelled: false,
                    paid: false,
                    payment_visible: false,
                    form_submitted: false
                });
            }

            currentPaymentState = attachGuestDataToPaymentState(currentPaymentState, guests, contactData);

            Core.saveStorage(Core.PAYMENT_STORAGE_KEY, currentPaymentState);
            bindPaymentActions(currentBooking, currentPaymentState);

            renderPaymentAfterPrebook(currentBooking, currentPaymentState);
            startExpireTimer(currentPaymentState);
            startPolling(currentBooking, currentPaymentState);
        } catch (error) {
            payBtn.textContent = 'Перейти к оплате';
            payBtn.classList.remove('disabled');
            alert(BOOKING_ERROR_TEXT);
            console.error('[payment after form]', error);
        }
    }

    function bindPaymentButton() {
        const payBtn = qs('.payment-pay');
        if (!payBtn || payBtn.__paymentButtonBound) return;

        payBtn.__paymentButtonBound = true;

        payBtn.addEventListener('click', async function (event) {
            event.preventDefault();

            if (payBtn.classList.contains('disabled')) {
                alert('Заполните все поля гостей.');
                return;
            }

            if (payBtn.dataset.paymentReady === 'true') {
                if (typeof openPopup === 'function') openPopup('QR');
                return;
            }

            await startPaymentAfterFormFilled(payBtn);
        });
    }

    function bindPaymentActions(booking, paymentState) {
    const cancelBtn = qs('.payment-remove');
    const newSearch = qsa('.payment-new-search');

    if (cancelBtn && !cancelBtn.__paymentCancelBound) {
        cancelBtn.__paymentCancelBound = true;

        cancelBtn.addEventListener('click', async function (event) {
            event.preventDefault();

            const state = currentPaymentState || paymentState || Core.loadStorage(Core.PAYMENT_STORAGE_KEY);

            if (!state || !state.internal_order_id) {
                window.location.href = '/';
                return;
            }

            try {
                await Api.cancelBooking(state.internal_order_id, getOrderAccessToken(state));

                state.cancelled = true;
                state.cancelled_reason = 'manual';
                state.cancelled_at = new Date().toISOString();

                currentPaymentState = null;
                localStorage.removeItem(Core.PAYMENT_STORAGE_KEY);

                window.location.href = '/';
            } catch (error) {
                console.error('[payment cancel]', error);
                alert(BOOKING_ERROR_TEXT);
            }
        });
    }

    newSearch.forEach(function (btn) {
        btn.setAttribute('href', '/');
    });
}
function renderPaymentQr(address) {
    const qrWrap = qs('.popup-qr__photo');
    if (!qrWrap || !address) return;

    qrWrap.innerHTML = '';

    if (typeof window.QRCode !== 'function') {
        qrWrap.textContent = 'QR-код недоступен';
        console.error('[payment qr] QRCode library not loaded');
        return;
    }

    new window.QRCode(qrWrap, {
        text: address,
        width: 200,
        height: 200,
        correctLevel: window.QRCode.CorrectLevel.M
    });
}
function renderPaymentStartInfo(booking) {
    const priceValue = qs('.payment-price__value p');
    const titleSpan = qs('.payment-title h1 span');
    const info = qs('.js-payment-info');

    const price = booking.price || booking.amount || booking.total_price || 0;

    if (priceValue) {
        priceValue.textContent = formatPrice(price);
    }

    if (titleSpan) {
        titleSpan.textContent = 'Ожидает создания';
    }

    if (info) {
        info.classList.add('hide');
    }
}
    async function initPaymentPage() {
        if (!qs('.payment')) return;

        const booking = Core.loadStorage(Core.BOOKING_STORAGE_KEY);
        currentBooking = booking;
        const paymentState = Core.loadStorage(Core.PAYMENT_STORAGE_KEY);
        currentPaymentState = paymentState;
        if (currentPaymentState && !isPaymentStateForCurrentBooking(currentPaymentState, booking)) {
            localStorage.removeItem(Core.PAYMENT_STORAGE_KEY);
            currentPaymentState = null;
        }

        if (!booking || !booking.book_hash || !booking.hotel_id || !booking.checkin || !booking.checkout) {
            showError('Нет данных для оплаты. Вернитесь к выбору номера.');
            return;
        }

        renderGuestForm(booking);
        renderPaymentStartInfo(booking);
        bindPaymentButton();
        bindPaymentActions(booking, currentPaymentState || {});
        if (currentPaymentState && currentPaymentState.internal_order_id) {
            if (currentPaymentState.cancelled) {
                localStorage.removeItem(Core.PAYMENT_STORAGE_KEY);
                return;
            }

            if (currentPaymentState.paid) {
                showPaidState(booking, currentPaymentState);
                return;
            }

            if (currentPaymentState.payment_visible || currentPaymentState.form_submitted) {
                renderPaymentAfterPrebook(booking, currentPaymentState);
                startExpireTimer(currentPaymentState);
                startPolling(booking, currentPaymentState);
                return;
            }
        }

        const payBtn = qs('.payment-pay');
        if (payBtn) {
            payBtn.classList.toggle('disabled', !isPaymentFormFilled());
            payBtn.textContent = 'Перейти к оплате';
            payBtn.dataset.paymentReady = 'false';
        }
    }

    document.addEventListener('DOMContentLoaded', initPaymentPage);
})();

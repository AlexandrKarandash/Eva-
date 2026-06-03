(function () {
    'use strict';

    const Core = window.PaymentCore;
    const Api = window.PaymentApi || {};

    const qs = Core.qs;
    const qsa = Core.qsa;
    const escapeHtml = Core.escapeHtml;

    const CITIZENSHIP_OPTIONS = [
        'Австралия',
        'Австрия',
        'Азербайджан',
        'Аландские острова',
        'Албания',
        'Алжир',
        'Американские Самоа',
        'Ангилья',
        'Ангола',
        'Андорра',
        'Антарктида',
        'Антигуа и Барбуда',
        'Аргентина',
        'Армения',
        'Аруба',
        'Афганистан',
        'Багамы',
        'Бангладеш',
        'Барбадос',
        'Бахрейн',
        'Беларусь',
        'Белиз',
        'Бельгия',
        'Бенин',
        'Бермуды',
        'Болгария',
        'Боливия',
        'Бонайре, Синт-Эстатиус и Саба',
        'Босния и Герцеговина',
        'Ботсвана',
        'Бразилия',
        'Британская территория в Индийском океане',
        'Британские Виргинские острова',
        'Бруней',
        'Буркина-Фасо',
        'Бурунди',
        'Бутан',
        'Вануату',
        'Ватикан',
        'Великобритания',
        'Венгрия',
        'Венесуэла',
        'Виргинские острова США',
        'Внешние малые острова США',
        'Восточный Тимор',
        'Вьетнам',
        'Габон',
        'Гаити',
        'Гайана',
        'Гамбия',
        'Гана',
        'Гваделупа',
        'Гватемала',
        'Гвинея',
        'Гвинея-Бисау',
        'Германия',
        'Гернси',
        'Гибралтар',
        'Гондурас',
        'Гонконг',
        'Гренада',
        'Гренландия',
        'Греция',
        'Грузия',
        'Гуам',
        'Дания',
        'Джерси',
        'Джибути',
        'Доминика',
        'Доминиканская Республика',
        'Египет',
        'Замбия',
        'Западная Сахара',
        'Зимбабве',
        'Израиль',
        'Индия',
        'Индонезия',
        'Иордания',
        'Ирак',
        'Иран',
        'Ирландия',
        'Исландия',
        'Испания',
        'Италия',
        'Йемен',
        'Кабо-Верде',
        'Казахстан',
        'Камбоджа',
        'Камерун',
        'Канада',
        'Катар',
        'Кения',
        'Кипр',
        'Киргизия',
        'Кирибати',
        'Китай',
        'Кокосовые острова',
        'Колумбия',
        'Коморы',
        'Конго',
        'Демократическая Республика Конго',
        'Коста-Рика',
        'Кот-д’Ивуар',
        'Куба',
        'Кувейт',
        'Кюрасао',
        'Лаос',
        'Латвия',
        'Лесото',
        'Либерия',
        'Ливан',
        'Ливия',
        'Литва',
        'Лихтенштейн',
        'Люксембург',
        'Маврикий',
        'Мавритания',
        'Мадагаскар',
        'Майотта',
        'Макао',
        'Малави',
        'Малайзия',
        'Мали',
        'Мальдивы',
        'Мальта',
        'Марокко',
        'Мартиника',
        'Маршалловы Острова',
        'Мексика',
        'Микронезия',
        'Мозамбик',
        'Молдова',
        'Монако',
        'Монголия',
        'Монтсеррат',
        'Мьянма',
        'Намибия',
        'Науру',
        'Непал',
        'Нигер',
        'Нигерия',
        'Нидерланды',
        'Никарагуа',
        'Ниуэ',
        'Новая Зеландия',
        'Новая Каледония',
        'Норвегия',
        'ОАЭ',
        'Оман',
        'Остров Буве',
        'Остров Мэн',
        'Остров Норфолк',
        'Остров Рождества',
        'Острова Кайман',
        'Острова Кука',
        'Острова Питкэрн',
        'Острова Теркс и Кайкос',
        'Пакистан',
        'Палау',
        'Палестина',
        'Панама',
        'Папуа — Новая Гвинея',
        'Парагвай',
        'Перу',
        'Польша',
        'Португалия',
        'Пуэрто-Рико',
        'Реюньон',
        'Россия',
        'Руанда',
        'Румыния',
        'Сальвадор',
        'Самоа',
        'Сан-Марино',
        'Сан-Томе и Принсипи',
        'Саудовская Аравия',
        'Северная Македония',
        'Северные Марианские острова',
        'Сейшелы',
        'Сен-Бартелеми',
        'Сен-Мартен (Франция)',
        'Сен-Пьер и Микелон',
        'Сенегал',
        'Сент-Винсент и Гренадины',
        'Сент-Китс и Невис',
        'Сент-Люсия',
        'Сербия',
        'Сингапур',
        'Синт-Мартен',
        'Сирия',
        'Словакия',
        'Словения',
        'Соломоновы Острова',
        'Сомали',
        'Судан',
        'Суринам',
        'США',
        'Сьерра-Леоне',
        'Таджикистан',
        'Таиланд',
        'Тайвань',
        'Танзания',
        'Того',
        'Токелау',
        'Тонга',
        'Тринидад и Тобаго',
        'Тувалу',
        'Тунис',
        'Туркменистан',
        'Турция',
        'Уганда',
        'Узбекистан',
        'Украина',
        'Уоллис и Футуна',
        'Уругвай',
        'Фарерские острова',
        'Фиджи',
        'Филиппины',
        'Финляндия',
        'Фолклендские острова',
        'Франция',
        'Французская Гвиана',
        'Французская Полинезия',
        'Французские южные территории',
        'Хорватия',
        'ЦАР',
        'Чад',
        'Черногория',
        'Чехия',
        'Чили',
        'Швейцария',
        'Швеция',
        'Шпицберген и Ян-Майен',
        'Шри-Ланка',
        'Эквадор',
        'Экваториальная Гвинея',
        'Эритрея',
        'Эстония',
        'Эсватини',
        'Эфиопия',
        'ЮАР',
        'Южная Георгия и Южные Сандвичевы острова',
        'Южная Корея',
        'Южный Судан',
        'Ямайка',
        'Япония'
    ];

    let pollingTimer = null;
    let expireTimer = null;
    let pollingStarted = false;
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

    function ensureCitizenshipStyles() {
        if (document.getElementById('payment-citizenship-styles')) return;

        const style = document.createElement('style');
        style.id = 'payment-citizenship-styles';
        style.textContent = '' +
            '.payment-citizenship{position:relative;z-index:6;}' +
            '.payment-citizenship.is-open{z-index:30;}' +
            '.payment-citizenship__field{position:relative;display:block;}' +
            '.payment-citizenship__field .payment-form__input{padding-right:48px;}' +
            '.payment-citizenship__toggle{position:absolute;top:50%;right:13px;width:28px;height:28px;margin-top:-14px;border:0;background:transparent;cursor:pointer;}' +
            '.payment-citizenship__toggle:before{content:"";display:block;width:11px;height:11px;margin:8px auto 0;border-top:3px solid #2F66E8;border-left:3px solid #2F66E8;transform:rotate(45deg);transition:.2s;}' +
            '.payment-citizenship:not(.is-open) .payment-citizenship__toggle:before{margin-top:4px;transform:rotate(225deg);}' +
            '.payment-citizenship__dropdown{position:absolute;left:0;right:0;top:calc(100% + 6px);max-height:285px;overflow:auto;border-radius:14px;background:#fff;box-shadow:0 8px 28px rgba(15,23,42,.12);border:1px solid rgba(221,214,254,.7);padding:8px 0;}' +
            '.payment-citizenship__option{display:block;width:100%;padding:12px 15px;border:0;background:#fff;text-align:left;font:inherit;font-weight:500;color:#18181B;cursor:pointer;transition:.15s;}' +
            '.payment-citizenship__option:hover,.payment-citizenship__option.is-active{background:#F4F7FF;color:#2F66E8;}' +
            '.payment-citizenship__empty{padding:12px 15px;color:#7A7A83;font-weight:500;}' +
            '@media(max-width:575px){.payment-citizenship__dropdown{max-height:240px}.payment-citizenship__option{padding:11px 12px}}';

        document.head.appendChild(style);
    }

    function normalizeCitizenshipValue(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .trim();
    }

    function getCitizenshipMatches(value) {
        const query = normalizeCitizenshipValue(value);

        if (!query) return CITIZENSHIP_OPTIONS;

        return CITIZENSHIP_OPTIONS.filter(function (option) {
            return normalizeCitizenshipValue(option).indexOf(query) !== -1;
        });
    }

    function renderCitizenshipOptions(widget) {
        const input = qs('.js-payment-citizenship-input', widget);
        const dropdown = qs('.payment-citizenship__dropdown', widget);
        if (!input || !dropdown) return;

        const matches = getCitizenshipMatches(input.value);

        if (!matches.length) {
            dropdown.innerHTML = '<div class="payment-citizenship__empty">Ничего не найдено</div>';
            return;
        }

        dropdown.innerHTML = matches.map(function (option) {
            return '<button type="button" class="payment-citizenship__option">' + escapeHtml(option) + '</button>';
        }).join('');
    }

    function openCitizenshipDropdown(widget) {
        const dropdown = qs('.payment-citizenship__dropdown', widget);
        const toggle = qs('.payment-citizenship__toggle', widget);
        if (!dropdown) return;

        renderCitizenshipOptions(widget);
        widget.classList.add('is-open');
        dropdown.hidden = false;
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    function closeCitizenshipDropdown(widget) {
        const dropdown = qs('.payment-citizenship__dropdown', widget);
        const toggle = qs('.payment-citizenship__toggle', widget);
        if (!dropdown) return;

        widget.classList.remove('is-open');
        dropdown.hidden = true;
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function selectCitizenshipOption(widget, optionNode) {
        const input = qs('.js-payment-citizenship-input', widget);
        if (!input || !optionNode) return;

        input.value = optionNode.textContent.trim();
        closeCitizenshipDropdown(widget);
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setActiveCitizenshipOption(widget, nextIndex) {
        const options = qsa('.payment-citizenship__option', widget);
        if (!options.length) return;

        const safeIndex = (nextIndex + options.length) % options.length;

        options.forEach(function (option, index) {
            option.classList.toggle('is-active', index === safeIndex);
        });

        options[safeIndex].scrollIntoView({ block: 'nearest' });
    }

    function initCitizenshipAutocomplete(form) {
        ensureCitizenshipStyles();

        qsa('.js-payment-citizenship', form).forEach(function (widget) {
            if (widget.__citizenshipAutocompleteBound) return;
            widget.__citizenshipAutocompleteBound = true;

            const input = qs('.js-payment-citizenship-input', widget);
            const dropdown = qs('.payment-citizenship__dropdown', widget);
            const toggle = qs('.payment-citizenship__toggle', widget);

            if (!input || !dropdown) return;

            input.addEventListener('focus', function () {
                openCitizenshipDropdown(widget);
            });

            input.addEventListener('input', function () {
                openCitizenshipDropdown(widget);
            });

            input.addEventListener('keydown', function (event) {
                const options = qsa('.payment-citizenship__option', widget);
                const activeIndex = options.findIndex(function (option) {
                    return option.classList.contains('is-active');
                });

                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    if (dropdown.hidden) openCitizenshipDropdown(widget);
                    setActiveCitizenshipOption(widget, activeIndex + 1);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (dropdown.hidden) openCitizenshipDropdown(widget);
                    setActiveCitizenshipOption(widget, activeIndex - 1);
                } else if (event.key === 'Enter' && activeIndex > -1) {
                    event.preventDefault();
                    selectCitizenshipOption(widget, options[activeIndex]);
                } else if (event.key === 'Escape') {
                    closeCitizenshipDropdown(widget);
                }
            });

            dropdown.addEventListener('mousedown', function (event) {
                event.preventDefault();
            });

            dropdown.addEventListener('click', function (event) {
                const option = event.target.closest('.payment-citizenship__option');
                if (option) selectCitizenshipOption(widget, option);
            });

            if (toggle) {
                toggle.addEventListener('click', function (event) {
                    event.preventDefault();
                    if (dropdown.hidden) {
                        input.focus();
                        openCitizenshipDropdown(widget);
                    } else {
                        closeCitizenshipDropdown(widget);
                    }
                });
            }

            document.addEventListener('click', function (event) {
                if (!widget.contains(event.target)) closeCitizenshipDropdown(widget);
            });
        });
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
    }

    function showError(message) {
        hideSkeleton();
        stopTimers();

        const wrap = qs('.payment-wrap');
        if (!wrap) return;

        wrap.innerHTML = '' +
            '<div class="payment-wrap-item">' +
                '<p class="payment-info-title">Ошибка</p>' +
                '<p class="payment-item__info">' + escapeHtml(message || 'Не удалось инициализировать оплату.') + '</p>' +
            '</div>';
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

    function renderGuestItem(number, isFirst) {
        let html = '' +
            '<div class="payment-form__item">' +
                '<p class="payment-form__item-title">Гость ' + number + '</p>' +
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
                '</label>' +
                '<div class="payment-form__label payment-citizenship js-payment-citizenship">' +
                    '<span class="payment-form__label-title">Гражданство</span>' +
                    '<span class="payment-citizenship__field">' +
                        '<input type="text" name="residency" class="payment-form__input js-payment-required js-payment-citizenship-input" placeholder="Гражданство" autocomplete="off" required>' +
                        '<button type="button" class="payment-citizenship__toggle" aria-label="Показать варианты гражданства" aria-expanded="false"></button>' +
                    '</span>' +
                    '<span class="payment-citizenship__dropdown" hidden></span>' +
                '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderGuestForm(booking) {
        const form = qs('.js-payment-form');
        if (!form) return;

        const guestCount = getGuestCount(booking);
        let html = '';

        for (let i = 1; i <= guestCount; i += 1) {
            html += renderGuestItem(i, i === 1);
        }

        form.innerHTML = html;
        form.style.display = '';

        if (typeof window.jQuery !== 'undefined' && typeof window.jQuery.fn.mask === 'function') {
            window.jQuery('.input-mask', form).mask('+7 (999) 999-99-99');
        }

        initCitizenshipAutocomplete(form);
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
            const residency = qs('input[name="residency"]', item);
            const guest = {
                first_name: cleanName(firstName ? firstName.value : ''),
                last_name: cleanName(lastName ? lastName.value : '')
            };

            if (residency && residency.value.trim()) {
                guest.residency = residency.value.trim();
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

        if (reserveText) reserveText.textContent = 'Заказ оплачен и отправлен на бронирование';
        if (paymentTime) paymentTime.style.display = 'none';
        if (paymentRemove) paymentRemove.style.display = 'none';
        if (paymentPay) paymentPay.style.display = 'none';
    }

async function submitFinishAfterPaid(paymentState) {
    // console.log('=== PAYMENT STATE FOR FINISH ===');
    // console.log(paymentState);

    const source = paymentState && paymentState.finish_payload
        ? paymentState.finish_payload
        : paymentState;

    const finalPayload = {
        internal_order_id: String(source && source.internal_order_id ? source.internal_order_id : ''),
        access_token: getOrderAccessToken(source || paymentState),
        guests: Array.isArray(source && source.guests)
            ? source.guests.map(function (guest) {
                const guestPayload = {
                    first_name: guest.first_name || '',
                    last_name: guest.last_name || ''
                };

                if (guest.residency) {
                    guestPayload.residency = guest.residency;
                }

                return guestPayload;
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

    // console.log('=== FINAL FINISH PAYLOAD ===');
    // console.log(finalPayload);

    if (
        !finalPayload.internal_order_id ||
        !finalPayload.access_token ||
        !finalPayload.guests.length ||
        !finalPayload.contact_data.email ||
        !finalPayload.contact_data.phone
    ) {
        console.error('FINISH payload invalid:', finalPayload);

        const reserveText = qs('.payment-reserve p');
        if (reserveText) {
            reserveText.textContent = 'Оплата принята, но данные для бронирования не собраны.';
        }

        return;
    }

    try {
        const result = await Api.finishBooking(finalPayload);

        // console.log('=== FINISH RESULT ===');
        // console.log(result);

        // ВСТАВИТЬ STATUS REQUEST СЮДА

        Core.saveStorage(Core.FINISH_STORAGE_KEY, result);

        const reserveText = qs('.payment-reserve p');
        if (reserveText) {
            reserveText.textContent = 'Успех, номер забронирован!';
        }
    } catch (error) {
        console.error('[finish booking]', error);
        console.error('ERROR STATUS:', error.status);
        console.error('ERROR RESPONSE:', error.response);
        console.error('FAILED FINISH PAYLOAD:', finalPayload);

        const reserveText = qs('.payment-reserve p');
        if (reserveText) {
            reserveText.textContent = 'Оплата принята, но бронирование не завершилось. Ошибка finish.';
        }
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
        if (reserveText) reserveText.textContent = 'Заказ оплачен, отправляем данные...';
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

        pollingTimer = setInterval(async function () {
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
        }, 5000);
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
        if (addressNode) addressNode.textContent = address || 'Адрес оплаты не получен';
        renderPaymentQr(address);
        if (priceValue) priceValue.textContent = formatPrice(payment.amount);

        if (payBtn) {
            payBtn.classList.remove('disabled');
            payBtn.dataset.paymentReady = 'true';
            payBtn.textContent = 'Оплата через ' + (payment.currency || 'USDT') + ' ' + (payment.network || 'TRC-20');
            payBtn.setAttribute('data-address', address);
        }
        renderPaymentInfo(booking);
    }

    async function startPrebookAfterFormFilled(payBtn) {
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
        payBtn.textContent = 'Создаём оплату...';

        try {
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
                finish_payload: {
                    internal_order_id: prebookData.internal_order_id,
                    access_token: prebookData.access_token,
                    guests: guests,
                    contact_data: {
                        email: contactData.email,
                        phone: contactData.phone,
                        language: 'ru'
                    }
                }
            });

            Core.saveStorage(Core.PAYMENT_STORAGE_KEY, currentPaymentState);
            bindPaymentActions(currentBooking, currentPaymentState);

            renderPaymentAfterPrebook(currentBooking, currentPaymentState);
            startExpireTimer(currentPaymentState);
            startPolling(currentBooking, currentPaymentState);
        } catch (error) {
            payBtn.textContent = 'Оплатить';
            payBtn.classList.remove('disabled');
            alert(error.message || 'Не удалось создать оплату.');
            console.error('[prebook after form]', error);
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

            await startPrebookAfterFormFilled(payBtn);
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
                alert(error.message || 'Не удалось отменить бронирование.');
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

            renderPaymentAfterPrebook(booking, currentPaymentState);
            startExpireTimer(currentPaymentState);
            startPolling(booking, currentPaymentState);
            return;
        }

        const payBtn = qs('.payment-pay');
        if (payBtn) {
            payBtn.classList.add('disabled');
            payBtn.textContent = 'Оплатить';
            payBtn.dataset.paymentReady = 'false';
        }
    }

    document.addEventListener('DOMContentLoaded', initPaymentPage);
})();

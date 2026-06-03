(function () {
    'use strict';

    const STATIC_URL = window.STATIC_URL || '/static/';

    const FILTER_TYPES = ['bed', 'meal', 'cancel', 'payment'];
    const FILTER_LABELS = {
        bed: 'Кровать',
        meal: 'Питание',
        cancel: 'Условия отмены',
        payment: 'Оплата'
    };

    let originalRates = [];
    let currentHotel = null;
    let selectedState = {
        bed: [],
        meal: [],
        cancel: [],
        payment: []
    };
    let isReady = false;

    function qs(selector, root) {
        return (root || document).querySelector(selector);
    }

    function qsa(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getStaticPath(path) {
        return String(STATIC_URL || '/static/').replace(/\/$/, '') + '/' + String(path || '').replace(/^\//, '');
    }

    function normalize(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, '-')
            .replace(/\s+/g, '-');
    }

    function toggleSelected(type, value) {
        if (!selectedState[type]) selectedState[type] = [];

        const index = selectedState[type].indexOf(value);
        if (index === -1) {
            selectedState[type].push(value);
        } else {
            selectedState[type].splice(index, 1);
        }
    }

    function getPaymentType(rate) {
        const paymentTypes = rate && rate.payment_options && Array.isArray(rate.payment_options.payment_types)
            ? rate.payment_options.payment_types
            : [];

        return paymentTypes[0] || {};
    }

    function getAmenities(rate) {
        const result = [];

        ['all_amenities', 'amenities_data', 'room_amenities', 'serp_filters'].forEach(function (key) {
            if (rate && Array.isArray(rate[key])) {
                result.push.apply(result, rate[key]);
            }
        });

        return result;
    }

    function getMealOption(rate) {
        const mealData = rate && rate.meal_data ? rate.meal_data : {};
        const raw = rate && (rate.meal || mealData.value || mealData.has_meal || '');
        const value = normalize(raw);

        if (!value || value === 'nomeal' || value === 'no-meal' || value === 'room-only' || value === 'none') {
            return { value: 'nomeal', title: 'Без питания' };
        }

        const titles = {
            breakfast: 'Завтрак',
            'breakfast-buffet': 'Завтрак «шведский стол»',
            'half-board': 'Полупансион',
            'full-board': 'Полный пансион',
            'all-inclusive': 'Всё включено'
        };

        return {
            value: value,
            title: titles[value] || String(raw || '').replace(/[-_]+/g, ' ')
        };
    }

    function getBedOption(rate) {
        const keys = getAmenities(rate).map(normalize);
        const bedding = rate && rate.rg_ext ? parseInt(rate.rg_ext.bedding, 10) : 0;
        const beddingType = rate && rate.room_data_trans && rate.room_data_trans.bedding_type
            ? rate.room_data_trans.bedding_type
            : '';
        const beddingTypeKey = normalize(beddingType);

        if (
            keys.indexOf('twin-bed') !== -1 ||
            keys.indexOf('twin-beds') !== -1 ||
            bedding === 4 ||
            beddingTypeKey.indexOf('twin') !== -1
        ) {
            return { value: 'twin-beds', title: 'Две односпальные кровати' };
        }

        if (
            keys.indexOf('single-bed') !== -1 ||
            keys.indexOf('single-beds') !== -1 ||
            bedding === 2
        ) {
            return { value: 'single-bed', title: 'Односпальная кровать' };
        }

        if (
            keys.indexOf('king-bed') !== -1 ||
            bedding === 1 ||
            beddingTypeKey.indexOf('king') !== -1
        ) {
            return { value: 'king-bed', title: 'Кровать king-size' };
        }

        if (
            keys.indexOf('queen-bed') !== -1 ||
            beddingTypeKey.indexOf('queen') !== -1
        ) {
            return { value: 'queen-bed', title: 'Кровать queen-size' };
        }

        if (
            keys.indexOf('double-bed') !== -1 ||
            keys.indexOf('full-double-bed') !== -1 ||
            bedding === 3 ||
            beddingTypeKey.indexOf('double') !== -1
        ) {
            return { value: 'double-bed', title: 'Двуспальная кровать' };
        }

        return { value: 'unknown-bed', title: 'Тип кровати уточняется' };
    }

    function getCancelOption(rate) {
        const payment = getPaymentType(rate || {});
        const penalties = payment.cancellation_penalties || rate.cancellation_penalties || rate.cancellation_info || {};

        if (penalties.free_cancellation_before || penalties.free_cancellation) {
            return { value: 'free-cancel', title: 'Бесплатная отмена' };
        }

        if (Array.isArray(penalties.policies) && penalties.policies.length) {
            return { value: 'cancel-conditions', title: 'Условия отмены указаны в тарифе' };
        }

        return { value: 'cancel-unknown', title: 'Условия отмены уточняются' };
    }

    function getPaymentOption(rate) {
        const payment = getPaymentType(rate || {});
        const raw = payment.type || payment.payment_type || rate.payment_type || 'deposit';
        const value = normalize(raw) || 'deposit';

        const titles = {
            deposit: 'Оплата сейчас',
            now: 'Оплата сейчас',
            card: 'Карта',
            cash: 'Наличные',
            hotel: 'Оплата в отеле'
        };

        return {
            value: value,
            title: titles[value] || String(raw || 'Оплата сейчас').replace(/[-_]+/g, ' ')
        };
    }

    function getRateOption(rate, type) {
        if (type === 'bed') return getBedOption(rate || {});
        if (type === 'meal') return getMealOption(rate || {});
        if (type === 'cancel') return getCancelOption(rate || {});
        if (type === 'payment') return getPaymentOption(rate || {});
        return null;
    }

    function uniqueOptions(options) {
        const used = {};

        return options.filter(function (option) {
            if (!option || !option.value || !option.title) return false;
            if (used[option.value]) return false;
            used[option.value] = true;
            return true;
        });
    }

    function getFilterItems() {
        const items = qsa('.room-selection__item');
        const result = {};

        FILTER_TYPES.forEach(function (type, index) {
            if (!items[index]) return;

            result[type] = items[index];
            items[index].setAttribute('data-filter-type', type);

            const activeText = qs('.room-selection__active p', items[index]);
            if (activeText && !items[index].getAttribute('data-default-title')) {
                items[index].setAttribute('data-default-title', FILTER_LABELS[type] || activeText.textContent.trim());
            }
        });

        return result;
    }

    function renderFilter(type, options) {
        const filterItems = getFilterItems();
        const item = filterItems[type];
        const drop = item ? qs('.room-selection__drop', item) : null;

        if (!item || !drop) return;

        drop.innerHTML = options.map(function (option) {
            const active = selectedState[type] && selectedState[type].indexOf(option.value) !== -1;

            return '' +
                '<div class="room-selection__check' + (active ? ' active' : '') + '" data-type="' + escapeHtml(type) + '" data-value="' + escapeHtml(option.value) + '">' +
                    '<div class="room-selection__icon">' +
                        '<img src="' + escapeHtml(getStaticPath('images/icon/check.svg')) + '" alt="">' +
                    '</div>' +
                    '<p class="room-selection__drop-title">' + escapeHtml(option.title) + '</p>' +
                '</div>';
        }).join('');
    }

    function fillFilters(rates) {
        rates = Array.isArray(rates) ? rates : [];

        FILTER_TYPES.forEach(function (type) {
            const options = uniqueOptions(rates.map(function (rate) {
                return getRateOption(rate, type);
            }));

            renderFilter(type, options);
        });

        updateActiveTitles();
        isReady = true;
    }

    function getSelectedFilters() {
        return {
            bed: selectedState.bed.slice(),
            meal: selectedState.meal.slice(),
            cancel: selectedState.cancel.slice(),
            payment: selectedState.payment.slice()
        };
    }

    function rateMatch(rate, filters) {
        return FILTER_TYPES.every(function (type) {
            const selected = filters[type] || [];
            if (!selected.length) return true;

            const option = getRateOption(rate, type);
            return option && selected.indexOf(option.value) !== -1;
        });
    }

    function renderEmptyState() {
        const list = qs('.room-list');
        if (!list) return;

        list.innerHTML = '<p class="room-empty">Нет доступных номеров по выбранным фильтрам.</p>';
    }

    function updateActiveTitles() {
        const filterItems = getFilterItems();

        FILTER_TYPES.forEach(function (type) {
            const item = filterItems[type];
            const title = item ? qs('.room-selection__active p', item) : null;
            const selected = selectedState[type] || [];
            const defaultTitle = item ? item.getAttribute('data-default-title') : FILTER_LABELS[type];

            if (!title) return;

            if (!selected.length) {
                title.textContent = defaultTitle || FILTER_LABELS[type] || '';
                return;
            }

            const labels = selected.map(function (value) {
                const node = qs('.room-selection__check[data-type="' + type + '"][data-value="' + value + '"] .room-selection__drop-title');
                return node ? node.textContent.trim() : value;
            }).filter(Boolean);

            if (labels.length === 1) {
                title.textContent = labels[0];
                return;
            }

            title.textContent = labels[0] + ' +' + (labels.length - 1);
        });
    }

    function applyFilters() {
        if (!isReady || !currentHotel) return;

        const filters = getSelectedFilters();
        const filteredRates = originalRates.filter(function (rate) {
            return rateMatch(rate, filters);
        });

        const filteredHotel = Object.assign({}, currentHotel, {
            rates: filteredRates
        });

        if (filteredRates.length) {
            if (typeof window.renderSingleHotelRooms === 'function') {
                window.renderSingleHotelRooms(filteredHotel);
            } else if (typeof window.renderRooms === 'function') {
                window.renderRooms(filteredHotel);
            } else {
                renderEmptyState();
            }
        } else {
            renderEmptyState();
        }

        renderSelectedClasses();
        updateActiveTitles();
    }

    function renderSelectedClasses() {
        qsa('.room-selection__check').forEach(function (check) {
            const type = check.getAttribute('data-type');
            const value = check.getAttribute('data-value');
            const active = selectedState[type] && selectedState[type].indexOf(value) !== -1;

            check.classList.toggle('active', !!active);
        });
    }

    function handleFilterClick(event) {
        const check = event.target.closest('.room-selection__check');
        if (!check || !check.closest('.room-selection__list')) return;

        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();

        const type = check.getAttribute('data-type');
        const value = check.getAttribute('data-value');

        if (!type || !value || !selectedState[type]) return;

        toggleSelected(type, value);
        renderSelectedClasses();
        applyFilters();
    }

    function bindFilterEvents() {
        const list = qs('.room-selection__list');

        if (list && !list.__roomFiltersBound) {
            list.__roomFiltersBound = true;
            list.addEventListener('click', handleFilterClick, true);
        }
    }

    window.initRoomFilters = function (rates, hotel) {
        originalRates = Array.isArray(rates) ? rates.slice() : [];
        currentHotel = hotel || window.__HOTEL_CURRENT_HOTEL__ || null;

        window.__HOTEL_RATES__ = originalRates;
        window.__HOTEL_CURRENT_HOTEL__ = currentHotel;

        bindFilterEvents();
        fillFilters(originalRates);
    };

    document.addEventListener('DOMContentLoaded', bindFilterEvents);
})();

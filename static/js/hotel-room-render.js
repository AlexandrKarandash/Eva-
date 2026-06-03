(function () {
    'use strict';

    const STATIC_URL = window.STATIC_URL || '/static/';

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

    function getUrlParams() {
        return new URLSearchParams(window.location.search || '');
    }

    function loadSearchState() {
        try {
            return JSON.parse(localStorage.getItem('aifory_hotel_search_state')) || {};
        } catch (e) {
            return {};
        }
    }

    function getSearchValue(key, defaultValue) {
        const params = getUrlParams();
        const state = loadSearchState();

        if (params.get(key)) {
            return params.get(key);
        }

        if (state && state[key] != null && state[key] !== '') {
            return state[key];
        }

        return defaultValue || '';
    }

    function getSearchChildren() {
        const params = getUrlParams();
        const urlChildren = params.getAll('children')
            .map(function (value) {
                return String(value || '').trim();
            })
            .filter(Boolean);

        if (urlChildren.length) {
            return urlChildren;
        }

        const state = loadSearchState();
        const children = Array.isArray(state.children) ? state.children : [];

        return children
            .map(function (value) {
                if (value && typeof value === 'object') {
                    return String(value.age || value.label || '').trim();
                }

                return String(value || '').trim();
            })
            .filter(Boolean);
    }

    function parseIsoDate(value) {
        const parts = String(value || '').split('-');
        if (parts.length !== 3) return null;

        const date = new Date(
            parseInt(parts[0], 10),
            parseInt(parts[1], 10) - 1,
            parseInt(parts[2], 10)
        );

        return Number.isNaN(date.getTime()) ? null : date;
    }

    function pluralRu(number, one, few, many) {
        const n = Math.abs(number) % 100;
        const n1 = n % 10;

        if (n > 10 && n < 20) return many;
        if (n1 > 1 && n1 < 5) return few;
        if (n1 === 1) return one;
        return many;
    }

    function getNights() {
        const checkin = parseIsoDate(getSearchValue('checkin'));
        const checkout = parseIsoDate(getSearchValue('checkout'));

        if (!checkin || !checkout) return 1;

        return Math.max(Math.round((checkout.getTime() - checkin.getTime()) / 86400000), 1);
    }

    function getAdults() {
        const adults = parseInt(getSearchValue('adults', '2'), 10);

        return Number.isFinite(adults) && adults > 0 ? adults : 2;
    }

    function getChildrenAges() {
        return getSearchChildren();
    }

    function getGuestsCount() {
        return getAdults() + getChildrenAges().length;
    }

    function getHotelId(hotel) {
        const params = getUrlParams();

        return params.get('id') ||
            params.get('hotel_id') ||
            hotel.hid ||
            hotel.id ||
            '';
    }

    function formatPrice(value) {
        const number = parseFloat(value || 0);

        if (!Number.isFinite(number) || number <= 0) {
            return 'Цена по запросу';
        }

        return number.toLocaleString('ru-RU', {
            maximumFractionDigits: 2
        }) + ' USDT';
    }

    function formatRoomInfoText() {
        const nights = getNights();
        const adults = getAdults();
        const childrenCount = getChildrenAges().length;
        const guests = adults + childrenCount;

        let text = 'На ' + nights + ' ' + pluralRu(nights, 'ночь', 'ночи', 'ночей');
        text += ', для ' + adults + ' ' + pluralRu(adults, 'взрослого', 'взрослых', 'взрослых');

        if (childrenCount > 0) {
            text += ' и ' + childrenCount + ' ' + pluralRu(childrenCount, 'ребёнка', 'детей', 'детей');
        }

        return text + ' (' + guests + ' ' + pluralRu(guests, 'гость', 'гостя', 'гостей') + ')';
    }

    function renderSelectionInfo() {
        const node = qs('.room-selection__info');
        if (!node) return;

        node.textContent = formatRoomInfoText();
    }

    const BED_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.51622 7.03437V6.25961C2.51649 5.9809 2.61334 5.7137 2.78554 5.51662C2.95773 5.31955 3.1912 5.2087 3.43472 5.2084H5.38301C5.62653 5.2087 5.86 5.31955 6.03219 5.51662C6.20439 5.7137 6.30124 5.9809 6.30151 6.25961V7.03437H6.89916C6.98413 7.03436 7.06889 7.04399 7.1522 7.06312V5.57682C7.1518 5.15875 7.0065 4.75794 6.7482 4.46233C6.48989 4.16671 6.13968 4.00045 5.77439 4H3.04328C2.678 4.00047 2.3278 4.16674 2.06951 4.46235C1.81122 4.75796 1.66593 5.15876 1.66553 5.57682V7.06312C1.74884 7.04399 1.8336 7.03436 1.91857 7.03437H2.51622Z" fill="black"></path><path d="M3.43472 5.62888C3.28861 5.62906 3.14853 5.69557 3.04521 5.81382C2.9419 5.93206 2.88378 6.09238 2.88362 6.25961V7.03437H5.93404V6.25961C5.93388 6.09238 5.87577 5.93206 5.77245 5.81382C5.66914 5.69557 5.52905 5.62906 5.38294 5.62888H3.43472ZM1.78583 11.2638H2.73673V12.1546H1.78583V11.2638ZM6.08093 11.2638H7.03183V12.1546H6.08093V11.2638ZM6.8991 7.45485H1.9185C1.67498 7.45516 1.44151 7.56601 1.26931 7.76308C1.09712 7.96016 1.00027 8.22736 1 8.50607V9.7299H7.81493V8.50607C7.81493 8.4868 7.81553 8.46784 7.81619 8.44873C7.80311 8.18037 7.70082 7.92791 7.5303 7.74311C7.35977 7.55831 7.13394 7.45518 6.8991 7.45485ZM1 10.1504H7.81493V10.8433H1V10.1504ZM8.84778 7.06312C8.93109 7.04399 9.01585 7.03436 9.10082 7.03437H9.69848V6.25961C9.69875 5.9809 9.7956 5.7137 9.9678 5.51662C10.14 5.31955 10.3735 5.2087 10.617 5.2084H12.5653C12.8088 5.2087 13.0423 5.31955 13.2144 5.51662C13.3866 5.7137 13.4835 5.9809 13.4838 6.25961V7.03437H14.0814C14.1664 7.03436 14.2512 7.04399 14.3345 7.06312V5.57682C14.3341 5.15876 14.1888 4.75796 13.9305 4.46235C13.6722 4.16674 13.322 4.00047 12.9567 4H10.2255C9.86026 4.00047 9.51006 4.16674 9.25177 4.46235C8.99348 4.75796 8.84819 5.15876 8.84778 5.57682V7.06312Z" fill="black"></path><path d="M10.617 5.62891C10.4709 5.62909 10.3308 5.6956 10.2275 5.81384C10.1242 5.93209 10.0661 6.09241 10.0659 6.25963V7.03439H13.1167V6.25963C13.1165 6.09241 13.0584 5.93209 12.9551 5.81384C12.8518 5.6956 12.7117 5.62909 12.5656 5.62891H10.617ZM8.96838 11.2639H9.91928V12.1547H8.96838V11.2639ZM13.2636 11.2639H14.2144V12.1547H13.2636V11.2639ZM8.18262 10.1504H15.0002V10.8434H8.18262V10.1504ZM14.0817 7.45488H9.10112C8.8576 7.45518 8.62413 7.56603 8.45193 7.76311C8.27974 7.96018 8.18288 8.22739 8.18262 8.50609V9.72993H15.0002V8.50609C14.9999 8.22739 14.9031 7.96018 14.7309 7.76311C14.5587 7.56603 14.3252 7.45518 14.0817 7.45488Z" fill="black"></path></svg>';

    const MEAL_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.18308 2.00012C6.98915 2.00012 6.83236 2.18144 6.83236 2.4053H6.82947V5.64769C6.82947 5.75518 6.79221 5.85827 6.72587 5.93428C6.65954 6.01029 6.56957 6.05299 6.47576 6.05299C6.38195 6.05299 6.29198 6.01029 6.22565 5.93428C6.15932 5.85827 6.12205 5.75518 6.12205 5.64769V2.4053H6.11937C6.11937 2.18144 5.96217 2.00012 5.76845 2.00012C5.57452 2.00012 5.41752 2.18144 5.41752 2.4053H5.41484V5.64769C5.41484 5.75518 5.37757 5.85827 5.31124 5.93428C5.24491 6.01029 5.15494 6.05299 5.06113 6.05299C4.96732 6.05299 4.87735 6.01029 4.81102 5.93428C4.74469 5.85827 4.70742 5.75518 4.70742 5.64769V2.4053C4.70742 2.18144 4.55022 2.00012 4.3567 2.00012C4.16277 2.00012 4.00557 2.18144 4.00557 2.4053H4V6.45781C4 6.95637 4.43654 7.38472 5.06103 7.57241V12.5367C5.06419 12.7493 5.14011 12.9519 5.27241 13.1009C5.40471 13.2499 5.58282 13.3335 5.76834 13.3335C5.95387 13.3335 6.13197 13.2499 6.26427 13.1009C6.39658 12.9519 6.47249 12.7493 6.47566 12.5367V7.57241C7.10014 7.38472 7.53668 6.95637 7.53668 6.45781V2.4053H7.534C7.534 2.18144 7.3768 2.00012 7.18308 2.00012ZM10.8966 2.00012C9.62697 2.00012 8.59792 4.54018 8.59792 7.67359C8.59792 7.94875 8.60576 8.21943 8.62123 8.48419H9.65894V12.5362C9.66211 12.7488 9.73803 12.9514 9.87033 13.1004C10.0026 13.2495 10.1807 13.333 10.3663 13.333C10.5518 13.333 10.7299 13.2495 10.8622 13.1004C10.9945 12.9514 11.0704 12.7488 11.0736 12.5362V2.01667C11.0151 2.00566 10.9559 2.00012 10.8966 2.00012Z" fill="black"/></svg>';

    const AMENITIES_MAP = {
        'non-smoking': {
            title: 'Курение запрещено',
            icon: '<img src="' + getStaticPath('images/room/icon/Conditioiner.svg') + '" alt="">'

        },
        'king-bed': {
            title: '1 двуспальная кровать',
            type: 'bed',
            icon: BED_ICON
        },
        'double-bed': {
            title: '1 двуспальная кровать',
            type: 'bed',
            icon: BED_ICON
        },
        'queen-bed': {
            title: '1 двуспальная кровать',
            type: 'bed',
            icon: BED_ICON
        },
        'twin-bed': {
            title: '2 односпальные кровати',
            type: 'bed',
            icon: BED_ICON
        },
        'single-bed': {
            title: '1 односпальная кровать',
            type: 'bed',
            icon: BED_ICON
        },
        'air-conditioning': {
            title: 'Кондиционер',
            icon: '<img src="' + getStaticPath('images/room/icon/Conditioiner.svg') + '" alt="">'
        },
        'conditioner': {
            title: 'Кондиционер',
            icon: '<img src="' + getStaticPath('images/room/icon/Conditioiner.svg') + '" alt="">'
        },
        'minibar': {
            title: 'Мини-бар',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'mini-bar': {
            title: 'Мини-бар',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'private-bathroom': {
            title: 'Собственная ванная комната',
            icon: '<img src="' + getStaticPath('images/room/icon/Bathroom.svg') + '" alt="">'
        },
        'bathroom': {
            title: 'Собственная ванная комната',
            icon: '<img src="' + getStaticPath('images/room/icon/Bathroom.svg') + '" alt="">'
        },
        'safe': {
            title: 'Сейф',
            icon: '<img src="' + getStaticPath('images/room/icon/Safe.svg') + '" alt="">'
        },
        'desk': {
            title: 'Рабочий стол',
            icon: '<img src="' + getStaticPath('images/room/icon/Desk.svg') + '" alt="">'
        },
        'work-desk': {
            title: 'Рабочий стол',
            icon: '<img src="' + getStaticPath('images/room/icon/Desk.svg') + '" alt="">'
        },
        'pets': {
            title: 'Можно с питомцем',
            icon: '<img src="' + getStaticPath('images/room/icon/Pets.svg') + '" alt="">'
        },
        'pets-allowed': {
            title: 'Можно с питомцем',
            icon: '<img src="' + getStaticPath('images/room/icon/Pets.svg') + '" alt="">'
        },
        'hairdryer': {
            title: 'Фен',
            icon: '<img src="' + getStaticPath('images/room/icon/Hair.svg') + '" alt="">'
        },
        'hair-dryer': {
            title: 'Фен',
            icon: '<img src="' + getStaticPath('images/room/icon/Hair.svg') + '" alt="">'
        },
        'dining-area': {
            title: 'Обеденная зона',
            icon: '<img src="' + getStaticPath('images/room/icon/Desk.svg') + '" alt="">'
        },
        'fridge': {
            title: 'Холодильник',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'refrigerator': {
            title: 'Холодильник',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'heating': {
            title: 'Отопление',
            icon: '<img src="' + getStaticPath('images/room/icon/Conditioiner.svg') + '" alt="">'
        },
        'kitchen': {
            title: 'Кухня',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'kitchen-stuff': {
            title: 'Кухонные принадлежности',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'kitchenware': {
            title: 'Кухонные принадлежности',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'microwave': {
            title: 'Микроволновая печь',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'shower': {
            title: 'Душ',
            icon: '<img src="' + getStaticPath('images/room/icon/Bathroom.svg') + '" alt="">'
        },
        'tea': {
            title: 'Чайник / чайный набор',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'tea-or-coffee': {
            title: 'Чай / кофе',
            icon: '<img src="' + getStaticPath('images/room/icon/Bar.svg') + '" alt="">'
        },
        'telephone': {
            title: 'Телефон',
            icon: '<img src="' + getStaticPath('images/room/icon/Desk.svg') + '" alt="">'
        },
        'phone': {
            title: 'Телефон',
            icon: '<img src="' + getStaticPath('images/room/icon/Desk.svg') + '" alt="">'
        },
        'toiletries': {
            title: 'Туалетные принадлежности',
            icon: '<img src="' + getStaticPath('images/room/icon/Bathroom.svg') + '" alt="">'
        },
        'wardrobe': {
            title: 'Шкаф / гардероб',
            icon: '<img src="' + getStaticPath('images/room/icon/Desk.svg') + '" alt="">'
        },
        'closet': {
            title: 'Шкаф / гардероб',
            icon: '<img src="' + getStaticPath('images/room/icon/Desk.svg') + '" alt="">'
        },
        'full-double-bed': {
            title: '1 двуспальная кровать',
            type: 'bed',
            icon: BED_ICON
        },
        'king-size-bed': {
            title: '1 двуспальная кровать',
            type: 'bed',
            icon: BED_ICON
        },
        'wifi': {
            title: 'Wi-Fi',
            icon: '<img src="' + getStaticPath('images/icon/catalog/Wifi.svg') + '" alt="">'
        },
        'wi-fi': {
            title: 'Wi-Fi',
            icon: '<img src="' + getStaticPath('images/icon/catalog/Wifi.svg') + '" alt="">'
        }
    };

    function normalizeAmenityKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, '-')
            .replace(/\s+/g, '-');
    }

    function getAmenityInfo(value) {
        const raw = String(value || '').trim();
        const key = normalizeAmenityKey(raw);
        const mapped = AMENITIES_MAP[key];

        if (mapped) {
            return mapped;
        }

        if (!raw) {
            return null;
        }

        return {
            title: raw
                .replace(/[-_]+/g, ' ')
                .replace(/^\s+|\s+$/g, ''),
            icon: '<img src="' + getStaticPath('images/services/Star.svg') + '" alt="">'
        };
    }

    function getBedInfo(rate) {
        const amenities = Array.isArray(rate.all_amenities) ? rate.all_amenities : [];
        const keys = amenities.map(normalizeAmenityKey);

        if (keys.some(function (key) { return key === 'twin-bed' || key === 'twin-beds'; })) {
            return {
                title: '2 односпальные кровати',
                type: 'bed',
                icon: BED_ICON
            };
        }

        if (keys.some(function (key) { return key === 'single-bed' || key === 'single-beds'; })) {
            return {
                title: '1 односпальная кровать',
                type: 'bed',
                icon: BED_ICON
            };
        }

        if (keys.some(function (key) { return key === 'king-bed' || key === 'queen-bed' || key === 'double-bed' || key === 'full-double-bed'; })) {
            return {
                title: '1 двуспальная кровать',
                type: 'bed',
                icon: BED_ICON
            };
        }

        for (let i = 0; i < amenities.length; i += 1) {
            const item = getAmenityInfo(amenities[i]);
            if (item && item.type === 'bed') return item;
        }

        return {
            title: 'Кровать уточняется',
            type: 'bed',
            icon: BED_ICON
        };
    }

    function getVisibleAmenities(rate) {
        const amenities = Array.isArray(rate.all_amenities) ? rate.all_amenities : [];
        const used = {};

        return amenities
            .map(getAmenityInfo)
            .filter(function (item) {
                if (!item || !item.title) return false;

                const key = normalizeAmenityKey(item.title);
                if (used[key]) return false;
                used[key] = true;

                return true;
            });
    }

    function renderAmenityItem(item, index) {
        return '' +
            '<div class="room-main__dop-item' + (index >= 6 ? ' hide' : '') + '">' +
                '<p>' + escapeHtml(item.title) + '</p>' +
            '</div>';
    }

    function renderAmenities(rate, roomNode) {
        const dop = qs('.room-main__dop', roomNode);
        const more = qs('.room-main__dop-more', roomNode);
        if (!dop) return;

        const amenities = getVisibleAmenities(rate);
        const hiddenCount = amenities.slice(6).length;

        dop.innerHTML = amenities.map(renderAmenityItem).join('');

        if (more) {
            more.style.display = hiddenCount > 0 ? '' : 'none';
            more.textContent = 'Еще';
        }
    }

    function getMealInfo(meal) {
        const value = String(meal || '').toLowerCase();

        if (!value || value === 'nomeal' || value === 'no-meal' || value === 'room-only') {
            return {
                title: 'Питание не включено',
                active: false
            };
        }

        if (value.indexOf('breakfast') !== -1 || value.indexOf('завтрак') !== -1) {
            return {
                title: 'Завтрак включён',
                active: true
            };
        }

        return {
            title: meal,
            active: true
        };
    }

    function buildPaymentUrl(rate, hotel) {
        const params = new URLSearchParams(window.location.search);
        const url = new URL('/payment.html', window.location.origin);

        const hotelId = hotel && (hotel.hid || hotel.id || hotel.hotel_id || '');
        const bookHash = rate && (rate.book_hash || rate.match_hash || '');

        url.searchParams.set('book_hash', bookHash);
        url.searchParams.set('hotel_id', hotelId);

        const checkin = getSearchValue('checkin');
        const checkout = getSearchValue('checkout');
        const adults = getSearchValue('adults', '2');

        if (checkin) {
            url.searchParams.set('checkin', checkin);
        }

        if (checkout) {
            url.searchParams.set('checkout', checkout);
        }

        if (adults) {
            url.searchParams.set('adults', adults);
        }

        getChildrenAges().forEach(function (age) {
            url.searchParams.append('children', age);
        });

        return url.pathname.replace(/^\//, '') + '?' + url.searchParams.toString();
    }

    function updateConditionItem(item, icon, title, active) {
        if (!item) return;

        item.classList.toggle('active', !!active);

        const iconNode = qs('.room-conditions__icon', item);
        const titleNode = qs('.room-conditions__title', item);

        if (iconNode) iconNode.innerHTML = icon;
        if (titleNode) titleNode.textContent = title;
    }

    function renderRateSlide(rate, templateSlide, hotel) {
        const slide = templateSlide.cloneNode(true);
        const conditionItems = qsa('.room-conditions__item', slide);
        const bed = getBedInfo(rate);
        const meal = getMealInfo(rate.meal);
        const nights = getNights();
        const guests = getGuestsCount();
        const priceTitle = qs('.room-price__title', slide);
        const pricePerson = qs('.room-price__person', slide);
        const priceTag = qs('.room-price__tag', slide);
        const priceTax = qs('.room-price__nalog', slide);
        const add = qs('.room-price__add', slide);

        updateConditionItem(conditionItems[0], bed.icon, bed.title, false);
        updateConditionItem(conditionItems[1], MEAL_ICON, meal.title, meal.active);

        if (conditionItems[2]) conditionItems[2].style.display = 'none';
        updateConditionItem(conditionItems[3], conditionItems[3] ? qs('.room-conditions__icon', conditionItems[3]).innerHTML : '', 'Оплата сейчас', false);

        if (priceTag) priceTag.style.display = 'none';
        if (priceTax) priceTax.style.display = 'none';

        if (priceTitle) {
            priceTitle.textContent = formatPrice(rate.price);
        }

        if (pricePerson) {
            pricePerson.textContent =
                'за ' + nights + ' ' + pluralRu(nights, 'ночь', 'ночи', 'ночей') +
                ' для ' + guests + ' ' + pluralRu(guests, 'гостя', 'гостей', 'гостей');
        }

        if (add) {
            add.href = buildPaymentUrl(rate, hotel);
            add.setAttribute('data-book-hash', rate.book_hash || rate.match_hash || '');
            add.setAttribute('data-hotel-id', getHotelId(hotel));
            add.setAttribute('data-adults', String(getAdults()));
            add.setAttribute('data-children', String(getChildrenAges().length));
        }

        return slide;
    }

    function getRoomName(rate) {
        return String(rate.room_name || rate.name || 'Номер').trim();
    }

    function getRoomGroupKey(rate) {
        return getRoomName(rate)
            .replace(/\s*\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim() || 'Номер';
    }

    function groupRatesByRoom(rates) {
        return rates.map(function (rate, index) {
            const title = getRoomGroupKey(rate) || getRoomName(rate) || 'Номер';

            return {
                title: title,
                rates: [rate],
                index: index
            };
        });
    }

    function destroyRoomSwiper(roomNode) {
        const roomGrid = qs('.room-grid', roomNode);
        if (roomGrid && roomGrid.swiper && typeof roomGrid.swiper.destroy === 'function') {
            roomGrid.swiper.destroy(true, true);
        }
    }

    function initRoomSwiper(roomNode) {
        if (typeof Swiper === 'undefined') return;

        const roomGrid = qs('.room-grid', roomNode);
        if (!roomGrid || roomGrid.swiper) return;

        new Swiper(roomGrid, {
            slidesPerView: 3,
            spaceBetween: 14,
            speed: 450,
            watchOverflow: true,
            breakpoints: {
                0: {
                    slidesPerView: 1.08,
                    spaceBetween: 12
                },
                768: {
                    slidesPerView: 2,
                    spaceBetween: 14
                },
                1200: {
                    slidesPerView: 3,
                    spaceBetween: 14
                }
            }
        });
    }

    function renderRoomGroup(group, templateRoom, templateSlide, hotel) {
        const roomNode = templateRoom.cloneNode(true);
        const title = qs('.room-main__title', roomNode);
        const wrapper = qs('.room-grid .swiper-wrapper', roomNode);
        const firstRate = group.rates[0];
        const photo = qs('.room-main__photo', roomNode);
        const photoImg = qs('.room-main__preview', roomNode) || qs('.room-main__photo img', roomNode);
        const square = qs('.room-main__square', roomNode);
        const person = qs('.room-main__person', roomNode);

        destroyRoomSwiper(roomNode);

        if (photo) photo.style.display = '';
        if (photoImg) photoImg.src = getStaticPath('img/defualt.png');
        if (square) square.style.display = 'none';
        if (person) person.style.display = 'none';

        if (title) {
            title.textContent = group.title || 'Номер';
        }

        renderAmenities(firstRate, roomNode);

        if (wrapper) {
            wrapper.innerHTML = '';
            group.rates.forEach(function (rate) {
                wrapper.appendChild(renderRateSlide(rate, templateSlide, hotel));
            });
        }

        return roomNode;
    }

    function bindDopMore() {
        document.addEventListener('click', function (event) {
            const btn = event.target.closest('.room-main__dop-more');
            if (!btn) return;

            const roomMain = btn.closest('.room-main');
            const dop = roomMain ? qs('.room-main__dop', roomMain) : null;
            if (!dop) return;

            event.preventDefault();

            qsa('.room-main__dop-item.hide', dop).forEach(function (item) {
                item.classList.remove('hide');
            });

            btn.style.display = 'none';
        });
    }

    function renderRooms(hotel) {
        const list = qs('.room-list');
        if (!list || !hotel || !Array.isArray(hotel.rates)) {
            renderSelectionInfo();
            return;
        }

        const rates = hotel.rates.filter(function (rate) {
            return rate && parseFloat(rate.price || 0) > 0;
        });

        if (!rates.length) {
            renderSelectionInfo();
            return;
        }

        const templateRoom = qs('.room-item', list);
        const templateSlide = templateRoom ? qs('.room-grid__item', templateRoom) : null;

        if (!templateRoom || !templateSlide) {
            renderSelectionInfo();
            return;
        }

        renderSelectionInfo();

        const fragment = document.createDocumentFragment();
        const groups = groupRatesByRoom(rates);

        groups.forEach(function (group) {
            fragment.appendChild(renderRoomGroup(group, templateRoom, templateSlide, hotel));
        });

        list.innerHTML = '';
        list.appendChild(fragment);

        qsa('.room-item', list).forEach(initRoomSwiper);
        syncRoomDopMoreButtons(list);
    }

    if (!window.__hotelRoomRenderDopMoreBound) {
        window.__hotelRoomRenderDopMoreBound = true;
        bindDopMore();
    }

    window.renderRooms = renderRooms;
})();
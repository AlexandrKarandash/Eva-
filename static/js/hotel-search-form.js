(function () {
    'use strict';

    window.HotelSearch = window.HotelSearch || {};

    const STORAGE_KEY_DEFAULT = 'aifory_hotel_search_state';

    const monthMap = {
        'янв': '01', 'января': '01',
        'фев': '02', 'февраля': '02',
        'мар': '03', 'марта': '03',
        'апр': '04', 'апреля': '04',
        'мая': '05', 'май': '05',
        'июн': '06', 'июня': '06',
        'июл': '07', 'июля': '07',
        'авг': '08', 'августа': '08',
        'сен': '09', 'сентября': '09',
        'окт': '10', 'октября': '10',
        'ноя': '11', 'ноября': '11',
        'дек': '12', 'декабря': '12'
    };

    const MORPH_CACHE_KEY = 'aifory_region_morph_cache';

    const MORPH_LOCAL_MAP = {
        'Москва': 'Москве',
        'Санкт-Петербург': 'Санкт-Петербурге',
        'Санкт Петербург': 'Санкт-Петербурге',
        'Лос Анджелес': 'Лос-Анджелесе',
        'Лос-Анджелес': 'Лос-Анджелесе',
        'Париж': 'Париже',
        'Дубай': 'Дубае'
    };

    function loadMorphCache() {
        try {
            return JSON.parse(localStorage.getItem(MORPH_CACHE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveMorphCache(cache) {
        localStorage.setItem(MORPH_CACHE_KEY, JSON.stringify(cache));
    }

    async function getRegionMorph(city) {
        const cleanCity = String(city || '').trim();

        if (!cleanCity) {
            return '';
        }

        if (MORPH_LOCAL_MAP[cleanCity]) {
            return MORPH_LOCAL_MAP[cleanCity];
        }

        const cache = loadMorphCache();

        if (cache[cleanCity]) {
            return cache[cleanCity];
        }

        try {
            const response = await fetch(
                'https://ws3.morpher.ru/russian/declension?s=' + encodeURIComponent(cleanCity) + '&format=json'
            );

            const data = await response.json();
            const morph = data && data.П ? data.П : cleanCity;

            cache[cleanCity] = morph;
            saveMorphCache(cache);
            return morph;
        } catch (e) {
            console.error('[morph region error]', e);
            return cleanCity;
        }
    }

    function setRegionTitle(city) {
        const cleanCity = String(city || '').trim();

        qsa('.js-region-title, .catalog-controls__date .filter-section-title').forEach(function (node) {
            node.textContent = cleanCity || 'Регион';
        });
    }

    async function updateRegionMorph(city) {
        const cleanCity = String(city || '').trim();
        const morph = await getRegionMorph(cleanCity);

        qsa('.js-region-morp').forEach(function (node) {
            node.textContent = morph || cleanCity;
        });
    }

    function syncRegionTitles(city) {
        const cleanCity = String(city || '').trim();

        setRegionTitle(cleanCity);
        updateRegionMorph(cleanCity);
    }

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

    function normalizeDate(value) {
        value = String(value || '').trim();
        if (!value) return '';

        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

        const direct = value.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
        if (direct) {
            return direct[3] + '-' + String(direct[2]).padStart(2, '0') + '-' + String(direct[1]).padStart(2, '0');
        }

        const ru = value.toLowerCase().replace(/г\.?/g, '').match(/(\d{1,2})\s+([а-яё.]+)\s+(\d{4})/i);
        if (ru) {
            const month = monthMap[ru[2].replace('.', '')];
            if (month) return ru[3] + '-' + month + '-' + String(ru[1]).padStart(2, '0');
        }

        return '';
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

    function formatDateShort(value) {
        const date = parseIsoDate(value);
        if (!date) return '';

        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short'
        }).replace('.', '');
    }

    function pluralRu(number, one, few, many) {
        const n = Math.abs(number) % 100;
        const n1 = n % 10;

        if (n > 10 && n < 20) return many;
        if (n1 > 1 && n1 < 5) return few;
        if (n1 === 1) return one;
        return many;
    }

    function formatFilterDateInfo(params) {
        const from = formatDateShort(params.get('checkin'));
        const to = formatDateShort(params.get('checkout'));

        return from && to ? from + ' - ' + to : '';
    }

    function formatFilterPeopleInfo(params) {
        const rooms = parseInt(params.get('rooms') || '1', 10) || 1;
        const adults = parseInt(params.get('adults') || '2', 10) || 2;
        const children = params.getAll('children').length;
        const guests = adults + children;

        return rooms + ' ' + pluralRu(rooms, 'номер', 'номера', 'номеров') +
            ' для ' + guests + ' ' + pluralRu(guests, 'гостя', 'гостей', 'гостей');
    }

    function getNights(params) {
        const checkin = parseIsoDate(params.get('checkin'));
        const checkout = parseIsoDate(params.get('checkout'));

        if (!checkin || !checkout) return 1;

        return Math.max(Math.round((checkout.getTime() - checkin.getTime()) / 86400000), 1);
    }

    function getDateFromForm(form, type) {
        const selectors = type === 'from'
            ? ['input[name="checkin"]', 'input[name="date_from"]', 'input[name="from"]']
            : ['input[name="checkout"]', 'input[name="date_to"]', 'input[name="to"]'];

        for (let i = 0; i < selectors.length; i += 1) {
            const input = qs(selectors[i], form);
            const date = normalizeDate(input && input.value);
            if (date) return date;
        }

        const visible = qs('.booking-date__item.' + type + ' .booking-date__title', form) ||
            qs('.filter-date__calendar', form) ||
            qs('[data-date-' + type + ']', form);

        return normalizeDate(visible ? visible.textContent : '');
    }

    function getCityFromForm(form) {
        const checked = form.querySelector('input[name="region"]:checked');
        const input = form.querySelector('input[name="city"]');

        if (!checked || !checked.value) {
            return input ? input.value.trim() : '';
        }

        const sameRegionInput = form.querySelector('input[name="region"][value="' + CSS.escape(checked.value) + '"]');

        if (sameRegionInput) {
            const item = sameRegionInput.closest('.region-drop__item');
            const title = item ? item.querySelector('.region-drop__item-title') : null;

            if (title) {
                return title.textContent.trim();
            }
        }

        return input ? input.value.trim() : '';
    }

    function getResidencyFromForm(form) {
        const checked = qs('input[name="residency"]:checked', form);
        const first = qs('input[name="residency"]', form);
        const value = checked && checked.value ? checked.value : (first && first.value ? first.value : 'ru');

        return String(value || 'ru').trim() || 'ru';
    }

    function parseAge(value) {
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return null;

        const match = raw.match(/\d+/);
        if (!match) return null;

        const age = parseInt(match[0], 10);
        if (Number.isNaN(age) || age < 0 || age > 17) return null;

        return age;
    }

    function getBookingFormNodes(selector) {
        const forms = [];
        const unique = new Set();

        qsa(selector || '.booking-form, .js-date-caralog').forEach(function (form) {
            if (!form || unique.has(form)) return;
            unique.add(form);
            forms.push(form);
        });

        return forms;
    }

    function loadSearchState(storageKey) {
        try {
            return JSON.parse(localStorage.getItem(storageKey || STORAGE_KEY_DEFAULT)) || null;
        } catch (e) {
            return null;
        }
    }

    function saveSearchState(state, storageKey) {
        localStorage.setItem(storageKey || STORAGE_KEY_DEFAULT, JSON.stringify(state));
    }

    function collectRooms(form) {
        const rooms = [];

        qsa('.booking-room .place-item', form).forEach(function (roomNode) {
            const adultsNode = qs('.place-adults__counter', roomNode);
            const adults = parseInt(adultsNode ? adultsNode.textContent : '2', 10) || 2;
            const children = [];

            qsa('.place-kids__item', roomNode).forEach(function (childNode) {
                const title = qs('.place-kids__item-title', childNode);
                const label = String(
                    childNode.getAttribute('data-age') ||
                    childNode.getAttribute('data-child-age') ||
                    childNode.getAttribute('data-value') ||
                    (title ? title.textContent : childNode.textContent) ||
                    ''
                ).trim();

                const age = parseAge(label);

                if (age !== null) {
                    children.push({
                        age: age,
                        label: label || String(age)
                    });
                }
            });

            rooms.push({
                adults: adults,
                children: children
            });
        });

        if (!rooms.length) {
            rooms.push({
                adults: 2,
                children: []
            });
        }

        return rooms;
    }

    function collectSearchState(form) {
        const checkedRegion = qs('input[name="region"]:checked', form) || qs('input[name="region"]', form);
        const flatInput = qs('input[name="flat"]', form);
        const language = (document.documentElement.lang || 'ru').toLowerCase().indexOf('en') === 0 ? 'en' : 'ru';
        const rooms = collectRooms(form);

        let adults = 0;
        const children = [];

        rooms.forEach(function (room) {
            adults += parseInt(room.adults || 0, 10) || 0;

            (room.children || []).forEach(function (child) {
                const age = typeof child === 'object' ? child.age : parseAge(child);
                if (age !== null) children.push(age);
            });
        });

        const regionTitle = getRegionTitleById(checkedRegion && checkedRegion.value, form) || getCityFromForm(form);

        const state = {
            region: checkedRegion && checkedRegion.value ? String(checkedRegion.value) : '',
            city: regionTitle,
            region_title: regionTitle,
            checkin: getDateFromForm(form, 'from'),
            checkout: getDateFromForm(form, 'to'),
            adults: adults || 2,
            rooms_count: rooms.length || 1,
            rooms: rooms,
            children: children,
            language: language,
            residency: getResidencyFromForm(form),
            kind: flatInput && flatInput.checked ? 'apartment' : ''
        };

        return state;
    }

    function searchStateToParams(state) {
        const params = new URLSearchParams();

        state = state || {};

        if (state.region) params.set('region', state.region);
        if (state.city) params.set('city', state.city);
        if (state.checkin) params.set('checkin', state.checkin);
        if (state.checkout) params.set('checkout', state.checkout);

        params.set('adults', String(state.adults || 2));
        params.set('rooms', String(state.rooms_count || (state.rooms ? state.rooms.length : 1) || 1));
        params.set('language', state.language || 'ru');
        params.set('residency', state.residency || 'ru');

        const children = Array.isArray(state.children) ? state.children : [];

        if (children.length) {
            children.forEach(function (age) {
                const parsed = parseAge(age);
                if (parsed !== null) params.append('children', String(parsed));
            });
        } else if (Array.isArray(state.rooms)) {
            state.rooms.forEach(function (room) {
                (room.children || []).forEach(function (child) {
                    const age = typeof child === 'object' ? child.age : parseAge(child);
                    if (age !== null) params.append('children', String(age));
                });
            });
        }

        if (state.kind) params.set('kind', state.kind);

        return params;
    }

    function collectSearchParams(form) {
        return searchStateToParams(collectSearchState(form));
    }

    function validateParams(params) {
        if (!params.get('region')) return 'Выберите направление.';
        if (!params.get('checkin')) return 'Выберите дату заезда.';
        if (!params.get('checkout')) return 'Выберите дату выезда.';
        if (params.get('checkin') >= params.get('checkout')) return 'Дата выезда должна быть позже даты заезда.';
        return '';
    }

    function setFormError(form, message) {
        let error = qs('.booking-form__error', form);
        if (!error) {
            error = document.createElement('p');
            error.className = 'booking-form__error';
            error.style.cssText = 'width:100%;margin:12px 0 0;color:#d93025;font-size:14px;';
            form.appendChild(error);
        }

        error.textContent = message || '';
        error.style.display = message ? 'block' : 'none';
    }

    function closeCatalogPopup(form) {
        if (!form || !form.classList.contains('js-date-caralog')) return;

        form.classList.remove('active');
        form.classList.remove('open');

        document.body.classList.remove('lock');
        document.body.classList.remove('fixed');
        document.documentElement.classList.remove('lock');
    }

    function createKidItem(child) {
        const label = typeof child === 'object'
            ? String(child.label || child.age || '').trim()
            : String(child || '').trim();

        const age = typeof child === 'object'
            ? parseAge(child.age)
            : parseAge(label);

        return '' +
            '<div class="place-kids__item" data-age="' + escapeHtml(label) + '" data-child-age="' + escapeHtml(age !== null ? age : '') + '">' +
                '<p class="place-kids__item-title">' + escapeHtml(label) + '</p>' +
                '<a href="#" class="place-kids__item-remove">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 7 7" fill="none">' +
                        '<path d="M6.08332 6.08332L3.41667 3.41667M3.41667 3.41667L0.75 0.75M3.41667 3.41667L6.08335 0.75M3.41667 3.41667L0.75 6.08335" stroke="#1D1D20" stroke-width="1.5"/>' +
                    '</svg>' +
                '</a>' +
            '</div>';
    }

    function updateRoomsNumbers(booking) {
        qsa('.place-item', booking).forEach(function (item, index) {
            const counter = qs('.place-item__counter', item);
            const remove = qs('.place-remove', item);

            if (counter) counter.textContent = (index + 1) + ' номер';

            if (remove) {
                remove.style.display = index === 0 ? 'none' : '';
            }
        });
    }

    function updateBookingRoomSummary(booking) {
        const rooms = qsa('.place-item', booking);
        const label = qs('.booking-room__active .search-label-title', booking);
        const title = qs('.booking-room__title p', booking);
        const adultsInput = qs('.booking-room__adults-input', booking) || qs('input[name="adults_total"]', booking);
        const kidsInput = qs('.booking-room__kids-input', booking) || qs('input[name="kids_total"]', booking);

        let adults = 0;
        let kids = 0;

        rooms.forEach(function (room) {
            const adultsCounter = qs('.place-adults__counter', room);
            adults += parseInt(adultsCounter ? adultsCounter.textContent : '0', 10) || 0;
            kids += qsa('.place-kids__item', room).length;
        });

        const guests = adults + kids;
        const roomsCount = rooms.length || 1;

        if (label) {
            label.textContent = roomsCount + ' ' + pluralRu(roomsCount, 'номер', 'номера', 'номеров') + ' для';
        }

        if (title) {
            title.textContent = guests + ' ' + pluralRu(guests, 'гость', 'гостя', 'гостей');
        }

        if (adultsInput) adultsInput.value = String(adults || 2);
        if (kidsInput) kidsInput.value = String(kids || 0);
    }

    function updateKidsButtons(booking) {
        qsa('.place-item', booking).forEach(function (room) {
            const btn = qs('.place-kids__add-btn', room);
            const count = qsa('.place-kids__item', room).length;

            if (!btn) return;

            btn.classList.toggle('active', count > 0);
            btn.classList.toggle('disabled', count >= 4);
        });
    }

    function restoreRooms(form, state) {
        const booking = qs('.booking-room', form);
        if (!booking || !Array.isArray(state.rooms) || !state.rooms.length) return;

        const scroll = qs('.place-drop__scroll', booking);
        const firstRoom = qs('.place-item', booking);
        if (!scroll || !firstRoom) return;

        qsa('.place-item', scroll).forEach(function (item, index) {
            if (index > 0) item.remove();
        });

        state.rooms.forEach(function (room, index) {
            let roomNode;

            if (index === 0) {
                roomNode = firstRoom;
            } else {
                roomNode = firstRoom.cloneNode(true);
                scroll.appendChild(roomNode);
            }

            const adultsCounter = qs('.place-adults__counter', roomNode);
            if (adultsCounter) adultsCounter.textContent = String(room.adults || 2);

            qsa('.place-kids__item', roomNode).forEach(function (child) {
                child.remove();
            });

            const addWrap = qs('.place-kids__add', roomNode);
            if (addWrap) {
                (room.children || []).forEach(function (child) {
                    addWrap.insertAdjacentHTML('beforebegin', createKidItem(child));
                });
            }
        });

        updateRoomsNumbers(booking);
        updateKidsButtons(booking);
        updateBookingRoomSummary(booking);
    }

    function getRegionTitleById(regionId, root) {
        if (!regionId) return '';

        const input = (root || document).querySelector(
            'input[name="region"][value="' + CSS.escape(String(regionId)) + '"]'
        );

        if (!input) return '';

        const item = input.closest('.region-drop__item');
        const title = item ? item.querySelector('.region-drop__item-title') : null;

        return title ? title.textContent.trim() : '';
    }
    function restoreRegion(form, state) {
        if (!state.region && !state.city) return;

        const cityInput = qs('input[name="city"]', form);
        let firstMatched = null;

        qsa('.region-drop__item', form).forEach(function (item) {
            const input = qs('input[name="region"]', item);

            item.classList.remove('active');

            if (input) {
                input.checked = false;

                if (!firstMatched && state.region && String(input.value) === String(state.region)) {
                    firstMatched = item;
                }
            }
        });

        if (firstMatched) {
            const input = qs('input[name="region"]', firstMatched);
            const title = qs('.region-drop__item-title', firstMatched);

            firstMatched.classList.add('active');
            if (input) input.checked = true;

            if (cityInput && title) {
                cityInput.value = String(title.textContent || '').trim();
            }

            syncRegionTitles(title ? String(title.textContent || '').trim() : '');

            return;
        }

        if (cityInput && state.city) {
            cityInput.value = state.city;
            syncRegionTitles(state.region_title || state.city);
        }
    }

    function formatDateLongRu(value) {
        const date = parseIsoDate(value);
        if (!date) return '';

        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }).replace('.', '');
    }

    function restoreDates(form, state) {
        if (state.checkin) {
            qsa('input[name="checkin"], input[name="date_from"], input[name="from"]', form).forEach(function (input) {
                input.value = state.checkin;
                input.setAttribute('value', state.checkin);
            });

            qsa('.booking-date__item.from .booking-date__title', form).forEach(function (node) {
                node.textContent = formatDateLongRu(state.checkin);
            });
        }

        if (state.checkout) {
            qsa('input[name="checkout"], input[name="date_to"], input[name="to"]', form).forEach(function (input) {
                input.value = state.checkout;
                input.setAttribute('value', state.checkout);
            });

            qsa('.booking-date__item.to .booking-date__title', form).forEach(function (node) {
                node.textContent = formatDateLongRu(state.checkout);
            });
        }

        if (state.checkin && state.checkout) {
            qsa('.filter-date__calendar').forEach(function (node) {
                node.textContent = formatDateShort(state.checkin) + ' - ' + formatDateShort(state.checkout);
            });
        }
    }

    function restoreResidency(form, state) {
        const value = String((state && state.residency) || 'ru').trim() || 'ru';
        let matched = null;

        qsa('input[name="residency"]', form).forEach(function (input) {
            const item = input.closest('.filter-drop__item');
            const isActive = String(input.value || '') === value;

            input.checked = isActive;
            if (item) item.classList.toggle('active', isActive);
            if (isActive) matched = item || input;
        });

        if (!matched) {
            const first = qs('input[name="residency"]', form);
            if (first) {
                first.checked = true;
                matched = first.closest('.filter-drop__item') || first;
                if (matched.classList) matched.classList.add('active');
            }
        }

        const title = matched && matched.querySelector ? matched.querySelector('p') : null;
        const dropTitle = qs('.booking-residency .js-drop-title', form);

        if (dropTitle && title) {
            dropTitle.textContent = title.textContent.trim();
        }
    }

    function restoreFlat(form, state) {
        const flat = qs('input[name="flat"]', form);
        if (!flat) return;

        flat.checked = state.kind === 'apartment';

        const wrapper = flat.closest('.booking-check');
        if (wrapper) wrapper.classList.toggle('active', flat.checked);
    }

    function restoreFormState(form, storageKey) {
        const state = loadSearchState(storageKey);
        if (!state) return;

        restoreRegion(form, state);
        restoreRooms(form, state);
        restoreResidency(form, state);
        restoreFlat(form, state);
        restoreDates(form, state);
        syncFilterHeaderFromState(state);

        setTimeout(function () {
            restoreDates(form, state);
            syncFilterHeaderFromState(state);
        }, 0);

        setTimeout(function () {
            restoreDates(form, state);
            syncFilterHeaderFromState(state);
        }, 100);
    }

    function syncFilterHeaderFromState(state) {
        if (!state) return;

        const regionTitle = state.region_title || state.city || '';
        syncRegionTitles(regionTitle);
        const datesTitle = state.checkin && state.checkout
            ? formatDateShort(state.checkin) + ' - ' + formatDateShort(state.checkout)
            : '';


        qsa('.filter-date__calendar').forEach(function (node) {
            node.textContent = datesTitle;
        });
    }

    function bindBookingForms(options) {
        options = options || {};

        getBookingFormNodes(options.selector).forEach(function (form) {
            if (form.__hotelSearchFormBound) return;
            form.__hotelSearchFormBound = true;

            restoreFormState(form, options.storageKey || STORAGE_KEY_DEFAULT);

            form.addEventListener('submit', function (event) {
                event.preventDefault();

                const state = collectSearchState(form);
                const params = searchStateToParams(state);
                const validationError = validateParams(params);

                if (validationError) {
                    setFormError(form, validationError);
                    return;
                }

                setFormError(form, '');
                saveSearchState(state, options.storageKey || STORAGE_KEY_DEFAULT);
                syncFilterHeaderFromState(state);

                if (qs('.catalog-list') && typeof options.onCatalogSearch === 'function') {
                    closeCatalogPopup(form);
                    options.onCatalogSearch(params);
                    return;
                }

                if (typeof options.onSearch === 'function') {
                    closeCatalogPopup(form);
                    options.onSearch(params, form, state);
                    return;
                }

                window.location.href = options.catalogUrl;
            });
        });
    }

    window.HotelSearch.utils = {
        qs: qs,
        qsa: qsa,
        escapeHtml: escapeHtml,
        normalizeDate: normalizeDate,
        parseIsoDate: parseIsoDate,
        formatDateShort: formatDateShort,
        pluralRu: pluralRu,
        formatFilterDateInfo: formatFilterDateInfo,
        formatFilterPeopleInfo: formatFilterPeopleInfo,
        getNights: getNights,
        getRegionMorph: getRegionMorph,
        updateRegionMorph: updateRegionMorph,
        syncRegionTitles: syncRegionTitles
    };

    window.HotelSearch.form = {
        collectSearchParams: collectSearchParams,
        collectSearchState: collectSearchState,
        searchStateToParams: searchStateToParams,
        loadSearchState: loadSearchState,
        saveSearchState: saveSearchState,
        restoreFormState: restoreFormState,
        validateParams: validateParams,
        setFormError: setFormError,
        bindBookingForms: bindBookingForms,
        syncFilterHeaderFromState: syncFilterHeaderFromState,
        syncRegionTitles: syncRegionTitles
    };
})();
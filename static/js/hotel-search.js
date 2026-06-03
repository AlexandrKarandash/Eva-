(function () {
    'use strict';

    window.HotelSearch = window.HotelSearch || {};

    const utils = window.HotelSearch.utils;
    const form = window.HotelSearch.form;
    const catalogRender = window.HotelSearch.catalogRender;

    if (!utils || !form || !catalogRender) return;

    const qs = utils.qs;
    const qsa = utils.qsa;
    const escapeHtml = utils.escapeHtml;
    const getNights = utils.getNights;

    const HOTEL_SEARCH_API = window.HOTEL_SEARCH_API || '/api/hotels/search/';
    const HOTEL_CATALOG_URL = window.HOTEL_CATALOG_URL || getDefaultCatalogUrl();
    const STORAGE_KEY = 'aifory_hotel_search_state';
    const PAGE_SIZE = 20;

    let currentParams = null;
    let currentPage = 0;
    let totalPages = 1;
    let totalHotels = 0;
    let allHotels = [];
    let filteredHotels = [];
    let renderedOffset = 0;
    let loadedIds = new Set();
    let isLoading = false;
    let isRenderingMore = false;
    let lastRequestId = 0;
    let scrollObserver = null;
    let scrollSentinel = null;
    let remainingLoadPromise = null;
    let currentSort = '';
    let originalIndex = 0;
    let isPriceRangeReady = false;
    let isPriceRangeUpdating = false;

    const filterState = {
        types: new Set(),
        stars: new Set(),
        title: '',
        priceFrom: null,
        priceTo: null,
        priceMin: 0,
        priceMax: 0,
        distanceTo: null,
        distanceMax: 30,
        hotelAmenities: new Set(),
        roomAmenities: new Set(),
        featureAmenities: new Set(),
        metro: new Set(),
        attractions: new Set()
    };

    function getDefaultCatalogUrl() {
        const path = window.location.pathname || '';
        return path.indexOf('.html') !== -1 ? path.replace(/[^/]*$/, 'catalog.html') : '/catalog/';
    }

    function getPageParams() {
        const current = new URLSearchParams(window.location.search);
        if (current.get('region') && current.get('checkin') && current.get('checkout')) return current;

        if (form && typeof form.loadSearchState === 'function' && typeof form.searchStateToParams === 'function') {
            const state = form.loadSearchState(STORAGE_KEY);
            if (state) return form.searchStateToParams(state);
        }

        return current;
    }

    function cloneParams(params) {
        return new URLSearchParams(params ? params.toString() : '');
    }

    function buildSearchUrl(params, page) {
        const url = new URL(HOTEL_SEARCH_API, window.location.origin);

        params.forEach(function (value, key) {
            if (key === 'city' || key === 'rooms' || key === 'page' || key === 'sort') return;
            if (value !== '') url.searchParams.append(key, value);
        });

        url.searchParams.set('page', String(page || 1));
        return url.toString();
    }

    function removeScrollSentinel() {
        if (scrollObserver) {
            scrollObserver.disconnect();
            scrollObserver = null;
        }

        if (scrollSentinel && scrollSentinel.parentNode) {
            scrollSentinel.parentNode.removeChild(scrollSentinel);
        }

        scrollSentinel = null;
        window.removeEventListener('scroll', fallbackScrollHandler);
    }

    function getHotelKey(hotel) {
        if (!hotel) return '';
        return String(hotel.id || hotel.hid || hotel.name || '').trim();
    }

    function addHotelsToStore(hotels) {
        const added = [];

        hotels.forEach(function (hotel) {
            const key = getHotelKey(hotel);
            if (key && loadedIds.has(key)) return;
            if (key) loadedIds.add(key);

            hotel.__hotelSearchOriginalIndex = originalIndex;
            originalIndex += 1;

            allHotels.push(hotel);
            added.push(hotel);
        });

        return added;
    }

    function normalizeKindValue(hotel) {
        const value = String(hotel && hotel.kind || '').toLowerCase();

        if (value.indexOf('apart') !== -1 || value.indexOf('апарт') !== -1) return 'apartment';
        if (value.indexOf('hostel') !== -1 || value.indexOf('хостел') !== -1) return 'hostel';
        if (value.indexOf('hotel') !== -1 || value.indexOf('отель') !== -1) return 'hotel';

        return value || '';
    }

    function setPriceFilterLoading(isLoading) {
        const skeleton = document.querySelector('.filter-price-skeleton');
        const priceBlock = document.querySelector('.filter-item.js-hide-price');
        const range = document.querySelector('.filter-price__range');

        if (skeleton) skeleton.classList.toggle('active', isLoading);

        if (priceBlock && !priceBlock.classList.contains('is-empty')) {
            priceBlock.style.display = isLoading ? 'none' : '';
        }

        if (range) range.style.display = isLoading ? 'none' : '';
    }

    function setPriceFilterEmpty(isEmpty) {
        const priceBlock = document.querySelector('.filter-item.js-hide-price');
        const from = document.querySelector('.js-price-from');
        const to = document.querySelector('.js-price-to');

        if (priceBlock) {
            priceBlock.classList.toggle('is-empty', isEmpty);
            priceBlock.style.display = isEmpty ? 'none' : '';
        }

        if (from) from.value = '';
        if (to) to.value = '';
    }

    function getHotelStars(hotel) {
        const stars = parseInt(hotel && hotel.stars, 10);
        return Number.isFinite(stars) ? Math.max(0, Math.min(stars, 5)) : 0;
    }

    function getHotelTitle(hotel) {
        return String(hotel && hotel.name || '').trim().toLowerCase();
    }

    function getHotelPriceNight(hotel) {
        const minPrice = hotel && (hotel.min_price || (hotel.rates && hotel.rates[0] ? hotel.rates[0].price : 0));
        const price = parseFloat(minPrice || 0);
        const nights = currentParams ? getNights(currentParams) : 1;

        if (!Number.isFinite(price) || price <= 0) return 0;
        return price / Math.max(nights, 1);
    }

    function getHotelSortPrice(hotel) {
        const price = getHotelPriceNight(hotel);
        return price > 0 ? price : Number.MAX_SAFE_INTEGER;
    }


    const AMENITY_FILTERS_HOTEL = [
        { value: 'wifi', title: 'Бесплатный Wi-Fi', keys: ['wi-fi', 'wifi', 'интернет', 'вайфай', 'вай-фай'] },
        { value: 'parking', title: 'Парковка', keys: ['парков', 'parking'] },
        { value: 'breakfast', title: 'Завтрак / питание', keys: ['завтрак', 'питание', 'ресторан', 'бар', 'кафе', 'breakfast', 'restaurant', 'meal', 'lunch', 'dinner'] },
        { value: 'pool', title: 'Бассейн', keys: ['бассейн', 'pool', 'swimming'] },
        { value: 'children', title: 'Для детей', keys: ['дет', 'ребен', 'ребён', 'семейн', 'children', 'kids', 'family'] },
        { value: 'pets', title: 'Можно с животными', keys: ['животн', 'питомц', 'pets', 'pet', 'dog', 'cat'] },
        { value: 'transfer', title: 'Трансфер / аэропорт', keys: ['трансфер', 'аэропорт', 'airport', 'transfer', 'shuttle'] },
        { value: 'accessible', title: 'Доступная среда', keys: ['ограниченными физическими', 'инвалид', 'пандус', 'disabled', 'wheelchair', 'accessible'] },
        { value: 'spa', title: 'SPA / красота', keys: ['spa', 'спа', 'сауна', 'массаж', 'beauty', 'massage'] },
        { value: 'business', title: 'Бизнес-услуги', keys: ['бизнес', 'факс', 'ксерокс', 'business', 'conference'] },
        { value: 'frontdesk', title: 'Круглосуточная стойка', keys: ['круглосуточ', 'стойка регистрации', 'ресепшн', '24-hour', 'reception', 'front desk'] },
        { value: 'cleaning', title: 'Прачечная / уборка', keys: ['прачеч', 'уборк', 'химчист', 'cleaning', 'laundry', 'housekeeping'] }
    ];

    const AMENITY_FILTERS_ROOM = [
        { value: 'wifi', title: 'Wi-Fi в номере', keys: ['wi-fi', 'wifi', 'интернет'] },
        { value: 'air_conditioning', title: 'Кондиционер', keys: ['кондиционер', 'air-conditioning', 'air conditioning'] },
        { value: 'private_bathroom', title: 'Собственная ванная', keys: ['private-bathroom', 'has_bathroom', 'ванн', 'душ', 'bathroom', 'shower'] },
        { value: 'kitchen', title: 'Кухня', keys: ['кухня', 'kitchen', 'kitchen-stuff'] },
        { value: 'fridge', title: 'Холодильник', keys: ['холодильник', 'fridge', 'refrigerator'] },
        { value: 'tv', title: 'Телевизор', keys: ['телевизор', 'tv', 'cable'] },
        { value: 'desk', title: 'Рабочий стол', keys: ['desk', 'письменный стол', 'рабоч'] },
        { value: 'safe', title: 'Сейф', keys: ['safe', 'сейф'] },
        { value: 'hairdryer', title: 'Фен', keys: ['hairdryer', 'фен'] },
        { value: 'washing', title: 'Стиральная машина', keys: ['стиральная машина', 'washing'] },
        { value: 'bed', title: 'Большая кровать', keys: ['king-bed', 'queen-bed', 'double-bed', 'кровать'] },
        { value: 'non_smoking', title: 'Для некурящих', keys: ['non-smoking', 'некурящ', 'курение запрещено'] }
    ];

    const FEATURE_FILTERS = [
        { value: 'pets', title: 'Можно с питомцем', keys: ['животн', 'питомц', 'pets', 'pet', 'dog', 'cat', 'размещение с домашними животными'] },
        { value: 'children', title: 'Подходит для детей', keys: ['дет', 'ребен', 'ребён', 'семейн', 'children', 'kids', 'family', 'размещение подходит для семей'] },
        { value: 'smoking', title: 'Можно курить', keys: ['smoking', 'курение разрешено', 'для курящих', 'smoking room'] },
        { value: 'accessible', title: 'Для людей с ограниченными возможностями', keys: ['ограниченными физическими', 'инвалид', 'пандус', 'disabled', 'wheelchair', 'accessible', 'доступная среда'] },
        { value: 'massage', title: 'Массажный кабинет', keys: ['массаж', 'massage'] },
        { value: 'non_smoking', title: 'Для некурящих', keys: ['non-smoking', 'некурящ', 'курение запрещено', 'отель для некурящих'] },
        { value: 'transfer', title: 'Трансфер', keys: ['трансфер', 'transfer', 'shuttle'] },
        { value: 'parking', title: 'Парковка', keys: ['парков', 'parking'] },
        { value: 'business', title: 'Бизнес-центр', keys: ['бизнес-центр', 'business center', 'факс', 'ксерокс'] },
        { value: 'spa', title: 'SPA / сауна', keys: ['spa', 'спа', 'сауна', 'баня'] }
    ];

    function flattenAmenityValues(value, result) {
        result = result || [];
        if (value == null) return result;

        if (Array.isArray(value)) {
            value.forEach(function (item) { flattenAmenityValues(item, result); });
            return result;
        }

        if (typeof value === 'object') {
            Object.keys(value).forEach(function (key) {
                if (key === 'images' || key === 'payment_options' || key === 'cancellation_info') return;
                flattenAmenityValues(value[key], result);
            });
            return result;
        }

        const text = String(value || '').trim();
        if (text) result.push(text);
        return result;
    }

    function getHotelAmenitySourceText(hotel) {
        const values = [];
        [
            hotel && hotel.amenity_groups,
            hotel && hotel.amenities,
            hotel && hotel.amenities_list,
            hotel && hotel.amenities_array,
            hotel && hotel.services,
            hotel && hotel.facilities,
            hotel && hotel.description,
            hotel && hotel.kind
        ].forEach(function (source) { flattenAmenityValues(source, values); });
        return values.join(' ').toLowerCase();
    }

    function getRoomAmenitySourceText(hotel) {
        const values = [];
        if (hotel && Array.isArray(hotel.rates)) {
            hotel.rates.forEach(function (rate) {
                flattenAmenityValues(rate && rate.all_amenities, values);
                flattenAmenityValues(rate && rate.amenities, values);
                flattenAmenityValues(rate && rate.amenities_data, values);
                flattenAmenityValues(rate && rate.serp_filters, values);
                flattenAmenityValues(rate && rate.meal, values);
                flattenAmenityValues(rate && rate.meal_data, values);
                flattenAmenityValues(rate && rate.room_name, values);
                flattenAmenityValues(rate && rate.raw_etg_rate && rate.raw_etg_rate.amenities_data, values);
                flattenAmenityValues(rate && rate.raw_etg_rate && rate.raw_etg_rate.serp_filters, values);
                flattenAmenityValues(rate && rate.raw_etg_rate && rate.raw_etg_rate.meal, values);
                flattenAmenityValues(rate && rate.raw_etg_rate && rate.raw_etg_rate.meal_data, values);
                flattenAmenityValues(rate && rate.raw_etg_rate && rate.raw_etg_rate.room_name, values);
            });
        }
        return values.join(' ').toLowerCase();
    }

    function matchesAmenity(text, config) {
        text = String(text || '').toLowerCase();
        return (config.keys || []).some(function (key) {
            return text.indexOf(String(key || '').toLowerCase()) !== -1;
        });
    }

    function getAmenityFilterList(source) {
        if (source === 'room') return AMENITY_FILTERS_ROOM;
        if (source === 'feature') return FEATURE_FILTERS;
        return AMENITY_FILTERS_HOTEL;
    }

    function getFeatureAmenitySourceText(hotel) {
        return (getHotelAmenitySourceText(hotel) + ' ' + getRoomAmenitySourceText(hotel)).toLowerCase();
    }

    function getAmenitySourceText(hotel, source) {
        if (source === 'room') return getRoomAmenitySourceText(hotel);
        if (source === 'feature') return getFeatureAmenitySourceText(hotel);
        return getHotelAmenitySourceText(hotel);
    }

    function hotelHasAmenity(hotel, value, source) {
        const filters = getAmenityFilterList(source);
        const config = filters.find(function (item) { return item.value === value; });
        if (!config) return false;
        return matchesAmenity(getAmenitySourceText(hotel, source), config);
    }

    function getHotelDistanceKm(hotel) {
        const fields = [
            hotel && hotel.distance_center,
            hotel && hotel.distance_center_calculated,
            hotel && hotel.distance_center_api,
            hotel && hotel.distance_to_center,
            hotel && hotel.center_distance,
            hotel && hotel.distance_from_center
        ];

        for (let i = 0; i < fields.length; i += 1) {
            const value = parseFloat(String(fields[i] == null ? '' : fields[i]).replace(',', '.'));
            if (Number.isFinite(value) && value >= 0) {
                return value < 100 ? value : value / 1000;
            }
        }

        const lat = parseFloat(hotel && hotel.latitude);
        const lng = parseFloat(hotel && hotel.longitude);
        const center = hotel && hotel.city_center;
        const centerLat = center ? parseFloat(center.latitude) : NaN;
        const centerLng = center ? parseFloat(center.longitude) : NaN;

        if ([lat, lng, centerLat, centerLng].some(function (value) { return !Number.isFinite(value); })) return null;

        const earthRadius = 6371;
        const toRad = Math.PI / 180;
        const dLat = (centerLat - lat) * toRad;
        const dLng = (centerLng - lng) * toRad;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat * toRad) * Math.cos(centerLat * toRad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return earthRadius * c;
    }

    function getMapHotelLink(hotel) {
        const params = currentParams ? cloneParams(currentParams) : new URLSearchParams();
        const id = hotel && (hotel.hid || hotel.id || '');
        params.set('id', id);
        params.set('slug', hotel && hotel.id || '');
        return '/single/?' + params.toString();
    }

    function dispatchFilteredHotelsForMap() {
        const mapHotels = filteredHotels.map(function (hotel) {
            return {
                id: String(hotel.id || hotel.hid || ''),
                hid: hotel.hid || '',
                latitude: parseFloat(hotel.latitude),
                longitude: parseFloat(hotel.longitude),
                link: getMapHotelLink(hotel),
                name: hotel.name || ''
            };
        }).filter(function (hotel) {
            return hotel.id && Number.isFinite(hotel.latitude) && Number.isFinite(hotel.longitude);
        });

        document.dispatchEvent(new CustomEvent('hotels:filtered', {
            detail: { hotels: mapHotels, params: currentParams, count: filteredHotels.length }
        }));
    }

    function renderAmenityFilterGroup(rootSelector, configs, source) {
        const root = qs(rootSelector + ' .filter-item__group');
        if (!root) return;

        const available = configs.map(function (config) {
            const count = allHotels.filter(function (hotel) {
                return hotelHasAmenity(hotel, config.value, source);
            }).length;
            return Object.assign({}, config, { count: count });
        }).filter(function (config) { return config.count > 0; });

        if (!available.length) {
            root.innerHTML = '<p class="filter-empty">Нет данных по удобствам</p>';
            return;
        }

        root.innerHTML = available.map(function (config, index) {
            const isHidden = index >= 8;
            const activeSet = source === 'room'
                ? filterState.roomAmenities
                : (source === 'feature' ? filterState.featureAmenities : filterState.hotelAmenities);
            const isActive = activeSet.has(config.value);

            return '' +
                '<div class="filter-check js-checkbox' + (isActive ? ' active' : '') + (isHidden ? ' hide' : '') + '" data-amenity-source="' + source + '" data-amenity="' + escapeHtml(config.value) + '"' + (isHidden ? ' data-hide' : '') + '>' +
                    '<div class="filter-check__icon"><i class="fa-check"></i></div>' +
                    '<div class="filter-check__title"><p>' + escapeHtml(config.title) + '</p></div>' +
                '</div>';
        }).join('') + (available.length > 8 ? '<div class="filter-more" data-title="Показать еще" data-hide="Скрыть"><p>Показать еще</p><i class="fa-arrow-down"></i></div>' : '');
    }

    function refreshAmenityFilters() {
        renderAmenityFilterGroup('#amenity_features', FEATURE_FILTERS, 'feature');
        renderAmenityFilterGroup('#amenity_hotel', AMENITY_FILTERS_HOTEL, 'hotel');
        renderAmenityFilterGroup('#amenity_rates', AMENITY_FILTERS_ROOM, 'room');
    }

    function normalizeNearbyName(value) {
        return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
    }

    function getHotelNearbyList(hotel, type) {
        const nearby = hotel && hotel.nearby_places && typeof hotel.nearby_places === 'object' ? hotel.nearby_places : {};
        let list = [];

        if (type === 'metro') {
            list = Array.isArray(nearby.metro) ? nearby.metro : [];
            if ((!list || !list.length) && hotel && hotel.nearest_metro) {
                list = [hotel.nearest_metro];
            }
        } else if (type === 'attractions') {
            list = Array.isArray(nearby.attractions) ? nearby.attractions : [];
            if ((!list || !list.length) && Array.isArray(hotel && hotel.nearby_attractions)) {
                list = hotel.nearby_attractions;
            }
        }

        return (Array.isArray(list) ? list : [])
            .map(function (place) {
                if (typeof place === 'string') return { name: place, title: place };
                return place || {};
            })
            .filter(function (place) {
                return String(place.name || place.title || '').trim();
            });
    }

    function hotelHasNearby(hotel, value, type) {
        const target = normalizeNearbyName(value);
        if (!target) return false;

        return getHotelNearbyList(hotel, type).some(function (place) {
            return normalizeNearbyName(place.name || place.title) === target;
        });
    }

    function renderNearbyFilterGroup(rootSelector, type) {
        const root = qs(rootSelector + ' .filter-item__group');
        if (!root) return;

        const counts = new Map();
        const titles = new Map();

        allHotels.forEach(function (hotel) {
            const usedInHotel = new Set();

            getHotelNearbyList(hotel, type).forEach(function (place) {
                const title = String(place.name || place.title || '').trim();
                const key = normalizeNearbyName(title);
                if (!key || usedInHotel.has(key)) return;

                usedInHotel.add(key);
                titles.set(key, title);
                counts.set(key, (counts.get(key) || 0) + 1);
            });
        });

        const items = Array.from(counts.keys()).map(function (key) {
            return {
                value: key,
                title: titles.get(key) || key,
                count: counts.get(key) || 0
            };
        }).sort(function (a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return a.title.localeCompare(b.title, 'ru');
        });

        if (!items.length) {
            root.innerHTML = '<p class="filter-empty">Нет данных</p>';
            return;
        }

        const activeSet = type === 'metro' ? filterState.metro : filterState.attractions;

        root.innerHTML = items.map(function (item, index) {
            const isHidden = index >= 5;
            const isActive = activeSet.has(item.value);

            return '' +
                '<div class="filter-check js-checkbox' + (isActive ? ' active' : '') + (isHidden ? ' hide' : '') + '" data-nearby-source="' + type + '" data-nearby="' + escapeHtml(item.value) + '"' + (isHidden ? ' data-hide' : '') + '>' +
                    '<div class="filter-check__icon"><i class="fa-check"></i></div>' +
                    '<div class="filter-check__title"><p>' + escapeHtml(item.title) + '</p></div>' +
                '</div>';
        }).join('') + (items.length > 5 ? '<div class="filter-more" data-title="Показать еще" data-hide="Скрыть"><p>Показать еще</p><i class="fa-arrow-down"></i></div>' : '');
    }

    function refreshNearbyFilters() {
        renderNearbyFilterGroup('#nearby_metro', 'metro');
        renderNearbyFilterGroup('#nearby_attractions', 'attractions');
    }

    function hasActiveFilters() {
        return filterState.types.size > 0 ||
            filterState.stars.size > 0 ||
            filterState.hotelAmenities.size > 0 ||
            filterState.roomAmenities.size > 0 ||
            filterState.featureAmenities.size > 0 ||
            filterState.metro.size > 0 ||
            filterState.attractions.size > 0 ||
            !!filterState.title ||
            filterState.distanceTo !== null ||
            filterState.priceFrom !== null ||
            filterState.priceTo !== null;
    }

    function hotelMatchesFilters(hotel) {
        const kind = normalizeKindValue(hotel);
        const stars = getHotelStars(hotel);
        const price = getHotelPriceNight(hotel);

        if (filterState.types.size && !filterState.types.has(kind)) return false;
        if (filterState.stars.size && !filterState.stars.has(stars)) return false;
        if (filterState.title && getHotelTitle(hotel).indexOf(filterState.title) === -1) return false;
        if (filterState.priceFrom !== null && (!price || price < filterState.priceFrom)) return false;
        if (filterState.priceTo !== null && (!price || price > filterState.priceTo)) return false;

        if (filterState.distanceTo !== null) {
            const distance = getHotelDistanceKm(hotel);
            if (distance === null || distance > filterState.distanceTo) return false;
        }

        if (filterState.hotelAmenities.size) {
            const hotelAmenityValues = Array.from(filterState.hotelAmenities);
            if (!hotelAmenityValues.every(function (value) { return hotelHasAmenity(hotel, value, 'hotel'); })) return false;
        }

        if (filterState.roomAmenities.size) {
            const roomAmenityValues = Array.from(filterState.roomAmenities);
            if (!roomAmenityValues.every(function (value) { return hotelHasAmenity(hotel, value, 'room'); })) return false;
        }

        if (filterState.featureAmenities.size) {
            const featureValues = Array.from(filterState.featureAmenities);
            if (!featureValues.every(function (value) { return hotelHasAmenity(hotel, value, 'feature'); })) return false;
        }

        if (filterState.metro.size) {
            const metroValues = Array.from(filterState.metro);
            if (!metroValues.every(function (value) { return hotelHasNearby(hotel, value, 'metro'); })) return false;
        }

        if (filterState.attractions.size) {
            const attractionValues = Array.from(filterState.attractions);
            if (!attractionValues.every(function (value) { return hotelHasNearby(hotel, value, 'attractions'); })) return false;
        }

        return true;
    }

    function sortHotels(list) {
        if (currentSort === 'price_asc') {
            list.sort(function (a, b) {
                return getHotelSortPrice(a) - getHotelSortPrice(b);
            });
            return;
        }

        if (currentSort === 'price_desc') {
            list.sort(function (a, b) {
                return getHotelSortPrice(b) - getHotelSortPrice(a);
            });
            return;
        }

        if (currentSort === 'center_asc') {
            list.sort(function (a, b) {
                const distanceA = getHotelDistanceKm(a);
                const distanceB = getHotelDistanceKm(b);
                const safeA = distanceA === null ? Number.MAX_SAFE_INTEGER : distanceA;
                const safeB = distanceB === null ? Number.MAX_SAFE_INTEGER : distanceB;

                if (safeA !== safeB) return safeA - safeB;
                return getHotelSortPrice(a) - getHotelSortPrice(b);
            });
            return;
        }

        list.sort(function (a, b) {
            return (a.__hotelSearchOriginalIndex || 0) - (b.__hotelSearchOriginalIndex || 0);
        });
    }

    function rebuildFilteredHotels() {
        filteredHotels = allHotels.filter(hotelMatchesFilters);
        sortHotels(filteredHotels);
        dispatchFilteredHotelsForMap();
    }

    function getTitleCount() {
        if (hasActiveFilters()) return filteredHotels.length;
        return totalHotels || filteredHotels.length || allHotels.length;
    }

    function hasMoreToShow() {
        return renderedOffset < filteredHotels.length || !!remainingLoadPromise;
    }

    function setupInfiniteScroll() {
        const list = qs('.catalog-list');
        if (!list) return;

        removeScrollSentinel();
        if (!hasMoreToShow()) return;

        scrollSentinel = document.createElement('div');
        scrollSentinel.className = 'catalog-scroll-sentinel';
        scrollSentinel.setAttribute('aria-hidden', 'true');
        list.parentNode.insertBefore(scrollSentinel, list.nextSibling);

        if ('IntersectionObserver' in window) {
            scrollObserver = new IntersectionObserver(function (entries) {
                if (entries.some(function (entry) { return entry.isIntersecting; })) {
                    renderNextHotelsChunk(true);
                }
            }, {
                root: null,
                rootMargin: '500px 0px',
                threshold: 0
            });

            scrollObserver.observe(scrollSentinel);
            return;
        }

        window.addEventListener('scroll', fallbackScrollHandler, { passive: true });
    }

    function fallbackScrollHandler() {
        if (!scrollSentinel) return;

        const rect = scrollSentinel.getBoundingClientRect();
        if (rect.top < window.innerHeight + 500) {
            renderNextHotelsChunk(true);
        }
    }

    function appendPageSkeleton(list) {
        const loader = document.createElement('div');
        loader.className = 'catalog-page-loader';
        loader.innerHTML = catalogRender.renderSkeletonCards(2);
        list.appendChild(loader);
        return loader;
    }

    function renderHotelsToList(list, hotels, params, append) {
        const html = hotels.map(function (hotel) {
            return catalogRender.renderHotelCard(hotel, params);
        }).join('');

        if (append) {
            list.insertAdjacentHTML('beforeend', html);
        } else {
            list.innerHTML = html;
        }

        catalogRender.initCatalogSliders(list);
    }

    function updateCatalogTitle(sourceData) {
        catalogRender.setCatalogInfo(Object.assign({}, sourceData || {}, {
            total_hotels: getTitleCount()
        }), currentParams);
    }

    async function fetchHotelsPage(params, page) {
        const response = await fetch(buildSearchUrl(params, page), {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'same-origin'
        });
        const data = await response.json().catch(function () { return null; });
        // console.log('[HOTEL SEARCH RESPONSE]', data);
        if (!response.ok || !data) {
            throw new Error((data && (data.detail || data.message || data.error)) || 'Ошибка загрузки отелей');
        }

        return data;
    }

    function applyFirstMeta(data) {
        currentPage = parseInt(data.current_page || 1, 10) || 1;
        totalPages = parseInt(data.total_pages || 1, 10) || 1;
        totalHotels = parseInt(data.total_hotels || 0, 10) || 0;
    }

    async function loadRemainingPages(requestId) {
        const pagePromises = [];

        for (let page = 2; page <= totalPages; page += 1) {
            pagePromises.push(
                fetchHotelsPage(currentParams, page)
                    .then(function (data) {
                        if (requestId !== lastRequestId || !data) return null;

                        const hotelsRaw = Array.isArray(data.hotels) ? data.hotels : [];
                        addHotelsToStore(hotelsRaw);
                        currentPage = Math.max(currentPage, page);

                        return data;
                    })
                    .catch(function (error) {
                        console.error('[hotel-search page ' + page + ']', error);
                        return null;
                    })
            );
        }

        await Promise.all(pagePromises);
        remainingLoadPromise = null;
        rebuildFilteredHotels();
        refreshPriceRangeBounds(false);
        refreshAmenityFilters();
        refreshNearbyFilters();
        updateCatalogTitle();
        setupInfiniteScroll();
    }

    async function ensureAllPagesLoaded() {
        if (remainingLoadPromise) {
            await remainingLoadPromise;
        }
    }

    async function renderNextHotelsChunk(showLoaderIfWaiting) {
        const list = qs('.catalog-list');
        if (!list || isRenderingMore) return;

        isRenderingMore = true;
        removeScrollSentinel();

        let loader = null;

        try {
            if (renderedOffset >= filteredHotels.length && remainingLoadPromise) {
                if (showLoaderIfWaiting) loader = appendPageSkeleton(list);
                await remainingLoadPromise;
            }

            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);

            const nextHotels = filteredHotels.slice(renderedOffset, renderedOffset + PAGE_SIZE);
            if (!nextHotels.length) {
                if (!renderedOffset) {
                    list.innerHTML = '<div class="catalog-empty">По выбранным фильтрам отели не найдены.</div>';
                }
                return;
            }

            renderHotelsToList(list, nextHotels, currentParams, renderedOffset > 0);
            renderedOffset += nextHotels.length;
            updateCatalogTitle();

            document.dispatchEvent(new CustomEvent('hotels:rendered', {
                detail: { hotels: nextHotels, params: currentParams, page: Math.ceil(renderedOffset / PAGE_SIZE), append: renderedOffset > nextHotels.length }
            }));
        } finally {
            if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
            isRenderingMore = false;
            setupInfiniteScroll();
        }
    }

    async function applyStoreAndRerender(waitAllPages) {
        const list = qs('.catalog-list');
        if (!list || !currentParams) return;

        removeScrollSentinel();

        if (waitAllPages && remainingLoadPromise) {
            list.innerHTML = catalogRender.renderSkeletonCards(4);
            await ensureAllPagesLoaded();
        }

        rebuildFilteredHotels();
        renderedOffset = 0;
        list.innerHTML = '';
        await renderNextHotelsChunk(false);
        updateCatalogTitle();
    }

    async function applySortAndRerender(sortValue) {
        currentSort = sortValue || '';
        await applyStoreAndRerender(true);
    }

    function collectSelectedFilterChecks() {
        filterState.types.clear();
        filterState.stars.clear();

        qsa('.filter-item[data-id="type"] .filter-check.active').forEach(function (node) {
            const value = String(node.getAttribute('data-set') || '').trim();
            if (value) filterState.types.add(value);
        });

        qsa('.filter-item#start .filter-check.active, .filter-item[data-id="stars"] .filter-check.active').forEach(function (node) {
            const title = qs('.filter-check__title', node) || node;
            const text = String(title.textContent || '').toLowerCase();
            const stars = qsa('img', title).length;

            if (text.indexOf('без') !== -1) {
                filterState.stars.add(0);
                filterState.stars.add(1);
                return;
            }

            if (stars) filterState.stars.add(stars);
        });
    }

    function bindCheckFilters() {
        document.addEventListener('click', function (event) {
            const check = event.target.closest('.filter-item .filter-check');
            if (!check) return;

            const item = check.closest('.filter-item');
            if (!item) return;

            const isType = item.getAttribute('data-id') === 'type';
            const isStars = item.id === 'start' || item.getAttribute('data-id') === 'stars';
            if (!isType && !isStars) return;

            event.preventDefault();
            check.classList.toggle('active');
            collectSelectedFilterChecks();
            applyStoreAndRerender(true);
        });
    }

    function bindTitleFilter() {
        const inputs = qsa('.filter-item__input[name="title"], input[name="title"], .catalog-search__input[name="search"], input[name="search"]');
        if (!inputs.length) return;

        let timer = null;

        function applyTitleFilter(value) {
            filterState.title = String(value || '').trim().toLowerCase();

            inputs.forEach(function (input) {
                if (input.value !== value) {
                    input.value = value;
                }
            });

            applyStoreAndRerender(true);
        }

        inputs.forEach(function (input) {
            input.addEventListener('input', function () {
                const value = input.value;

                clearTimeout(timer);
                timer = setTimeout(function () {
                    applyTitleFilter(value);
                }, 250);
            });
        });
    }
    function bindTitleFilterReset() {
        document.addEventListener('click', function (event) {
            const btn = event.target.closest('.catalog-remove-search');
            if (!btn) return;

            event.preventDefault();

            qsa('.filter-item__input[name="title"], input[name="title"], .catalog-search__input[name="search"], input[name="search"]').forEach(function (input) {
                input.value = '';
            });

            filterState.title = '';
            applyStoreAndRerender(true);
        });
    }

    function parseNumber(value) {
        value = String(value == null ? '' : value)
            .replace(/\s+/g, '')
            .replace(/[^\d.,]/g, '')
            .replace(',', '.');

        const parts = value.split('.');
        if (parts.length > 2) {
            value = parts[0] + '.' + parts.slice(1).join('');
        }

        const result = parseFloat(value);
        return Number.isFinite(result) ? result : 0;
    }

    function formatThousands(value) {
        return Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    }

    function formatPriceInput(value) {
        return formatThousands(value) + ' $';
    }

    function getPriceBoundsFromHotels() {
        const prices = allHotels
            .map(getHotelPriceNight)
            .filter(function (price) { return Number.isFinite(price) && price > 0; });

        if (!prices.length) return null;

        return {
            min: Math.floor(Math.min.apply(null, prices)),
            max: Math.ceil(Math.max.apply(null, prices))
        };
    }

    function getPriceRangeNodes() {
        return {
            range: qs('.js-price-range'),
            from: qs('.js-price-from'),
            to: qs('.js-price-to')
        };
    }

    function setPriceFilter(from, to, apply) {
        filterState.priceFrom = from;
        filterState.priceTo = to;

        if (apply) {
            applyStoreAndRerender(true);
        }
    }

    function getPriceRangeInstance() {
        if (typeof window.jQuery === 'undefined') return null;
        const nodes = getPriceRangeNodes();
        return nodes.range ? window.jQuery(nodes.range).data('ionRangeSlider') : null;
    }

    function bindPriceInputs(nodes) {
        if (!nodes.from || !nodes.to) return;

        [nodes.from, nodes.to].forEach(function (input) {
            input.addEventListener('focus', function () {
                const value = parseNumber(input.value);
                input.value = value ? formatThousands(value) : '';
            });

            input.addEventListener('input', function () {
                const raw = input.value.replace(/[^\d]/g, '');
                input.value = raw ? formatThousands(raw) : '';
            });
        });

        nodes.from.addEventListener('blur', function () {
            let value = parseNumber(nodes.from.value) || filterState.priceMin;
            const currentTo = filterState.priceTo !== null ? filterState.priceTo : filterState.priceMax;
            if (value < filterState.priceMin) value = filterState.priceMin;
            if (value > currentTo) value = currentTo;

            nodes.from.value = formatPriceInput(value);
            const instance = getPriceRangeInstance();
            if (instance) instance.update({ from: value });
            setPriceFilter(value, currentTo, true);
        });

        nodes.to.addEventListener('blur', function () {
            let value = parseNumber(nodes.to.value) || filterState.priceMax;
            const currentFrom = filterState.priceFrom !== null ? filterState.priceFrom : filterState.priceMin;
            if (value > filterState.priceMax) value = filterState.priceMax;
            if (value < currentFrom) value = currentFrom;

            nodes.to.value = formatPriceInput(value);
            const instance = getPriceRangeInstance();
            if (instance) instance.update({ to: value });
            setPriceFilter(currentFrom, value, true);
        });
    }

    function refreshPriceRangeBounds(preserveSelected) {
        const nodes = getPriceRangeNodes();
        if (!nodes.range) return;

       const bounds = getPriceBoundsFromHotels();

        if (!bounds) {
            setPriceFilterEmpty(true);
            return;
        }

        setPriceFilterEmpty(false);

        const min = bounds.min;
        const max = Math.max(bounds.max, min + 1);
        const step = parseFloat(nodes.range.getAttribute('data-step') || '1') || 1;
        let from = preserveSelected && filterState.priceFrom !== null ? filterState.priceFrom : min;
        let to = preserveSelected && filterState.priceTo !== null ? filterState.priceTo : max;

        if (from < min) from = min;
        if (to > max) to = max;
        if (from > to) from = min;

        filterState.priceMin = min;
        filterState.priceMax = max;
        filterState.priceFrom = preserveSelected ? from : null;
        filterState.priceTo = preserveSelected ? to : null;

        nodes.range.setAttribute('data-min', String(min));
        nodes.range.setAttribute('data-max', String(max));
        nodes.range.setAttribute('data-from', String(from));
        nodes.range.setAttribute('data-to', String(to));

        if (nodes.from) nodes.from.value = formatPriceInput(from);
        if (nodes.to) nodes.to.value = formatPriceInput(to);

        if (typeof window.jQuery !== 'undefined' && typeof window.jQuery.fn.ionRangeSlider === 'function') {
            const $range = window.jQuery(nodes.range);
            const oldInstance = $range.data('ionRangeSlider');
            if (oldInstance && typeof oldInstance.destroy === 'function') {
                oldInstance.destroy();
            }

            $range.ionRangeSlider({
                skin: 'round',
                type: 'double',
                min: min,
                max: max,
                step: step,
                from: from,
                to: to,
                onStart: function (data) {
                    if (nodes.from) nodes.from.value = formatPriceInput(data.from);
                    if (nodes.to) nodes.to.value = formatPriceInput(data.to);
                },
                onChange: function (data) {
                    if (nodes.from) nodes.from.value = formatPriceInput(data.from);
                    if (nodes.to) nodes.to.value = formatPriceInput(data.to);
                },
                onFinish: function (data) {
                    if (isPriceRangeUpdating) return;
                    setPriceFilter(data.from, data.to, true);
                }
            });

            if (!isPriceRangeReady) {
                bindPriceInputs(nodes);
                isPriceRangeReady = true;
            }

            return;
        }

        if (!isPriceRangeReady) {
            bindPriceInputs(nodes);
            isPriceRangeReady = true;
        }
    }

    function resetFiltersState() {
        filterState.types.clear();
        filterState.stars.clear();
        filterState.title = '';
        filterState.priceFrom = null;
        filterState.priceTo = null;
        filterState.priceMin = 0;
        filterState.priceMax = 0;
        filterState.distanceTo = null;
        filterState.hotelAmenities.clear();
        filterState.roomAmenities.clear();
        filterState.featureAmenities.clear();
        filterState.metro.clear();
        filterState.attractions.clear();

        qsa('.filter-item[data-id="type"] .filter-check.active, .filter-item#start .filter-check.active, .filter-item[data-id="stars"] .filter-check.active, [data-amenity].active, [data-nearby].active').forEach(function (node) {
            node.classList.remove('active');
        });

        const titleInput = qs('.filter-item__input[name="title"], input[name="title"]');
        if (titleInput) titleInput.value = '';
    }


    function setDistanceFilter(value, apply) {
        const number = parseFloat(String(value == null ? '' : value).replace(',', '.'));
        const max = filterState.distanceMax || 30;

        filterState.distanceTo = Number.isFinite(number) && number > 0 && number < max ? number : null;

        if (apply) {
            applyStoreAndRerender(true);
        }
    }

    function bindDistanceFilter() {
        const range = qs('.js-distance-range');
        const input = qs('.js-filter-distance');
        const remove = qs('.distance-remove');

        if (!range) return;

        const min = parseFloat(range.getAttribute('data-min') || '0.5') || 0.5;
        const max = parseFloat(range.getAttribute('data-max') || '30') || 30;
        const step = parseFloat(range.getAttribute('data-step') || '1') || 1;
        filterState.distanceMax = max;

        function formatDistance(value) {
            const normalized = parseFloat(value || 0);
            const text = Number.isInteger(normalized) ? String(normalized) : String(normalized).replace('.', ',');
            return text + ' км';
        }

        function syncInput(value) {
            if (input) input.value = formatDistance(value);
        }

        if (typeof window.jQuery !== 'undefined' && typeof window.jQuery.fn.ionRangeSlider === 'function') {
            const $range = window.jQuery(range);
            const oldInstance = $range.data('ionRangeSlider');
            if (oldInstance && typeof oldInstance.destroy === 'function') {
                oldInstance.destroy();
            }

            $range.ionRangeSlider({
                skin: 'round',
                type: 'single',
                min: min,
                max: max,
                step: step,
                from: max,
                onStart: function (data) { syncInput(data.from); },
                onChange: function (data) { syncInput(data.from); },
                onFinish: function (data) { setDistanceFilter(data.from, true); }
            });
        }

        if (input) {
            input.addEventListener('focus', function () {
                input.value = String(parseFloat(input.value.replace(',', '.')) || max).replace('.', ',');
            });

            input.addEventListener('input', function () {
                input.value = input.value.replace(/[^\d.,]/g, '');
            });

            input.addEventListener('blur', function () {
                let value = parseFloat(String(input.value || '').replace(',', '.'));
                if (!Number.isFinite(value)) value = max;
                if (value < min) value = min;
                if (value > max) value = max;

                syncInput(value);

                const instance = typeof window.jQuery !== 'undefined' ? window.jQuery(range).data('ionRangeSlider') : null;
                if (instance) instance.update({ from: value });
                setDistanceFilter(value, true);
            });
        }

        if (remove) {
            remove.addEventListener('click', function (event) {
                event.preventDefault();
                const instance = typeof window.jQuery !== 'undefined' ? window.jQuery(range).data('ionRangeSlider') : null;
                if (instance) instance.update({ from: max });
                syncInput(max);
                setDistanceFilter(null, true);
            });
        }
    }

    function bindAmenityFilters() {
        document.addEventListener('click', function (event) {
            const check = event.target.closest('[data-amenity][data-amenity-source]');
            if (!check) return;

            event.preventDefault();

            const value = String(check.getAttribute('data-amenity') || '').trim();
            const source = String(check.getAttribute('data-amenity-source') || '').trim();
            const targetSet = source === 'room'
                ? filterState.roomAmenities
                : (source === 'feature' ? filterState.featureAmenities : filterState.hotelAmenities);

            check.classList.toggle('active');

            if (check.classList.contains('active')) {
                targetSet.add(value);
            } else {
                targetSet.delete(value);
            }

            applyStoreAndRerender(true);
        });
    }

    function bindNearbyFilters() {
        document.addEventListener('click', function (event) {
            const check = event.target.closest('[data-nearby][data-nearby-source]');
            if (!check) return;

            event.preventDefault();

            const value = String(check.getAttribute('data-nearby') || '').trim();
            const source = String(check.getAttribute('data-nearby-source') || '').trim();
            const targetSet = source === 'metro' ? filterState.metro : filterState.attractions;

            check.classList.toggle('active');

            if (check.classList.contains('active')) {
                targetSet.add(value);
            } else {
                targetSet.delete(value);
            }

            applyStoreAndRerender(true);
        });
    }

    function bindSortFilter() {
        document.addEventListener('click', function (event) {
            const item = event.target.closest('.filter-drop__item');
            if (!item) return;

            const input = item.querySelector('input[name="sort"]');
            if (!input) return;

            const drop = item.closest('.filter-drop');
            const title = drop ? drop.querySelector('.filter-drop__title') : null;
            const text = item.querySelector('p');

            input.checked = true;

            if (drop) {
                Array.prototype.slice.call(drop.querySelectorAll('.filter-drop__item')).forEach(function (node) {
                    node.classList.remove('active');
                });
            }

            item.classList.add('active');

            if (title && text) {
                title.textContent = text.textContent.trim();
            }

            applySortAndRerender(input.value);
        });
    }

    async function loadHotels(params) {
        const list = qs('.catalog-list');
        if (!list) return;

        const validationError = form.validateParams(params);
        if (validationError) {
            removeScrollSentinel();
            list.innerHTML = '<div class="catalog-empty">' + escapeHtml(validationError) + '</div>';
            return;
        }

        const requestId = ++lastRequestId;

        currentParams = cloneParams(params);
        currentParams.delete('page');
        currentParams.delete('sort');

        currentPage = 0;
        totalPages = 1;
        totalHotels = 0;
        allHotels = [];
        filteredHotels = [];
        renderedOffset = 0;
        loadedIds = new Set();
        isLoading = true;
        isRenderingMore = false;
        remainingLoadPromise = null;
        originalIndex = 0;
        resetFiltersState();
        removeScrollSentinel();

        catalogRender.setCatalogLoadingTitle();
        list.innerHTML = '';
        if (typeof catalogRender.showFullPageSkeleton === 'function') {
            catalogRender.showFullPageSkeleton();
        } else {
            list.innerHTML = catalogRender.renderSkeletonCards(6);
        }
        setPriceFilterLoading(true);

        try {
            const data = await fetchHotelsPage(currentParams, 1);
            if (requestId !== lastRequestId) return;

            const hotelsRaw = Array.isArray(data.hotels) ? data.hotels : [];
            applyFirstMeta(data);
            addHotelsToStore(hotelsRaw);
            rebuildFilteredHotels();
            refreshPriceRangeBounds(false);
            refreshAmenityFilters();
            refreshNearbyFilters();
            updateCatalogTitle(data);

            if (typeof catalogRender.hideFullPageSkeleton === 'function') {
                catalogRender.hideFullPageSkeleton();
            }

            if (!filteredHotels.length) {
                list.innerHTML = '<div class="catalog-empty">По выбранным параметрам отели не найдены.</div>';
                currentParams = null;
                return;
            }

            list.innerHTML = '';
            await renderNextHotelsChunk(false);

            document.dispatchEvent(new CustomEvent('hotels:loaded:first-page', {
                detail: { hotels: allHotels.slice(0), params: currentParams, response: data }
            }));

            // Остальные страницы догружаем в фоне. Так поиск не висит на skeleton,
            // а фильтры метро/достопримечательностей дополняются после загрузки всех страниц.
            if (totalPages > 1) {
                remainingLoadPromise = loadRemainingPages(requestId);
            }
        } catch (error) {
            if (requestId !== lastRequestId) return;

            if (typeof catalogRender.hideFullPageSkeleton === 'function') {
                catalogRender.hideFullPageSkeleton();
            }
            list.innerHTML = '<div class="catalog-error">' + escapeHtml(error.message || 'Не удалось загрузить отели.') + '</div>';
            currentParams = null;
            setPriceFilterEmpty(true);
            console.error('[hotel-search]', error);
        } finally {
            if (requestId === lastRequestId) {
                 setPriceFilterLoading(false);
                isLoading = false;
                setupInfiniteScroll();
            }
        }
    }

    window.HotelSearch.getPageParams = getPageParams;
    window.HotelSearch.loadHotels = loadHotels;
    window.HotelSearch.loadNextHotelsPage = renderNextHotelsChunk;
    window.HotelSearch.applySortAndRerender = applySortAndRerender;
    window.HotelSearch.applyStoreAndRerender = applyStoreAndRerender;

    document.addEventListener('DOMContentLoaded', function () {
        bindSortFilter();
        bindCheckFilters();
        bindTitleFilter();
        bindTitleFilterReset();
        bindDistanceFilter();
        bindAmenityFilters();
        bindNearbyFilters();

        form.bindBookingForms({
            storageKey: STORAGE_KEY,
            catalogUrl: HOTEL_CATALOG_URL,
            onCatalogSearch: loadHotels
        });

        if (qs('.catalog-list')) {
            loadHotels(getPageParams());
        }
    });
})();

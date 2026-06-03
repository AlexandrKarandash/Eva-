(function () {
    'use strict';

    window.HotelSearch = window.HotelSearch || {};

    const utils = window.HotelSearch.utils;
    if (!utils) return;

    const qs = utils.qs;
    const qsa = utils.qsa;
    const escapeHtml = utils.escapeHtml;
    const formatFilterDateInfo = utils.formatFilterDateInfo;
    const getNights = utils.getNights;
    const syncRegionTitles = utils.syncRegionTitles || function () {};
    const getRegionMorph = utils.getRegionMorph || function (city) { return Promise.resolve(String(city || '').trim()); };
    let catalogTitleRequestId = 0;

    const STATIC_URL = window.STATIC_URL || '/static/';
    const PLACEHOLDER_IMAGE = window.HOTEL_PLACEHOLDER_IMAGE || getStaticPath('images/empty-photo.png');

    function getStaticPath(path) {
        return String(STATIC_URL || '/static/').replace(/\/$/, '') + '/' + String(path || '').replace(/^\//, '');
    }

    const ARROW_PREV_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.75 0.75C14.7206 0.75 18.75 4.77944 18.75 9.75C18.75 14.7206 14.7206 18.75 9.75 18.75C4.77944 18.75 0.75 14.7206 0.75 9.75C0.75 4.77944 4.77944 0.75 9.75 0.75Z" fill="white"/><path d="M10.75 12.75L7.75 9.75L10.75 6.75M18.75 9.75C18.75 4.77944 14.7206 0.75 9.75 0.75C4.77944 0.75 0.75 4.77944 0.75 9.75C0.75 14.7206 4.77944 18.75 9.75 18.75C14.7206 18.75 18.75 14.7206 18.75 9.75Z" stroke="#7C3AED" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ARROW_NEXT_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.75 0.75C14.7206 0.75 18.75 4.77944 18.75 9.75C18.75 14.7206 14.7206 18.75 9.75 18.75C4.77944 18.75 0.75 14.7206 0.75 9.75C0.75 4.77944 4.77944 0.75 9.75 0.75Z" fill="white"/><path d="M8.75 6.75L11.75 9.75L8.75 12.75M18.75 9.75C18.75 4.77944 14.7206 0.75 9.75 0.75C4.77944 0.75 0.75 4.77944 0.75 9.75C0.75 14.7206 4.77944 18.75 9.75 18.75C14.7206 18.75 18.75 14.7206 18.75 9.75Z" stroke="#7C3AED" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function formatPrice(value) {
        const number = parseFloat(value || 0);
        if (!Number.isFinite(number) || number <= 0) return 'Цена по запросу';
        return 'от ' + number.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' USDT';
    }

    function ensureSkeletonStyles() {
        if (document.getElementById('hotel-search-skeleton-styles')) return;

        const style = document.createElement('style');
        style.id = 'hotel-search-skeleton-styles';
        style.textContent = '' +
            '.catalog-skeleton-list{display:flex;flex-direction:column;gap:20px;width:100%;}' +
            '.catalog-skeleton{display:grid;grid-template-columns:minmax(260px,38%) 1fr;gap:24px;padding:16px;border-radius:24px;background:#fff;box-shadow:0 8px 30px rgba(15,23,42,.06);overflow:hidden;}' +
            '.catalog-skeleton__photo{min-height:235px;border-radius:20px;background:#eef0f4;}' +
            '.catalog-skeleton__content{display:flex;flex-direction:column;gap:16px;padding:8px 4px;}' +
            '.catalog-skeleton__line,.catalog-skeleton__btn,.catalog-full-skeleton__line,.catalog-full-skeleton__box,.catalog-full-skeleton__photo,.catalog-full-skeleton__check,.catalog-full-skeleton__circle{display:block;background:linear-gradient(90deg,#edf0f5 0%,#f8f9fc 45%,#edf0f5 90%);background-size:240% 100%;animation:hotelSkeleton 1.15s ease-in-out infinite;}' +
            '.catalog-skeleton__line,.catalog-skeleton__btn{border-radius:10px;}' +
            '.catalog-skeleton__title{width:72%;height:28px;}' +
            '.catalog-skeleton__address{width:88%;height:16px;}' +
            '.catalog-skeleton__small{width:58%;height:16px;}' +
            '.catalog-skeleton__bottom{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:auto;}' +
            '.catalog-skeleton__price{width:145px;height:28px;}' +
            '.catalog-skeleton__btn{width:170px;height:48px;border-radius:14px;}' +
            '.catalog-frame.is-full-skeleton-loading>.filter,.catalog-frame.is-full-skeleton-loading>.catalog-wrap,.catalog-frame.is-full-skeleton-loading>.catalog-open{visibility:hidden;pointer-events:none;}' +
            '.catalog-full-skeleton-wrap{width:100%;background:#f5f7fb;padding:24px 0 48px;}' +
            '.catalog-full-skeleton{position:relative;z-index:1;display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px;align-items:start;width:100%;background:#f5f7fb;padding:0;}' +
            '.catalog-full-skeleton__side,.catalog-full-skeleton__main{display:flex;flex-direction:column;gap:16px;}' +
            '.catalog-full-skeleton__panel,.catalog-full-skeleton__banner,.catalog-full-skeleton__card{background:#fff;border-radius:22px;box-shadow:0 10px 35px rgba(15,23,42,.06);}' +
            '.catalog-full-skeleton__panel{padding:18px;}' +
            '.catalog-full-skeleton__filter{display:flex;flex-direction:column;gap:12px;margin-top:18px;}' +
            '.catalog-full-skeleton__row{display:flex;align-items:center;gap:10px;}' +
            '.catalog-full-skeleton__line{height:14px;border-radius:999px;}' +
            '.catalog-full-skeleton__box{height:44px;border-radius:14px;}' +
            '.catalog-full-skeleton__check{width:18px;height:18px;border-radius:5px;flex:0 0 auto;}' +
            '.catalog-full-skeleton__circle{width:26px;height:26px;border-radius:50%;flex:0 0 auto;}' +
            '.catalog-full-skeleton__banner{padding:24px;min-height:162px;}' +
            '.catalog-full-skeleton__banner-top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;}' +
            '.catalog-full-skeleton__banner-text{flex:1;display:flex;flex-direction:column;gap:12px;}' +
            '.catalog-full-skeleton__banner-actions{display:flex;gap:12px;margin-top:22px;}' +
            '.catalog-full-skeleton__card{display:grid;grid-template-columns:260px minmax(0,1fr);gap:18px;padding:14px;min-height:205px;}' +
            '.catalog-full-skeleton__photo{height:205px;border-radius:18px;}' +
            '.catalog-full-skeleton__content{display:flex;flex-direction:column;gap:13px;padding:6px 0;}' +
            '.catalog-full-skeleton__icons{display:flex;gap:8px;margin-top:auto;}' +
            '.catalog-full-skeleton__bottom{display:flex;align-items:center;justify-content:space-between;gap:20px;}' +
            '@keyframes hotelSkeleton{0%{background-position:120% 0}100%{background-position:-120% 0}}' +
            '@media(max-width:991px){.catalog-full-skeleton{grid-template-columns:1fr}.catalog-full-skeleton__side{display:none}.catalog-frame.is-full-skeleton-loading>.catalog-wrap{visibility:hidden}.catalog-full-skeleton__card{grid-template-columns:1fr}.catalog-full-skeleton__photo{height:220px}}' +
            '@media(max-width:767px){.catalog-skeleton{grid-template-columns:1fr;gap:14px;padding:12px;border-radius:18px}.catalog-skeleton__photo{min-height:210px}.catalog-skeleton__bottom{align-items:flex-start;flex-direction:column}.catalog-skeleton__btn{width:100%}.catalog-full-skeleton{gap:14px}.catalog-full-skeleton__banner{padding:18px;border-radius:18px}.catalog-full-skeleton__banner-top{display:block}.catalog-full-skeleton__banner-actions{flex-direction:column}.catalog-full-skeleton__card{border-radius:18px;padding:12px}.catalog-full-skeleton__photo{height:210px}}';
        document.head.appendChild(style);
    }

    function renderSkeletonCards(count) {
        ensureSkeletonStyles();

        let html = '<div class="catalog-skeleton-list" aria-hidden="true">';
        for (let i = 0; i < count; i += 1) {
            html += '' +
                '<div class="catalog-skeleton">' +
                    '<div class="catalog-skeleton__photo catalog-skeleton__line"></div>' +
                    '<div class="catalog-skeleton__content">' +
                        '<span class="catalog-skeleton__line catalog-skeleton__title"></span>' +
                        '<span class="catalog-skeleton__line catalog-skeleton__address"></span>' +
                        '<span class="catalog-skeleton__line catalog-skeleton__small"></span>' +
                        '<div class="catalog-skeleton__bottom">' +
                            '<span class="catalog-skeleton__line catalog-skeleton__price"></span>' +
                            '<span class="catalog-skeleton__btn"></span>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        }
        html += '</div>';

        return html;
    }


    function renderFullPageSkeleton() {
        ensureSkeletonStyles();

        function line(width, height) {
            return '<span class="catalog-full-skeleton__line" style="width:' + width + ';height:' + height + ';"></span>';
        }

        function filterRows(count) {
            let html = '';
            for (let i = 0; i < count; i += 1) {
                const width = i % 3 === 0 ? '78%' : (i % 3 === 1 ? '62%' : '86%');
                html += '<div class="catalog-full-skeleton__row"><span class="catalog-full-skeleton__check"></span>' + line(width, '13px') + '</div>';
            }
            return html;
        }

        function card() {
            return '' +
                '<div class="catalog-full-skeleton__card">' +
                    '<div class="catalog-full-skeleton__photo"></div>' +
                    '<div class="catalog-full-skeleton__content">' +
                        line('58%', '24px') +
                        line('36%', '15px') +
                        line('80%', '14px') +
                        line('44%', '14px') +
                        '<div class="catalog-full-skeleton__icons">' +
                            '<span class="catalog-full-skeleton__circle"></span>' +
                            '<span class="catalog-full-skeleton__circle"></span>' +
                            '<span class="catalog-full-skeleton__circle"></span>' +
                            '<span class="catalog-full-skeleton__circle"></span>' +
                            '<span class="catalog-full-skeleton__circle"></span>' +
                        '</div>' +
                        '<div class="catalog-full-skeleton__bottom">' +
                            line('150px', '24px') +
                            '<span class="catalog-full-skeleton__box" style="width:180px;height:48px;"></span>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        }

        return '' +
            '<div class="catalog-full-skeleton" aria-hidden="true">' +
                '<div class="catalog-full-skeleton__side">' +
                    '<div class="catalog-full-skeleton__panel">' + line('70%', '16px') + '<div style="height:12px"></div><span class="catalog-full-skeleton__box"></span></div>' +
                    '<div class="catalog-full-skeleton__panel">' + line('50%', '16px') + '<div style="height:12px"></div><span class="catalog-full-skeleton__box"></span></div>' +
                    '<div class="catalog-full-skeleton__panel">' + line('54%', '16px') + '<div class="catalog-full-skeleton__filter">' + filterRows(5) + '</div></div>' +
                    '<div class="catalog-full-skeleton__panel">' + line('62%', '16px') + '<div style="height:14px"></div><span class="catalog-full-skeleton__box"></span><div style="height:10px"></div><span class="catalog-full-skeleton__box"></span></div>' +
                    '<div class="catalog-full-skeleton__panel">' + line('72%', '16px') + '<div class="catalog-full-skeleton__filter">' + filterRows(7) + '</div></div>' +
                '</div>' +
                '<div class="catalog-full-skeleton__main">' +
                    '<div class="catalog-full-skeleton__banner">' +
                        '<div class="catalog-full-skeleton__banner-top">' +
                            '<div class="catalog-full-skeleton__banner-text">' + line('62%', '28px') + line('95%', '13px') + line('88%', '13px') + line('70%', '13px') + '</div>' +
                            '<span class="catalog-full-skeleton__box" style="width:170px;height:52px;"></span>' +
                        '</div>' +
                        '<div class="catalog-full-skeleton__banner-actions"><span class="catalog-full-skeleton__box" style="width:150px;height:48px;"></span><span class="catalog-full-skeleton__box" style="width:180px;height:48px;"></span></div>' +
                    '</div>' +
                    card() + card() + card() +
                '</div>' +
            '</div>';
    }

    function showFullPageSkeleton() {
        ensureSkeletonStyles();

        const catalog = qs('.catalog');
        const sectionFrame = qs('.catalog .section-frame') || qs('.section-frame');
        if (!catalog || !sectionFrame) return;

        hideFullPageSkeleton(false);
        catalog.classList.add('hide');
        sectionFrame.insertAdjacentHTML(
            'afterend',
            '<div class="catalog-full-skeleton-wrap"><div class="section-frame">' + renderFullPageSkeleton() + '</div></div>'
        );
    }

    function hideFullPageSkeleton(showCatalog) {
        const frame = qs('.catalog-frame');
        const catalog = qs('.catalog');
        const skeletonWrap = qs('.catalog-full-skeleton-wrap');
        const skeleton = qs('.catalog-full-skeleton');

        if (skeletonWrap && skeletonWrap.parentNode) {
            skeletonWrap.parentNode.removeChild(skeletonWrap);
        } else if (skeleton && skeleton.parentNode) {
            skeleton.parentNode.removeChild(skeleton);
        }

        if (frame) frame.classList.remove('is-full-skeleton-loading');
        if (showCatalog !== false && catalog) catalog.classList.remove('hide');
    }

    function renderStars(count) {
        const stars = parseInt(count || 0, 10);

        if (!Number.isFinite(stars) || stars <= 0) return '';

        let html = '';
        const safeStars = Math.min(stars, 5);

        for (let i = 0; i < safeStars; i += 1) {
            html += '<img src="' + getStaticPath('images/icon/star.svg') + '" alt="">';
        }

        return html;
    }

    function renderSlides(hotel) {
        const images = Array.isArray(hotel.images) && hotel.images.length
            ? hotel.images.slice(0, 8)
            : [PLACEHOLDER_IMAGE];

        return images.map(function (src) {
            return '' +
                '<div class="catalog-item__slide swiper-slide">' +
                    '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(hotel.name || '') + '">' +
                '</div>';
        }).join('');
    }

    function buildHotelLink(hotel, params) {
        const sourceParams = new URLSearchParams(params || '');
        const cleanParams = new URLSearchParams();

        const localKeys = [
            'region',
            'city',
            'checkin',
            'checkout',
            'adults',
            'rooms',
            'children',
            'language',
            'kind',
            'page',
            'sort'
        ];

        sourceParams.forEach(function (value, key) {
            if (localKeys.indexOf(key) === -1) {
                cleanParams.append(key, value);
            }
        });

        const id = hotel.hid || hotel.id || '';

        cleanParams.set('id', id);
        cleanParams.set('slug', hotel.id || '');

        return '/single/?' + cleanParams.toString();
    }

    function normalizeKindValue(hotel) {
        const value = String(hotel.kind || '').toLowerCase();

        if (value.indexOf('apart') !== -1 || value.indexOf('апарт') !== -1) return 'apartment';
        if (value.indexOf('hostel') !== -1 || value.indexOf('хостел') !== -1) return 'hostel';
        if (value.indexOf('hotel') !== -1 || value.indexOf('отель') !== -1) return 'hotel';

        return value || '';
    }



    const REGION_GEO = {
        '2395': {
            name: 'Москва',
            center: { lat: 55.755864, lng: 37.617698 },
            metro: [
                { name: 'Охотный Ряд', lat: 55.7577, lng: 37.6156 },
                { name: 'Театральная', lat: 55.7588, lng: 37.6177 },
                { name: 'Площадь Революции', lat: 55.7566, lng: 37.6216 },
                { name: 'Александровский сад', lat: 55.7522, lng: 37.6088 },
                { name: 'Библиотека имени Ленина', lat: 55.7520, lng: 37.6091 },
                { name: 'Арбатская', lat: 55.7522, lng: 37.6036 },
                { name: 'Тверская', lat: 55.7647, lng: 37.6065 },
                { name: 'Пушкинская', lat: 55.7650, lng: 37.6079 },
                { name: 'Чеховская', lat: 55.7657, lng: 37.6088 },
                { name: 'Китай-город', lat: 55.7537, lng: 37.6332 }
            ]
        },
        '2011': {
            name: 'Лос-Анджелеса',
            center: { lat: 34.052235, lng: -118.243683 },
            metro: [
                { name: 'Civic Center/Grand Park', lat: 34.0553, lng: -118.2459 },
                { name: 'Pershing Square', lat: 34.0488, lng: -118.2518 },
                { name: '7th Street/Metro Center', lat: 34.0486, lng: -118.2588 },
                { name: 'Union Station', lat: 34.0562, lng: -118.2365 },
                { name: 'Little Tokyo/Arts District', lat: 34.0501, lng: -118.2379 },
                { name: 'Historic Broadway', lat: 34.0493, lng: -118.2479 }
            ]
        },
        '2734': {
            name: 'Парижа',
            center: { lat: 48.856614, lng: 2.352222 },
            metro: [
                { name: 'Châtelet', lat: 48.8583, lng: 2.3470 },
                { name: 'Hôtel de Ville', lat: 48.8575, lng: 2.3514 },
                { name: 'Cité', lat: 48.8554, lng: 2.3467 },
                { name: 'Pont Neuf', lat: 48.8585, lng: 2.3419 },
                { name: 'Louvre–Rivoli', lat: 48.8606, lng: 2.3407 },
                { name: 'Les Halles', lat: 48.8624, lng: 2.3460 },
                { name: 'Saint-Michel', lat: 48.8530, lng: 2.3438 }
            ]
        },
        '6053839': {
            name: 'Дубая',
            center: { lat: 25.204849, lng: 55.270783 },
            metro: [
                { name: 'Burj Khalifa/Dubai Mall', lat: 25.2009, lng: 55.2692 },
                { name: 'Financial Centre', lat: 25.2112, lng: 55.2773 },
                { name: 'Emirates Towers', lat: 25.2175, lng: 55.2839 },
                { name: 'Business Bay', lat: 25.1912, lng: 55.2608 },
                { name: 'Union', lat: 25.2667, lng: 55.3167 },
                { name: 'BurJuman', lat: 25.2548, lng: 55.3047 }
            ]
        }
    };


    const CITY_GEO = {
        'санкт-петербург': {
            name: 'Санкт-Петербурга',
            center: { lat: 59.938784, lng: 30.314997 },
            metro: [
                { name: 'Адмиралтейская', lat: 59.9359, lng: 30.3146 },
                { name: 'Невский проспект', lat: 59.9356, lng: 30.3270 },
                { name: 'Гостиный двор', lat: 59.9347, lng: 30.3338 },
                { name: 'Сенная площадь', lat: 59.9272, lng: 30.3207 },
                { name: 'Садовая', lat: 59.9267, lng: 30.3176 },
                { name: 'Спасская', lat: 59.9270, lng: 30.3189 },
                { name: 'Василеостровская', lat: 59.9425, lng: 30.2780 },
                { name: 'Площадь Восстания', lat: 59.9314, lng: 30.3609 },
                { name: 'Маяковская', lat: 59.9317, lng: 30.3548 },
                { name: 'Горьковская', lat: 59.9560, lng: 30.3187 }
            ]
        }
    };

    function toNumber(value) {
        if (value === null || typeof value === 'undefined' || value === '') return null;
        const number = parseFloat(String(value).replace(',', '.'));
        return Number.isFinite(number) ? number : null;
    }

    function getDistanceMeters(lat1, lng1, lat2, lng2) {
        lat1 = toNumber(lat1);
        lng1 = toNumber(lng1);
        lat2 = toNumber(lat2);
        lng2 = toNumber(lng2);

        if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return null;

        const earthRadius = 6371000;
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLng = (lng2 - lng1) * toRad;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return earthRadius * c;
    }

    function formatDistanceMeters(value) {
        const meters = toNumber(value);
        if (meters === null || meters < 0) return '';

        if (meters < 1000) {
            return Math.round(meters) + ' м';
        }

        const km = meters / 1000;
        const digits = km < 10 ? 1 : 0;
        return km.toLocaleString('ru-RU', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        }) + ' км';
    }

    function getRegionInfo(params) {
        const regionId = params && typeof params.get === 'function' ? String(params.get('region') || '') : '';
        const city = params && typeof params.get === 'function' ? String(params.get('city') || '').trim() : '';
        const cityKey = city.toLowerCase();
        const fromGlobal = window.HOTEL_REGION_GEO && regionId ? window.HOTEL_REGION_GEO[regionId] : null;
        const fromGlobalCity = window.HOTEL_CITY_GEO && cityKey ? window.HOTEL_CITY_GEO[cityKey] : null;
        const info = fromGlobal || REGION_GEO[regionId] || fromGlobalCity || CITY_GEO[cityKey] || null;

        if (!info && city) {
            return { name: city, center: null, metro: [] };
        }

        if (info && !info.name && city) {
            return Object.assign({}, info, { name: city });
        }

        return info;
    }

    function getDistanceCenterMeters(hotel, regionInfo) {
        const directFields = [
            hotel.distance_center,
            hotel.distance_to_center,
            hotel.center_distance,
            hotel.distance_from_center
        ];

        for (let i = 0; i < directFields.length; i += 1) {
            const value = toNumber(directFields[i]);
            if (value !== null && value >= 0) {
                return value < 100 ? value * 1000 : value;
            }
        }

        if (!regionInfo || !regionInfo.center) return null;

        return getDistanceMeters(
            hotel.latitude,
            hotel.longitude,
            regionInfo.center.lat,
            regionInfo.center.lng
        );
    }


    function getCachedNearestMetro(hotel) {
        if (!hotel) return null;

        if (hotel.nearest_metro && typeof hotel.nearest_metro === 'object') {
            return hotel.nearest_metro;
        }

        const nearby = hotel.nearby_places || {};
        const metro = Array.isArray(nearby.metro) ? nearby.metro : [];
        return metro.length ? metro[0] : null;
    }

    function getNearestMetro(hotel, regionInfo) {
        if (!regionInfo || !Array.isArray(regionInfo.metro) || !regionInfo.metro.length) return null;

        let nearest = null;

        regionInfo.metro.forEach(function (station) {
            const distance = getDistanceMeters(hotel.latitude, hotel.longitude, station.lat, station.lng);
            if (distance === null) return;

            if (!nearest || distance < nearest.distance) {
                nearest = {
                    name: station.name,
                    distance: distance
                };
            }
        });

        return nearest;
    }

    function renderDistanceList(hotel, params) {
        const regionInfo = getRegionInfo(params);
        const items = [];
        const centerDistance = getDistanceCenterMeters(hotel, regionInfo);
        const centerFormatted = formatDistanceMeters(centerDistance);
        const regionName = regionInfo && regionInfo.name ? regionInfo.name : (params && typeof params.get === 'function' ? String(params.get('city') || '').trim() : 'центра');
        const nearestMetro = getCachedNearestMetro(hotel) || getNearestMetro(hotel, regionInfo);

        if (centerFormatted) {
            items.push(centerFormatted + ' от центра ' + regionName);
        }

        if (nearestMetro && nearestMetro.name) {
            const metroDistance = nearestMetro.distance_m || nearestMetro.distance || (nearestMetro.distance_km ? nearestMetro.distance_km * 1000 : null);
            const metroFormatted = nearestMetro.distance_text || formatDistanceMeters(metroDistance);
            if (metroFormatted) {
                items.push(metroFormatted + ' от метро ' + nearestMetro.name);
            }
        }

        if (!items.length) return '';

        return '<ul class="catalog-item__distance hide-open-map">' + items.map(function (item) {
            return '<li>' + escapeHtml(item) + '</li>';
        }).join('') + '</ul>';
    }


    const CATALOG_CONVENIENCE_ICONS = [
        {
            file: 'Wifi.svg',
            keys: ['wifi', 'wi-fi', 'интернет', 'вайфай', 'вай-фай', 'бесплатный интернет', 'wireless']
        },
        {
            file: 'Kid.svg',
            keys: ['kid', 'kids', 'child', 'children', 'дет', 'ребен', 'ребён', 'семейн', 'family']
        },
        {
            file: 'Pool.svg',
            keys: ['pool', 'swimming', 'бассейн']
        },
        {
            file: 'Lunch.svg',
            keys: ['breakfast', 'lunch', 'dinner', 'meal', 'restaurant', 'bar', 'завтрак', 'обед', 'ужин', 'питание', 'ресторан', 'бар', 'кафе']
        },
        {
            file: 'Disabled.svg',
            keys: ['disabled', 'wheelchair', 'accessible', 'доступная среда', 'инвалид', 'пандус']
        },
        {
            file: 'Desk.svg',
            keys: ['desk', 'business', 'work', 'workspace', 'рабоч', 'письменный стол', 'бизнес']
        },
        {
            file: 'Airport.svg',
            keys: ['airport', 'transfer', 'shuttle', 'аэропорт', 'трансфер']
        },
        {
            file: 'Beauty.svg',
            keys: ['spa', 'beauty', 'massage', 'сауна', 'спа', 'массаж', 'красот']
        },
        {
            file: 'Bed.svg',
            keys: ['bed', 'single-bed', 'double-bed', 'king-bed', 'queen-bed', 'кровать']
        },
        {
            file: 'Beds.svg',
            keys: ['beds', 'twin', 'две кровати', 'раздельн']
        },
        {
            file: 'Calendar.svg',
            keys: ['24-hour', '24/7', 'front desk', 'reception', 'ресепшн', 'регистрац', 'круглосуточ']
        },
        {
            file: 'Cleaning.svg',
            keys: ['cleaning', 'housekeeping', 'laundry', 'уборк', 'прачеч', 'химчист']
        },
        {
            file: 'Global.svg',
            keys: ['language', 'multilingual', 'персонал говорит', 'язык']
        },
        {
            file: 'Hotel.svg',
            keys: ['hotel', 'отель', 'лифт', 'elevator']
        },
        {
            file: 'Pets.svg',
            keys: ['pets', 'pet', 'dog', 'cat', 'животн', 'питомц']
        },
        {
            file: 'Service.svg',
            keys: ['service', 'room service', 'concierge', 'консьерж', 'обслуживание']
        },
        {
            file: 'Star.svg',
            keys: ['star', 'rating', 'звезд', 'звёзд']
        }
    ];

    function flattenHotelAmenityValues(value, result) {
        result = result || [];

        if (value == null) return result;

        if (Array.isArray(value)) {
            value.forEach(function (item) {
                flattenHotelAmenityValues(item, result);
            });
            return result;
        }

        if (typeof value === 'object') {
            Object.keys(value).forEach(function (key) {
                if (key === 'images' || key === 'rates') return;
                flattenHotelAmenityValues(value[key], result);
            });
            return result;
        }

        const text = String(value || '').trim();
        if (text) result.push(text);

        return result;
    }

    function getHotelAmenityText(hotel) {
        const values = [];

        [
            hotel.amenities,
            hotel.amenities_list,
            hotel.amenities_array,
            hotel.all_amenities,
            hotel.amenity_groups,
            hotel.serp_filters,
            hotel.services,
            hotel.facilities,
            hotel.room_amenities,
            hotel.description,
            hotel.kind
        ].forEach(function (source) {
            flattenHotelAmenityValues(source, values);
        });

        if (Array.isArray(hotel.rates)) {
            hotel.rates.slice(0, 5).forEach(function (rate) {
                flattenHotelAmenityValues(rate && rate.all_amenities, values);
                flattenHotelAmenityValues(rate && rate.amenities, values);
                flattenHotelAmenityValues(rate && rate.amenities_data, values);
                flattenHotelAmenityValues(rate && rate.serp_filters, values);
                flattenHotelAmenityValues(rate && rate.meal, values);
                flattenHotelAmenityValues(rate && rate.meal_data, values);
                flattenHotelAmenityValues(rate && rate.room_name, values);
                flattenHotelAmenityValues(rate && rate.raw_etg_rate, values);
            });
        }

        return values.join(' ').toLowerCase();
    }

    function renderConveniences(hotel) {
        const sourceText = getHotelAmenityText(hotel || {});
        const selected = [];

        CATALOG_CONVENIENCE_ICONS.forEach(function (icon) {
            if (selected.length >= 6) return;

            const hasIcon = icon.keys.some(function (key) {
                return sourceText.indexOf(key.toLowerCase()) !== -1;
            });

            if (hasIcon) selected.push(icon.file);
        });

        if (!selected.length) return '';

        return '<div class="catalog-item__conveniences hide-open-map">' + selected.map(function (file) {
            return '<img src="' + getStaticPath('images/services/' + file) + '" alt="">';
        }).join('') + '</div>';
    }

    function renderHotelCard(hotel, params) {
        const id = hotel.id || '';
        const link = buildHotelLink(hotel, params);
        const minPrice = hotel.min_price || (hotel.rates && hotel.rates[0] ? hotel.rates[0].price : 0);
        const nights = getNights(params || new URLSearchParams());
        const priceNight = parseFloat(minPrice || 0) > 0 ? parseFloat(minPrice || 0) / nights : 0;
        const kind = normalizeKindValue(hotel);
        const starsHtml = renderStars(hotel.stars);
        const distanceHtml = renderDistanceList(hotel, params || new URLSearchParams());
        const conveniencesHtml = renderConveniences(hotel);

        return '' +
            '<div class="catalog-item" data-id="' + escapeHtml(id) + '" data-hid="' + escapeHtml(hotel.hid || '') + '" data-lat="' + escapeHtml(hotel.latitude || '') + '" data-lng="' + escapeHtml(hotel.longitude || '') + '" data-link="' + escapeHtml(link) + '" data-price-night="' + escapeHtml(priceNight ? priceNight.toFixed(2) : '') + '" data-stars="' + escapeHtml(hotel.stars || '') + '" data-kind="' + escapeHtml(kind) + '">' +
                '<div class="catalog-item__gallery">' +
                    '<a href="' + escapeHtml(link) + '" class="catalog-item__slider swiper">' +
                        '<div class="swiper-wrapper">' + renderSlides(hotel) + '</div>' +
                    '</a>' +
                    '<div class="catalog-item__arrow">' +
                        '<div class="catalog-prev">' + ARROW_PREV_SVG + '</div>' +
                        '<div class="catalog-next">' + ARROW_NEXT_SVG + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="catalog-item__content">' +
                    '<div class="catalog-item__wrap-title">' +
                        '<div class="catalog-item__title">' +
                            '<a href="' + escapeHtml(link) + '" class="catalog-item__title-main">' + escapeHtml(hotel.name || 'Без названия') + '</a>' +
                            (starsHtml ? '<div class="catalog-item__star hide-open-map">' + starsHtml + '</div>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="catalog-item__info">' +
                        '<p class="catalog-item__address hide-open-map">' + escapeHtml(hotel.address || '') + '</p>' +
                        distanceHtml +
                    '</div>' +
                    '<div class="catalog-item__conditions">' +
                        conveniencesHtml +
                        '<div class="catalog-item__price"><b>' + formatPrice(priceNight || minPrice) + '</b><p class="hide-open-map">за сутки</p></div>' +
                    '</div>' +
                    '<div class="catalog-item__view hide-open-map">' +
                        '<a href="' + escapeHtml(link) + '" class="catalog-item__view-btn">Посмотреть номера</a>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    function setCatalogLoadingTitle() {
        qsa('.catalog-banner__map-title').forEach(function (node) {
            node.textContent = 'Поиск...';
        });

        const h1 = qs('.catalog-banner__content h1');
        if (h1) h1.textContent = 'Поиск...';
    }

    function setCatalogInfo(data, params) {
        const total = data && typeof data.total_hotels !== 'undefined' ? data.total_hotels : 0;
        const city = String(params.get('city') || '').trim();
        const mapTitle = city
            ? 'Отели в ' + city + ': найдено ' + total + ' вариантов'
            : 'Отели: найдено ' + total + ' вариантов';
        const h1FallbackTitle = mapTitle;
        const titleRequestId = ++catalogTitleRequestId;

        syncRegionTitles(city);

        qsa('.catalog-banner__map-title').forEach(function (node) {
            node.textContent = mapTitle;
        });

        const h1 = qs('.catalog-banner__content h1');
        if (h1) h1.textContent = h1FallbackTitle;

        if (city && h1) {
            getRegionMorph(city).then(function (morphCity) {
                if (titleRequestId !== catalogTitleRequestId) return;

                const cleanMorphCity = String(morphCity || city).trim();
                h1.textContent = 'Отели в ' + cleanMorphCity + ': найдено ' + total + ' вариантов';
            }).catch(function () {
                if (titleRequestId !== catalogTitleRequestId) return;
                h1.textContent = h1FallbackTitle;
            });
        }

        qsa('.filter-date__calendar').forEach(function (node) {
            node.textContent = formatFilterDateInfo(params);
        });

        qsa('.filter-date__people').forEach(function (node) {
            node.textContent = '';
        });
    }

    function initCatalogSliders(root) {
        if (typeof Swiper === 'undefined') return;

        qsa('.catalog-item', root).forEach(function (item) {
            const slider = qs('.catalog-item__slider', item);
            if (!slider || slider.swiper) return;

            new Swiper(slider, {
                slidesPerView: 1,
                speed: 450,
                nested: true,
                navigation: {
                    prevEl: qs('.catalog-prev', item),
                    nextEl: qs('.catalog-next', item)
                }
            });
        });
    }

    window.HotelSearch.catalogRender = {
        renderSkeletonCards: renderSkeletonCards,
        renderFullPageSkeleton: renderFullPageSkeleton,
        showFullPageSkeleton: showFullPageSkeleton,
        hideFullPageSkeleton: hideFullPageSkeleton,
        renderHotelCard: renderHotelCard,
        setCatalogLoadingTitle: setCatalogLoadingTitle,
        setCatalogInfo: setCatalogInfo,
        initCatalogSliders: initCatalogSliders
    };
})();
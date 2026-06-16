(function () {
	'use strict';

	const ROOM_PRICE_TAX_INFO_TEXT = 'Налоги и сборы не включены в стоимость и оплачиваются при заселении в валюте отеля.';

	const HOTEL_DETAIL_API = window.HOTEL_DETAIL_API || '/api/hotels/';
	const STATIC_URL = window.STATIC_URL || '/static/';
	const SEARCH_STORAGE_KEY = 'aifory_hotel_search_state';
	const BOOKING_STORAGE_KEY = 'aifory_hotel_booking_state';
	const PAYMENT_STORAGE_KEY = 'aifory_hotel_payment_state';
	const PREBOOK_API = '/api/booking/prebook/';
	const BOOKING_ERROR_MESSAGE = 'Произошла ошибка при бронировании. Пожалуйста, попробуйте ещё раз или обратитесь в поддержку.';

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

	function loadLocalState(key) {
		try {
			return JSON.parse(localStorage.getItem(key)) || {};
		} catch (e) {
			return {};
		}
	}

	function getSearchState() {
		return loadLocalState(SEARCH_STORAGE_KEY);
	}


	function getCurrentSingleSearchState() {
		const urlParams = getUrlParams();
		const state = Object.assign({}, getSearchState() || {});
		const urlChildren = urlParams.getAll('children');

		if (urlParams.get('checkin')) state.checkin = urlParams.get('checkin');
		if (urlParams.get('checkout')) state.checkout = urlParams.get('checkout');
		if (urlParams.get('adults')) state.adults = parseInt(urlParams.get('adults'), 10) || state.adults || 2;
		if (urlParams.get('rooms')) state.rooms_count = parseInt(urlParams.get('rooms'), 10) || state.rooms_count || 1;
		if (urlParams.get('residency')) state.residency = urlParams.get('residency');

		if (urlChildren.length) {
			state.children = urlChildren.map(function (age) {
				return parseAge(age);
			}).filter(function (age) {
				return age !== null;
			});
		}

		return state;
	}


	function saveSearchState(state) {
		try {
			localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify(state || {}));
		} catch (e) {
			console.error('[single save search state]', e);
		}
	}


	function saveLocalState(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value || {}));
		} catch (e) {
			console.error('[single save local state]', e);
		}
	}

	function getCookie(name) {
		const value = '; ' + document.cookie;
		const parts = value.split('; ' + name + '=');
		if (parts.length === 2) return parts.pop().split(';').shift();
		return '';
	}

	async function requestJson(url, options) {
		options = options || {};
		options.headers = options.headers || {};

		if (!options.headers['Content-Type'] && options.body) {
			options.headers['Content-Type'] = 'application/json';
		}

		options.headers.Accept = 'application/json';

		const csrf = getCookie('csrftoken');
		if (csrf) options.headers['X-CSRFToken'] = csrf;

		options.credentials = 'same-origin';

		const response = await fetch(url, options);
		const data = await response.json().catch(function () {
			return null;
		});

		if (!response.ok) {
			const error = new Error((data && (data.detail || data.message || data.error)) || 'Ошибка запроса');
			error.response = data;
			error.status = response.status;
			throw error;
		}

		return data;
	}

	function prebookRoomFromSingle(booking) {
		const payload = {
			book_hash: booking.book_hash,
			hotel_id: booking.hotel_id,
			email: booking.email || 'test@example.com',
			checkin: booking.checkin,
			checkout: booking.checkout
		};

		return requestJson(PREBOOK_API, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}

	function buildPaymentStateFromPrebook(booking, prebookData) {
		return Object.assign({}, prebookData || {}, {
			book_hash: (prebookData && prebookData.book_hash) || booking.book_hash,
			booking: {
				book_hash: (prebookData && prebookData.book_hash) || booking.book_hash,
				hotel_id: booking.hotel_id,
				checkin: booking.checkin,
				checkout: booking.checkout
			},
			started_at: Date.now(),
			created_at: new Date().toISOString(),
			cancelled: false,
			paid: false,
			payment_visible: false,
			form_submitted: false
		});
	}

	function setBookingButtonLoading(btn, isLoading) {
		if (!btn) return;

		if (isLoading) {
			if (!btn.dataset.defaultText) btn.dataset.defaultText = btn.textContent || 'Забронировать';
			btn.classList.add('disabled');
			btn.textContent = 'Проверяем цену...';
		} else {
			btn.classList.remove('disabled');
			btn.textContent = btn.dataset.defaultText || 'Забронировать';
		}
	}

	function normalizeDate(value) {
		value = String(value || '').trim();
		if (!value) return '';

		if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

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

	function parseAge(value) {
		const match = String(value == null ? '' : value).match(/\d+/);
		if (!match) return null;

		const age = parseInt(match[0], 10);
		return Number.isFinite(age) && age >= 0 && age <= 17 ? age : null;
	}

	function getDateFromSingleForm(form, type) {
		const selectors = type === 'from'
			? ['input[name="checkin"]', 'input[name="date_from"]', 'input[name="from"]', '.booking-date__input-from']
			: ['input[name="checkout"]', 'input[name="date_to"]', 'input[name="to"]', '.booking-date__input-to'];

		for (let i = 0; i < selectors.length; i += 1) {
			const input = qs(selectors[i], form);
			const date = normalizeDate(input && input.value);
			if (date) return date;
		}

		const title = qs('.booking-date__item.' + type + ' .booking-date__title', form);
		return normalizeDate(title ? title.textContent : '');
	}

	function collectRoomsFromSingleForm(form) {
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
					children.push({ age: age, label: label || String(age) });
				}
			});

			rooms.push({ adults: adults, children: children });
		});

		if (!rooms.length) {
			rooms.push({ adults: 2, children: [] });
		}

		return rooms;
	}

	function collectSingleDateState(form) {
		const prevState = getSearchState();
		const rooms = collectRoomsFromSingleForm(form);
		const children = [];
		let adults = 0;

		rooms.forEach(function (room) {
			adults += parseInt(room.adults || 0, 10) || 0;
			(room.children || []).forEach(function (child) {
				const age = typeof child === 'object' ? parseAge(child.age) : parseAge(child);
				if (age !== null) children.push(age);
			});
		});

		return Object.assign({}, prevState, {
			checkin: getDateFromSingleForm(form, 'from'),
			checkout: getDateFromSingleForm(form, 'to'),
			adults: adults || 2,
			rooms_count: rooms.length || 1,
			rooms: rooms,
			children: children
		});
	}

	function updateUrlFromSingleState(state) {
		const url = new URL(window.location.href);

		if (state.checkin) url.searchParams.set('checkin', state.checkin);
		if (state.checkout) url.searchParams.set('checkout', state.checkout);
		url.searchParams.set('adults', String(state.adults || 2));
		url.searchParams.set('rooms', String(state.rooms_count || 1));

		url.searchParams.delete('children');
		(Array.isArray(state.children) ? state.children : []).forEach(function (age) {
			const parsed = parseAge(age);
			if (parsed !== null) url.searchParams.append('children', String(parsed));
		});

		window.history.replaceState({}, '', url.pathname + url.search + url.hash);
	}

	function validateSingleDateState(state) {
		if (!state.checkin) return 'Выберите дату заезда.';
		if (!state.checkout) return 'Выберите дату выезда.';
		if (state.checkin >= state.checkout) return 'Дата выезда должна быть позже даты заезда.';
		return '';
	}

	function setSingleDateFormError(form, message) {
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

	function closeSingleDatePopup(form) {
		if (!form) return;

		form.classList.remove('active');
		form.classList.remove('open');
		form.classList.remove('show');

		const popupName = form.getAttribute('data-popup') || 'date';

		qsa('.target-box[data-popup="' + popupName + '"]').forEach(function (node) {
			node.classList.remove('active');
			node.classList.remove('open');
			node.classList.remove('show');
		});

		qsa('.target-frame, .popup-frame').forEach(function (frame) {
			frame.classList.remove('active');
			frame.classList.remove('open');
			frame.classList.remove('show');
		});

		qsa('.js-popup[data-popup="' + popupName + '"]').forEach(function (opener) {
			opener.classList.remove('active');
			opener.classList.remove('open');
		});

		document.body.classList.remove('lock');
		document.body.classList.remove('fixed');
		document.body.classList.remove('popup-open');
		document.documentElement.classList.remove('lock');
		document.documentElement.classList.remove('fixed');
		document.documentElement.classList.remove('popup-open');
        frameClose();
	}

	function formatDateLongRu(value) {
		const parts = String(value || '').split('-');
		if (parts.length !== 3) return '';

		const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
		if (Number.isNaN(date.getTime())) return '';

		return date.toLocaleDateString('ru-RU', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).replace('.', '');
	}

	function createKidItem(child) {
		const label = typeof child === 'object'
			? String(child.label || child.age || '').trim()
			: String(child || '').trim();
		const age = typeof child === 'object' ? parseAge(child.age) : parseAge(label);

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

	function updateSingleBookingRoomSummary(booking) {
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

		if (label) label.textContent = roomsCount + ' ' + plural(roomsCount, ['номер', 'номера', 'номеров']) + ' для';
		if (title) title.textContent = guests + ' ' + plural(guests, ['гость', 'гостя', 'гостей']);
		if (adultsInput) adultsInput.value = String(adults || 2);
		if (kidsInput) kidsInput.value = String(kids || 0);
	}

	function restoreSingleDateFormState() {
		const form = qs('.js-single-date');
		if (!form) return;

		const state = getCurrentSingleSearchState();
		if (!state || (!state.checkin && !state.checkout && !Array.isArray(state.rooms))) return;

		if (state.checkin) {
			qsa('input[name="checkin"], input[name="date_from"], input[name="from"], .booking-date__input-from', form).forEach(function (input) {
				input.value = state.checkin;
				input.setAttribute('value', state.checkin);
			});
			qsa('.booking-date__item.from .booking-date__title', form).forEach(function (node) {
				node.textContent = formatDateLongRu(state.checkin);
			});
		}

		if (state.checkout) {
			qsa('input[name="checkout"], input[name="date_to"], input[name="to"], .booking-date__input-to', form).forEach(function (input) {
				input.value = state.checkout;
				input.setAttribute('value', state.checkout);
			});
			qsa('.booking-date__item.to .booking-date__title', form).forEach(function (node) {
				node.textContent = formatDateLongRu(state.checkout);
			});
		}

		const booking = qs('.booking-room', form);
		const rooms = Array.isArray(state.rooms) && state.rooms.length ? state.rooms : null;
		if (!booking || !rooms) return;

		const scroll = qs('.place-drop__scroll', booking);
		const firstRoom = qs('.place-item', booking);
		if (!scroll || !firstRoom) return;

		qsa('.place-item', scroll).forEach(function (item, index) {
			if (index > 0) item.remove();
		});

		rooms.forEach(function (room, index) {
			let roomNode = index === 0 ? firstRoom : firstRoom.cloneNode(true);
			if (index > 0) scroll.appendChild(roomNode);

			const counter = qs('.place-item__counter', roomNode);
			if (counter) counter.textContent = (index + 1) + ' номер';

			const remove = qs('.place-remove', roomNode);
			if (remove) remove.style.display = index === 0 ? 'none' : '';

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

		updateSingleBookingRoomSummary(booking);
	}

	function bindSingleDateForm() {
		const form = qs('.js-single-date');
		if (!form || form.__hotelSingleDateBound) return;

		form.__hotelSingleDateBound = true;
		restoreSingleDateFormState();

		document.addEventListener('click', function (event) {
			const opener = event.target.closest('.js-popup[data-popup="date"], .single-content__btn[data-popup="date"]');
			if (!opener) return;

			setTimeout(restoreSingleDateFormState, 0);
		});

		form.addEventListener('submit', function (event) {
			event.preventDefault();

			const state = collectSingleDateState(form);
			const error = validateSingleDateState(state);

			if (error) {
				setSingleDateFormError(form, error);
				return;
			}

			setSingleDateFormError(form, '');
			saveSearchState(state);
			updateUrlFromSingleState(state);
			closeSingleDatePopup(form);
			initSingleHotelPage();
		});
	}

	function getSearchParams() {
		const urlParams = getUrlParams();
		const state = getSearchState();
		const params = new URLSearchParams();

		if (urlParams.get('checkin')) {
			params.set('checkin', urlParams.get('checkin'));
		} else if (state.checkin) {
			params.set('checkin', state.checkin);
		}

		if (urlParams.get('checkout')) {
			params.set('checkout', urlParams.get('checkout'));
		} else if (state.checkout) {
			params.set('checkout', state.checkout);
		}

		if (urlParams.get('adults')) {
			params.set('adults', urlParams.get('adults'));
		} else if (state.adults) {
			params.set('adults', state.adults);
		}

		if (urlParams.get('residency')) {
			params.set('residency', urlParams.get('residency'));
		} else {
			params.set('residency', state.residency || 'ru');
		}

		const urlChildren = urlParams.getAll('children');
		const localChildren = Array.isArray(state.children) ? state.children : [];

		if (urlChildren.length) {
			urlChildren.forEach(function (age) {
				params.append('children', age);
			});
		} else {
			localChildren.forEach(function (age) {
				params.append('children', age);
			});
		}

		return params;
	}

	function getNights() {
		const params = getSearchParams();
		const checkin = params.get('checkin');
		const checkout = params.get('checkout');

		if (!checkin || !checkout) return 1;

		const from = new Date(checkin);
		const to = new Date(checkout);

		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 1;

		return Math.max(Math.round((to.getTime() - from.getTime()) / 86400000), 1);
	}

	function getHotelId() {
		const params = getUrlParams();
		return params.get('id') || params.get('hotel_id') || '';
	}

	function buildDetailUrl(hotelId) {
		const params = getSearchParams();
		const baseApi = String(HOTEL_DETAIL_API || '/api/hotels/').replace(/\/$/, '');
		const url = new URL(baseApi + '/' + encodeURIComponent(hotelId) + '/', window.location.origin);

		const checkin = params.get('checkin');
		const checkout = params.get('checkout');
		const adults = params.get('adults');
		const residency = params.get('residency') || 'ru';

		if (checkin) url.searchParams.set('checkin', checkin);
		if (checkout) url.searchParams.set('checkout', checkout);
		if (adults) url.searchParams.set('adults', adults);
		url.searchParams.set('residency', residency);

		params.getAll('children').forEach(function (age) {
			url.searchParams.append('children', age);
		});

		return url.toString();
	}

	function formatPrice(value) {
		const number = parseFloat(value || 0);

		if (!Number.isFinite(number) || number <= 0) {
			return 'Цена по запросу';
		}

		return 'от ' + number.toLocaleString('ru-RU', {
			maximumFractionDigits: 2
		}) + ' USDT';
	}

	function getHotelMinPrice(hotel) {
		if (hotel.min_price) return hotel.min_price;

		const rates = Array.isArray(hotel.rates) ? hotel.rates : [];
		const prices = rates.map(getRatePrice).filter(function (price) {
			return Number.isFinite(price) && price > 0;
		});

		if (!prices.length) return 0;
		return Math.min.apply(null, prices);
	}

	function getStarSrc() {
		const current = qs('.single-banner__star img');
		return current ? current.getAttribute('src') : getStaticPath('images/icon/star.svg');
	}

	function renderStars(count) {
		const stars = Math.max(0, Math.min(parseInt(count || 0, 10), 5));
		const src = getStarSrc();
		let html = '';

		for (let i = 0; i < stars; i += 1) {
			html += '<img src="' + escapeHtml(src) + '" alt="">';
		}

		return html;
	}

	function normalizeImages(hotel) {
		let images = [];

		if (Array.isArray(hotel.images_ext) && hotel.images_ext.length) {
			images = hotel.images_ext.map(function (item) {
				return item && item.url ? item.url : '';
			});
		} else if (Array.isArray(hotel.images)) {
			images = hotel.images;
		}

		return images.map(function (src) {
			return String(src || '').trim().replace('{size}', '1024x768');
		}).filter(Boolean);
	}


	function renderPopupGallery(hotel, images) {
		const popup = qs('.popup.gallery');
		if (!popup) return;

		const title = qs('.gallery-title', popup);
		const fullWrapper = qs('.gallery-full .swiper-wrapper', popup);
		const dotsWrapper = qs('.gallery-dots .swiper-wrapper', popup);

		if (title) title.textContent = hotel.name || 'Галерея';
		if (!fullWrapper || !dotsWrapper) return;

		fullWrapper.innerHTML = images.map(function (src) {
			return '<div class="gallery-slide swiper-slide"><img src="' + escapeHtml(src) + '" loading="lazy" alt="' + escapeHtml(hotel.name || '') + '"></div>';
		}).join('');

		dotsWrapper.innerHTML = images.map(function (src) {
			return '<div class="gallery-dots__slide swiper-slide"><img src="' + escapeHtml(src) + '" loading="lazy" alt="' + escapeHtml(hotel.name || '') + '"></div>';
		}).join('');

		setTimeout(function () {
			if (window.hotelGalleryFull && window.hotelGalleryFull.destroy) window.hotelGalleryFull.destroy(true, true);
			if (window.hotelGallerySmall && window.hotelGallerySmall.destroy) window.hotelGallerySmall.destroy(true, true);

			if (typeof Swiper !== 'undefined') {
				window.hotelGallerySmall = new Swiper('.gallery-dots', {
					loop: false,
					slidesPerView: 'auto',
					lazy: true,
					spaceBetween: 7,
					slidesOffsetBefore: 18,
					watchSlidesProgress: true,
					breakpoints: {
						700: {
							spaceBetween: 10,
							slidesOffsetBefore: 64
						}
					}
				});

				window.hotelGalleryFull = new Swiper('.gallery-full', {
					loop: false,
					slidesPerView: 1,
					spaceBetween: 0,
					lazy: true,
					navigation: {
						nextEl: '.gallery-next',
						prevEl: '.gallery-prev'
					},
					thumbs: {
						swiper: window.hotelGallerySmall
					}
				});
			}
		}, 0);
	}

	function renderGallery(hotel) {
		const gallery = qs('.single-gallery');
		if (!gallery) return;

		const images = normalizeImages(hotel);

		if (!images.length) {
			gallery.style.display = 'none';
			renderPopupGallery(hotel, []);
			return;
		}

		gallery.style.display = '';

		const fullImage = images[0];
		const sideImages = images.slice(1, 7);
		const hiddenCount = Math.max(images.length - 7, 0);

		let html = '';

		html += '<img src="' + escapeHtml(fullImage) + '" class="single-gallery__full" data-gallery-index="0" alt="' + escapeHtml(hotel.name || '') + '">';
		html += '<div class="single-gallery__list">';

		sideImages.forEach(function (src, index) {
			const realIndex = index + 1;
			const isLast = index === sideImages.length - 1;

			html += '<div class="single-gallery__item" data-gallery-index="' + realIndex + '">';
			html += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(hotel.name || '') + '">';

			if (isLast && hiddenCount > 0) {
				html += '<div class="single-gallery__all"><p>+ ' + hiddenCount + ' фото</p></div>';
			}

			html += '</div>';
		});

		html += '</div>';

		gallery.innerHTML = html;
		renderPopupGallery(hotel, images);
	}


	function ensureSkeletonStyles() {
		if (document.getElementById('single-hotel-skeleton-style')) return;

		const style = document.createElement('style');
		style.id = 'single-hotel-skeleton-style';
		style.textContent = '' +
			'.single-page-skeleton{padding:40px 0 80px;}' +
			'.single-page-skeleton .section-frame{display:flex;flex-direction:column;gap:24px;}' +
			'.single-skeleton-card{border-radius:28px;background:#fff;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,.06);}' +
			'.single-skeleton-top{display:grid;grid-template-columns:1fr 260px;gap:24px;align-items:start;}' +
			'.single-skeleton-line{display:block;border-radius:12px;background:linear-gradient(90deg,#eef0f4 0%,#f7f8fb 45%,#eef0f4 90%);background-size:240% 100%;animation:singleSkeleton 1.15s ease-in-out infinite;}' +
			'.single-skeleton-title{width:62%;height:42px;}' +
			'.single-skeleton-stars{width:170px;height:20px;margin-top:18px;}' +
			'.single-skeleton-address{width:78%;height:18px;margin-top:22px;}' +
			'.single-skeleton-price{width:180px;height:38px;margin-left:auto;}' +
			'.single-skeleton-btn{width:220px;height:52px;margin-left:auto;margin-top:24px;border-radius:16px;}' +
			'.single-skeleton-gallery{display:grid;grid-template-columns:1.3fr .9fr;gap:16px;}' +
			'.single-skeleton-big{min-height:420px;border-radius:24px;}' +
			'.single-skeleton-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}' +
			'.single-skeleton-photo{min-height:128px;border-radius:20px;}' +
			'@keyframes singleSkeleton{0%{background-position:120% 0}100%{background-position:-120% 0}}' +
			'@media(max-width:767px){.single-skeleton-top{grid-template-columns:1fr}.single-skeleton-gallery{grid-template-columns:1fr}.single-skeleton-big{min-height:260px}.single-skeleton-price,.single-skeleton-btn{margin-left:0;width:100%}}';

		document.head.appendChild(style);
	}

	function showSkeleton() {
		ensureSkeletonStyles();

		if (document.querySelector('.single-page-skeleton')) return;

		const content = qs('.content-page');

		const skeleton = document.createElement('div');
		skeleton.className = 'single-page-skeleton';
		skeleton.innerHTML = '' +
			'<div class="section-frame">' +
				'<div class="single-skeleton-card single-skeleton-top">' +
					'<div>' +
						'<span class="single-skeleton-line single-skeleton-title"></span>' +
						'<span class="single-skeleton-line single-skeleton-stars"></span>' +
						'<span class="single-skeleton-line single-skeleton-address"></span>' +
					'</div>' +
					'<div>' +
						'<span class="single-skeleton-line single-skeleton-price"></span>' +
						'<span class="single-skeleton-line single-skeleton-btn"></span>' +
					'</div>' +
				'</div>' +
				'<div class="single-skeleton-gallery">' +
					'<span class="single-skeleton-line single-skeleton-big"></span>' +
					'<div class="single-skeleton-grid">' +
						'<span class="single-skeleton-line single-skeleton-photo"></span>' +
						'<span class="single-skeleton-line single-skeleton-photo"></span>' +
						'<span class="single-skeleton-line single-skeleton-photo"></span>' +
						'<span class="single-skeleton-line single-skeleton-photo"></span>' +
						'<span class="single-skeleton-line single-skeleton-photo"></span>' +
						'<span class="single-skeleton-line single-skeleton-photo"></span>' +
					'</div>' +
				'</div>' +
			'</div>';

		if (content && content.parentNode) {
			content.parentNode.insertBefore(skeleton, content);
		} else {
			document.body.appendChild(skeleton);
		}
	}

	function hideSkeleton() {
		const skeleton = qs('.single-page-skeleton');
		if (skeleton && skeleton.parentNode) {
			skeleton.parentNode.removeChild(skeleton);
		}
	}

	function showContentPage() {
		const content = qs('.content-page');
		if (!content) return;

		content.style.display = '';
		content.classList.add('is-loaded');
	}

	function setText(selector, value, root) {
		const node = qs(selector, root);
		if (!node) return;

		node.textContent = value || '';
	}

	function hideNode(node) {
		if (node) node.style.display = 'none';
	}

	function showNode(node) {
		if (node) node.style.display = '';
	}

	function normalizeHotelResponse(data) {
		return data && (data.hotel || data.data || data.result || data);
	}

	function getRateHash(rate) {
		return rate && (rate.book_hash || rate.match_hash || rate.hash || '');
	}

	function getFirstValue() {
		for (let i = 0; i < arguments.length; i += 1) {
			const value = arguments[i];

			if (Array.isArray(value) && value.length) return value;
			if (value && typeof value === 'object' && Object.keys(value).length) return value;
			if (typeof value === 'string' && value.trim()) return value;
			if (typeof value === 'number' && Number.isFinite(value)) return value;
		}

		return '';
	}

	function formatDateRu(dateString) {
		if (!dateString) return '';

		const date = new Date(dateString);
		if (Number.isNaN(date.getTime())) return '';

		return date.toLocaleDateString('ru-RU', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			weekday: 'short'
		});
	}

	function formatTime(time, prefix) {
		if (!time) return '';

		const clean = String(time).slice(0, 5);
		return (prefix || '') + clean;
	}

	function getGuestText() {
		const params = getSearchParams();
		const state = getSearchState();

		let adults = parseInt(params.get('adults') || state.adults || 2, 10) || 2;
		let children = params.getAll('children');

		if (!children.length && Array.isArray(state.children)) {
			children = state.children;
		}

		const adultText = adults + ' ' + plural(adults, ['взрослый', 'взрослых', 'взрослых']);
		const childText = children.length ? ', ' + children.length + ' ' + plural(children.length, ['ребёнок', 'ребёнка', 'детей']) : '';

		return adultText + childText;
	}

	function plural(number, words) {
		const n = Math.abs(number) % 100;
		const n1 = n % 10;

		if (n > 10 && n < 20) return words[2];
		if (n1 > 1 && n1 < 5) return words[1];
		if (n1 === 1) return words[0];

		return words[2];
	}



	const HOTEL_TRANSLATIONS = {
		'apartment': 'Апартаменты',
		'hotel': 'Отель',
		'apart-hotel': 'Апарт-отель',
		'hostel': 'Хостел',
		'guesthouse': 'Гостевой дом',
		'resort': 'Курортный отель',
		'villa': 'Вилла',
		'cottages-and-houses': 'Коттедж/Дом',
		'unspecified': 'Не указано',
		'has_washer': 'Стиральная машина',
		'has_internet': 'Интернет',
		'has_kids': 'Можно с детьми',
		'has_pool': 'Бассейн',
		'air_conditioning': 'Кондиционер',
		'kitchen': 'Кухня',
		'has_bathroom': 'Собственная ванная комната',
		'has_breakfast': 'Завтрак',
		'king-bed': 'Кровать king-size',
		'queen-bed': 'Кровать queen-size',
		'double-bed': 'Двуспальная кровать',
		'twin-beds': 'Две односпальные кровати',
		'single-bed': 'Односпальная кровать',
		'non-smoking': 'Номер для некурящих',
		'private-bathroom': 'Собственная ванная комната',
		'shared-bathroom': 'Общая ванная комната',
		'nomeal': 'Без питания',
		'breakfast': 'Завтрак',
		'breakfast-buffet': 'Завтрак «шведский стол»',
		'half-board': 'Полупансион',
		'full-board': 'Полный пансион',
		'all-inclusive': 'Всё включено',
		'deposit': 'Оплата сейчас',
		'now': 'Оплата сейчас',
		'hotel': 'Отель',
		'cash': 'Наличные',
		'card': 'Карта',
		'visa': 'Виза',
		'mastercard': 'Mastercard',
		'not_included': 'Не включено',
		'included': 'Включено',
		'per_guest_per_stay': 'за гостя за проживание',
		'per_guest_per_night': 'за гостя за ночь',
		'per_room_per_stay': 'за номер за проживание',
		'per_room_per_night': 'за номер за ночь'
	};

	const POLICY_TITLES = {
		'add_fee': 'Дополнительные сборы',
		'check_in_check_out': 'Заселение и выезд',
		'children': 'Дети',
		'children_meal': 'Питание для детей',
		'cot': 'Детская кроватка',
		'deposit': 'Депозит',
		'extra_bed': 'Дополнительная кровать',
		'internet': 'Интернет',
		'meal': 'Питание',
		'no_show': 'Неявка',
		'parking': 'Парковка',
		'pets': 'Животные',
		'shuttle': 'Трансфер',
		'visa': 'Визовая информация'
	};

	function translateValue(value) {
		const raw = String(value == null ? '' : value).trim();
		if (!raw) return '';
		const key = raw.toLowerCase().replace(/_/g, '-');
		return HOTEL_TRANSLATIONS[key] || HOTEL_TRANSLATIONS[raw] || raw.replace(/[-_]/g, ' ');
	}

	function getPolicyTitle(key) {
		return POLICY_TITLES[key] || translateValue(key);
	}

	function getRatePaymentType(rate) {
		const paymentTypes = rate && rate.payment_options && Array.isArray(rate.payment_options.payment_types)
			? rate.payment_options.payment_types
			: [];
		return paymentTypes[0] || {};
	}

	function getRatePrice(rate) {
		const payment = getRatePaymentType(rate || {});
		return parseFloat(payment.show_amount || payment.amount || rate.price || rate.price_total || 0) || 0;
	}

	function getRateAllotmentText(rate) {
		const count = parseInt(rate && rate.allotment, 10);

		if (!Number.isFinite(count) || count <= 0 || count >= 3) return '';

		return 'Осталось ' + count + ' свободных ' + plural(count, ['номер', 'номера', 'номеров']);
	}

	function getRateCurrency(rate) {
		const payment = getRatePaymentType(rate || {});
		return payment.show_currency_code || payment.currency_code || 'USDT';
	}


	function normalizeRateForRoom(rate) {
		rate = rate || {};
		const payment = getRatePaymentType(rate);
		const price = getRatePrice(rate);
		const currency = getRateCurrency(rate);
		const cancellation = payment.cancellation_penalties || rate.cancellation_penalties || rate.cancellation_info || {};
		const amenities = [];

		if (Array.isArray(rate.amenities_data)) amenities.push.apply(amenities, rate.amenities_data);
		if (Array.isArray(rate.all_amenities)) amenities.push.apply(amenities, rate.all_amenities);
		if (Array.isArray(rate.serp_filters)) amenities.push.apply(amenities, rate.serp_filters);

		return Object.assign({}, rate, {
			book_hash: rate.book_hash || rate.hash || '',
			match_hash: rate.match_hash || '',
			room_name: rate.room_name || (rate.room_data_trans && rate.room_data_trans.main_name) || 'Номер',
			meal: rate.meal || (rate.meal_data && rate.meal_data.value) || 'nomeal',
			price: price ? String(price) : '',
			price_total: price ? String(price) : '',
			currency: currency,
			cancellation_info: cancellation,
			cancellation_penalties: cancellation,
			all_amenities: amenities.filter(Boolean)
		});
	}

	function normalizeHotelForRoomRenderer(hotel) {
		const normalized = Object.assign({}, hotel || {});
		normalized.stars = normalized.stars || normalized.star_rating || 0;
		normalized.images = normalizeImages(normalized);
		normalized.rates = Array.isArray(normalized.rates)
			? normalized.rates.map(normalizeRateForRoom)
			: [];
		return normalized;
	}

	function getRateCapacity(rate) {
		const capacity = rate && rate.rg_ext ? parseInt(rate.rg_ext.capacity || 0, 10) : 0;
		return capacity > 0 ? capacity : parseInt(getSearchParams().get('adults') || getSearchState().adults || 2, 10) || 2;
	}

	function getRateRoomInfo(rate) {
		const parts = [];
		const rg = rate && rate.rg_ext ? rate.rg_ext : {};

		if (rg.bedrooms) parts.push(rg.bedrooms + ' ' + plural(parseInt(rg.bedrooms, 10), ['спальня', 'спальни', 'спален']));
		if (rate.room_data_trans && rate.room_data_trans.bathroom) parts.push(translateValue(rate.room_data_trans.bathroom));
		if (rate.room_data_trans && rate.room_data_trans.bedding_type) parts.push(translateValue(rate.room_data_trans.bedding_type));

		return parts.join(' • ');
	}

	function getAmenityIcon(title) {
		const text = String(title || '').toLowerCase();
		if (/кондиционер|air/.test(text)) return 'Conditioiner.svg';
		if (/бар|мини-бар|питание|завтрак|meal|breakfast/.test(text)) return 'Bar.svg';
		if (/ванн|bathroom/.test(text)) return 'Bathroom.svg';
		if (/сейф|safe/.test(text)) return 'Safe.svg';
		if (/стол|desk/.test(text)) return 'Desk.svg';
		if (/питом|живот|pets/.test(text)) return 'Pets.svg';
		if (/фен|hair/.test(text)) return 'Hair.svg';
		return 'Bathroom.svg';
	}

	function getRateImages(rate) {
		const images = [];
		if (Array.isArray(rate.images)) images.push.apply(images, rate.images);
		if (Array.isArray(rate.images_ext)) {
			rate.images_ext.forEach(function (item) {
				if (item && item.url) images.push(item.url);
			});
		}
		if (rate.room_data_trans && Array.isArray(rate.room_data_trans.images)) images.push.apply(images, rate.room_data_trans.images);
		return images.map(function (src) {
			return String(src || '').trim();
		}).filter(Boolean);
	}


	function getRoomPlaceholderImage() {
		return getStaticPath('img/defualt.png');
	}

	function getRateBedText(rate) {
		rate = rate || {};
		const amenities = [];

		if (Array.isArray(rate.amenities_data)) amenities.push.apply(amenities, rate.amenities_data);
		if (Array.isArray(rate.all_amenities)) amenities.push.apply(amenities, rate.all_amenities);
		if (Array.isArray(rate.room_amenities)) amenities.push.apply(amenities, rate.room_amenities);

		for (let i = 0; i < amenities.length; i += 1) {
			const raw = String(amenities[i] || '').toLowerCase();
			if (raw.indexOf('bed') !== -1 || raw.indexOf('кровать') !== -1) {
				return translateValue(amenities[i]);
			}
		}

		const bedding = rate.rg_ext && parseInt(rate.rg_ext.bedding, 10);
		if (bedding === 1) return 'Кровать king-size';
		if (bedding === 2) return 'Односпальная кровать';
		if (bedding === 3) return 'Двуспальная кровать';
		if (bedding === 4) return 'Две односпальные кровати';

		if (rate.room_data_trans && rate.room_data_trans.bedding_type) {
			return translateValue(rate.room_data_trans.bedding_type);
		}

		return 'Тип кровати уточняется';
	}


	function getBedIconSvg() {
		return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.51622 7.03437V6.25961C2.51649 5.9809 2.61334 5.7137 2.78554 5.51662C2.95773 5.31955 3.1912 5.2087 3.43472 5.2084H5.38301C5.62653 5.2087 5.86 5.31955 6.03219 5.51662C6.20439 5.7137 6.30124 5.9809 6.30151 6.25961V7.03437H6.89916C6.98413 7.03436 7.06889 7.04399 7.1522 7.06312V5.57682C7.1518 5.15875 7.0065 4.75794 6.7482 4.46233C6.48989 4.16671 6.13968 4.00045 5.77439 4H3.04328C2.678 4.00047 2.3278 4.16674 2.06951 4.46235C1.81122 4.75796 1.66593 5.15876 1.66553 5.57682V7.06312C1.74884 7.04399 1.8336 7.03436 1.91857 7.03437H2.51622Z" fill="black"/><path d="M3.43472 5.62888C3.28861 5.62906 3.14853 5.69557 3.04521 5.81382C2.9419 5.93206 2.88378 6.09238 2.88362 6.25961V7.03437H5.93404V6.25961C5.93388 6.09238 5.87577 5.93206 5.77245 5.81382C5.66914 5.69557 5.52905 5.62906 5.38294 5.62888H3.43472ZM1.78583 11.2638H2.73673V12.1546H1.78583V11.2638ZM6.08093 11.2638H7.03183V12.1546H6.08093V11.2638ZM6.8991 7.45485H1.9185C1.67498 7.45516 1.44151 7.56601 1.26931 7.76308C1.09712 7.96016 1.00027 8.22736 1 8.50607V9.7299H7.81493V8.50607C7.81493 8.4868 7.81553 8.46784 7.81619 8.44873C7.80311 8.18037 7.70082 7.92791 7.5303 7.74311C7.35977 7.55831 7.13394 7.45518 6.8991 7.45485ZM1 10.1504H7.81493V10.8433H1V10.1504ZM8.84778 7.06312C8.93109 7.04399 9.01585 7.03436 9.10082 7.03437H9.69848V6.25961C9.69875 5.9809 9.7956 5.7137 9.9678 5.51662C10.14 5.31955 10.3735 5.2087 10.617 5.2084H12.5653C12.8088 5.2087 13.0423 5.31955 13.2144 5.51662C13.3866 5.7137 13.4835 5.9809 13.4838 6.25961V7.03437H14.0814C14.1664 7.03436 14.2512 7.04399 14.3345 7.06312V5.57682C14.3341 5.15876 14.1888 4.75796 13.9305 4.46235C13.6722 4.16674 13.322 4.00047 12.9567 4H10.2255C9.86026 4.00047 9.51006 4.16674 9.25177 4.46235C8.99348 4.75796 8.84819 5.15876 8.84778 5.57682V7.06312Z" fill="black"/><path d="M10.617 5.62891C10.4709 5.62909 10.3308 5.6956 10.2275 5.81384C10.1242 5.93209 10.0661 6.09241 10.0659 6.25963V7.03439H13.1167V6.25963C13.1165 6.09241 13.0584 5.93209 12.9551 5.81384C12.8518 5.6956 12.7117 5.62909 12.5656 5.62891H10.617ZM8.96838 11.2639H9.91928V12.1547H8.96838V11.2639ZM13.2636 11.2639H14.2144V12.1547H13.2636V11.2639ZM8.18262 10.1504H15.0002V10.8434H8.18262V10.1504ZM14.0817 7.45488H9.10112C8.8576 7.45518 8.62413 7.56603 8.45193 7.76311C8.27974 7.96018 8.18288 8.22739 8.18262 8.50609V9.72993H15.0002V8.50609C14.9999 8.22739 14.9031 7.96018 14.7309 7.76311C14.5587 7.56603 14.3252 7.45518 14.0817 7.45488Z" fill="black"/></svg>';
	}

	function getMealIconSvg() {
		return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.18308 2.00012C6.98915 2.00012 6.83236 2.18144 6.83236 2.4053H6.82947V5.64769C6.82947 5.75518 6.79221 5.85827 6.72587 5.93428C6.65954 6.01029 6.56957 6.05299 6.47576 6.05299C6.38195 6.05299 6.29198 6.01029 6.22565 5.93428C6.15932 5.85827 6.12205 5.75518 6.12205 5.64769V2.4053H6.11937C6.11937 2.18144 5.96217 2.00012 5.76845 2.00012C5.57452 2.00012 5.41752 2.18144 5.41752 2.4053H5.41484V5.64769C5.41484 5.75518 5.37757 5.85827 5.31124 5.93428C5.24491 6.01029 5.15494 6.05299 5.06113 6.05299C4.96732 6.05299 4.87735 6.01029 4.81102 5.93428C4.74469 5.85827 4.70742 5.75518 4.70742 5.64769V2.4053C4.70742 2.18144 4.55022 2.00012 4.3567 2.00012C4.16277 2.00012 4.00557 2.18144 4.00557 2.4053H4V6.45781C4 6.95637 4.43654 7.38472 5.06103 7.57241V12.5367C5.06419 12.7493 5.14011 12.9519 5.27241 13.1009C5.40471 13.2499 5.58282 13.3335 5.76834 13.3335C5.95387 13.3335 6.13197 13.2499 6.26427 13.1009C6.39658 12.9519 6.47249 12.7493 6.47566 12.5367V7.57241C7.10014 7.38472 7.53668 6.95637 7.53668 6.45781V2.4053H7.534C7.534 2.18144 7.3768 2.00012 7.18308 2.00012ZM10.8966 2.00012C9.62697 2.00012 8.59792 4.54018 8.59792 7.67359C8.59792 7.94875 8.60576 8.21943 8.62123 8.48419H9.65894V12.5362C9.66211 12.7488 9.73803 12.9514 9.87033 13.1004C10.0026 13.2495 10.1807 13.333 10.3663 13.333C10.5518 13.333 10.7299 13.2495 10.8622 13.1004C10.9945 12.9514 11.0704 12.7488 11.0736 12.5362V2.01667C11.0151 2.00566 10.9559 2.00012 10.8966 2.00012Z" fill="black"/></svg>';
	}

	function getCalendarIconSvg() {
		return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.3335 1.33337V3.33337" stroke="#1D1D20" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.6665 1.33337V3.33337" stroke="#1D1D20" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.3335 6.06006H13.6668" stroke="#1D1D20" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 5.66671V11.3334C14 13.3334 13 14.6667 10.6667 14.6667H5.33333C3 14.6667 2 13.3334 2 11.3334V5.66671C2 3.66671 3 2.33337 5.33333 2.33337H10.6667C13 2.33337 14 3.66671 14 5.66671Z" stroke="#1D1D20" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	}

	function getRoomGroupKey(rate) {
		return String((rate && rate.room_name) || (rate && rate.room_data_trans && rate.room_data_trans.main_name) || 'Номер').trim().toLowerCase();
	}

	function groupRatesByRoomName(rates) {
		const map = {};
		const groups = [];

		(Array.isArray(rates) ? rates : []).forEach(function (rate, index) {
			const normalized = normalizeRateForRoom(rate || {});
			normalized.__rateIndex = index;
			const key = getRoomGroupKey(normalized);

			if (!map[key]) {
				map[key] = {
					name: normalized.room_name || 'Номер',
					rates: [],
					firstRate: normalized
				};
				groups.push(map[key]);
			}

			map[key].rates.push(normalized);
		});

		return groups;
	}

	function getPaymentIconSvg() {
		return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.3335 8.40662H12.6668" stroke="#1D1D20" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.6668 6.85337V11.62C12.6468 13.52 12.1268 14 10.1468 14H3.85352C1.84018 14 1.3335 13.5 1.3335 11.5134V6.85337C1.3335 5.05337 1.7535 4.47337 3.3335 4.38003C3.4935 4.37337 3.66685 4.3667 3.85352 4.3667H10.1468C12.1601 4.3667 12.6668 4.8667 12.6668 6.85337Z" stroke="#1D1D20" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.6668 4.48667V9.14667C14.6668 10.9467 14.2468 11.5267 12.6668 11.62V6.85333C12.6668 4.86667 12.1601 4.36667 10.1468 4.36667H3.85352C3.66685 4.36667 3.4935 4.37333 3.3335 4.38C3.3535 2.48 3.87352 2 5.85352 2H12.1468C14.1601 2 14.6668 2.5 14.6668 4.48667Z" stroke="#1D1D20" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 11.8733H4.64665" stroke="#1D1D20" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.07324 11.8733H8.36658" stroke="#1D1D20" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	}

	function isMealIncluded(rate) {
		const meal = String((rate && (rate.meal || (rate.meal_data && rate.meal_data.value))) || '').toLowerCase();
		if (!meal || meal === 'nomeal' || meal === 'no-meal' || meal === 'none') return false;
		return true;
	}

	function renderRateAmenityItems(rate) {
		const items = (rate.all_amenities || rate.amenities_data || rate.serp_filters || []).filter(Boolean);
		const unique = [];

		items.forEach(function (item) {
			const title = translateValue(item);
			if (title && unique.indexOf(title) === -1) unique.push(title);
		});

		if (!unique.length) unique.push(translateValue(rate.meal || 'nomeal'));

		return unique.slice(0, 8).map(function (title, index) {
			return '' +
				'<div class="room-main__dop-item' + (index > 5 ? ' hide' : '') + '">' +
					'<p>' + escapeHtml(title) + '</p>' +
				'</div>';
		}).join('');
	}

	function hasHiddenRateAmenities(rate) {
		const items = (rate.all_amenities || rate.amenities_data || rate.serp_filters || []).filter(Boolean);
		const unique = [];

		items.forEach(function (item) {
			const title = translateValue(item);
			if (title && unique.indexOf(title) === -1) unique.push(title);
		});

		if (!unique.length) unique.push(translateValue(rate.meal || 'nomeal'));

		return unique.slice(0, 8).length > 6;
	}

	function fixRoomDopMoreButtons(root) {
		qsa('.room-item', root || document).forEach(function (room) {
			const dop = qs('.room-main__dop', room);
			const more = qs('.room-main__dop-more', room);
			if (!dop || !more) return;

			const hiddenItems = qsa('.room-main__dop-item.hide', dop);
			more.style.display = hiddenItems.length ? '' : 'none';
		});
	}

	function renderFallbackRooms(hotel) {
		const list = qs('.room-list');
		if (!list) return;

		const rates = Array.isArray(hotel.rates) ? hotel.rates.map(normalizeRateForRoom) : [];
		const groups = groupRatesByRoomName(rates);

		if (!groups.length) {
			list.innerHTML = '<p class="room-empty">Нет доступных номеров на выбранные даты.</p>';
			return;
		}

		const nights = getNights();
		const guests = getGuestText();

		list.innerHTML = groups.map(function (group, groupIndex) {
			const mainRate = group.firstRate || group.rates[0] || {};
			const allotmentText = getRateAllotmentText(mainRate);
			const capacity = getRateCapacity(mainRate);
			const roomInfo = getRateRoomInfo(mainRate);
			const roomImages = getRateImages(mainRate);
			const roomPhotoHtml = '' +
				'<div class="room-main__photo' + (roomImages.length ? ' js-room-gallery-open' : '') + '" data-gallery-index="' + groupIndex + '">' +
					'<img src="' + escapeHtml(roomImages[0] || getRoomPlaceholderImage()) + '" class="room-main__preview" alt="' + escapeHtml(group.name || '') + '">' +
					(roomImages.length ? '<div class="room-main__counter"><img src="' + escapeHtml(getStaticPath('images/icon/img.svg')) + '" alt=""><p>' + roomImages.length + ' фото</p></div>' : '') +
				'</div>';

			const rateSlides = group.rates.map(function (rate) {
				const price = getRatePrice(rate);
				const currency = getRateCurrency(rate);
				const mealText = translateValue(rate.meal || (rate.meal_data && rate.meal_data.value) || 'nomeal');
				const cancellationText = getCancellationText(rate);
				const paymentType = translateValue((getRatePaymentType(rate).type || 'deposit'));
				const bedText = getRateBedText(rate);
				const mealActiveClass = isMealIncluded(rate) ? ' active' : '';
				const rateIndex = Number.isFinite(rate.__rateIndex) ? rate.__rateIndex : 0;

				return '' +
					'<div class="room-grid__item swiper-slide">' +
						'<div class="room-conditions">' +
							'<div class="room-conditions__item"><div class="room-conditions__icon">' + getBedIconSvg() + '</div><p class="room-conditions__title">' + escapeHtml(bedText) + '</p></div>' +
							'<div class="room-conditions__item' + mealActiveClass + '"><div class="room-conditions__icon">' + getMealIconSvg() + '</div><p class="room-conditions__title">' + escapeHtml(mealText) + '</p></div>' +
							'<div class="room-conditions__item active"><div class="room-conditions__icon">' + getCalendarIconSvg() + '</div><p class="room-conditions__title">' + escapeHtml(cancellationText) + '</p></div>' +
							'<div class="room-conditions__item"><div class="room-conditions__icon">' + getPaymentIconSvg() + '</div><p class="room-conditions__title">' + escapeHtml(paymentType) + '</p></div>' +
						'</div>' +
						'<div class="room-price">' +
							'<p class="room-price__title">' + escapeHtml(formatMoney(price, currency)) + '</p>' +
							'<p class="room-price__person">за ' + nights + ' ' + plural(nights, ['ночь', 'ночи', 'ночей']) + ', для ' + escapeHtml(guests) + '</p>' +
							'<p class="room-price__nalog">' + escapeHtml(getTaxText(rate)) + '</p>' +
								'<p class="room-price__nalog-info">' + escapeHtml(ROOM_PRICE_TAX_INFO_TEXT) + '</p>' +
							'<a href="#" class="room-price__add" data-hotel-id="' + escapeHtml(hotel.hid || hotel.id || getHotelId()) + '" data-hotel-name="' + escapeHtml(hotel.name || '') + '" data-book-hash="' + escapeHtml(getRateHash(rate)) + '" data-rate-index="' + rateIndex + '" data-room-name="' + escapeHtml(rate.room_name || '') + '" data-price="' + escapeHtml(String(price || '')) + '">Забронировать</a>' +
						'</div>' +
					'</div>';
			}).join('');

			return '' +
				'<div class="room-item">' +
					'<div class="room-main">' +
						(allotmentText ? '<p class="room-main__alert">' + escapeHtml(allotmentText) + '</p>' : '') +
						roomPhotoHtml +
						'<p class="room-main__title">' + escapeHtml(group.name || 'Номер') + '</p>' +
						'<p class="room-main__person">Вместимость до ' + capacity + ' ' + plural(capacity, ['места', 'мест', 'мест']) + '</p>' +
						(roomInfo ? '<p class="room-main__square">' + escapeHtml(roomInfo) + '</p>' : '') +
						'<div class="room-main__dop">' + renderRateAmenityItems(mainRate) + '</div>' +
						(hasHiddenRateAmenities(mainRate) ? '<a href="#" class="room-main__dop-more">Еще</a>' : '<a href="#" class="room-main__dop-more" style="display:none">Еще</a>') +
					'</div>' +
					'<div class="room-grid">' +
						'<div class="swiper-wrapper">' + rateSlides + '</div>' +
					'</div>' +
				'</div>';
		}).join('');
	}


	function renderSingleHotelRoomsOnly(hotel) {
		renderFallbackRooms(hotel);
		bindRoomBookingButtons(hotel);
		updateRenderedRoomExtraInfo(hotel);
		fixRoomDopMoreButtons(qs('.room-list') || document);
	}

	window.renderSingleHotelRooms = renderSingleHotelRoomsOnly;

	function formatMoney(value, currency) {
		const number = parseFloat(value || 0);
		if (!Number.isFinite(number) || number <= 0) return 'Цена по запросу';
		return number.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (currency || 'USDT');
	}

	function formatCancellationDateUtc(value) {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';

		const pad = function (num) {
			return String(num).padStart(2, '0');
		};

		return pad(date.getUTCDate()) + '.' +
			pad(date.getUTCMonth() + 1) + '.' +
			date.getUTCFullYear() + ' ' +
			pad(date.getUTCHours()) + ':' +
			pad(date.getUTCMinutes()) + ' UTC+0';
	}

	function getCancellationText(rate) {
		const payment = getRatePaymentType(rate || {});
		const penalties = payment.cancellation_penalties || rate.cancellation_penalties || {};
		if (penalties.free_cancellation_before) {
			const cancellationDate = formatCancellationDateUtc(penalties.free_cancellation_before);
			return cancellationDate ? 'Бесплатная отмена до: ' + cancellationDate : 'Бесплатная отмена доступна';
		}
		if (Array.isArray(penalties.policies) && penalties.policies.length) return 'Условия отмены указаны в тарифе';
		return 'Условия отмены уточняются';
	}


	function getTaxText(rate) {
		const payment = getRatePaymentType(rate || {});
		const vat = payment.vat_data || rate.vat_data || null;
		const tax = payment.tax_data || rate.tax_data || null;
		const currency = getRateCurrency(rate || {});
		// ETG: налог разделяется по included_by_supplier — включён в цену vs оплата при заселении.
		const included = [];   // включено в стоимость
		const atProperty = []; // оплачивается при заселении

		if (vat && typeof vat === 'object') {
			const vatAmount = parseFloat(vat.amount || 0);
			if (vat.included === true) {
				included.push('НДС');
			} else if (vat.applied === true || vatAmount > 0) {
				atProperty.push('НДС: ' + formatMoney(vatAmount, vat.currency_code || currency));
			}
		}

		if (tax && typeof tax === 'object' && Array.isArray(tax.taxes)) {
			tax.taxes.forEach(function (item) {
				const amount = parseFloat(item.amount || item.price || 0);
				if (!(amount > 0)) return;
				const title = translateValue(item.name || item.type || item.title || 'Сбор');
				const money = formatMoney(amount, item.currency_code || currency);
				if (item.included_by_supplier === true) {
					included.push(title + ' (' + money + ')');
				} else {
					atProperty.push(title + ': ' + money);
				}
			});
		} else if (tax && typeof tax === 'object') {
			Object.keys(tax).forEach(function (key) {
				const value = tax[key];
				if (value == null || value === '' || (typeof value === 'object' && !Object.keys(value).length)) return;
				if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
					const amount = parseFloat(value);
					if (amount > 0) atProperty.push(translateValue(key) + ': ' + formatMoney(amount, currency));
				} else if (typeof value === 'string') {
					atProperty.push(translateValue(key) + ': ' + translateValue(value));
				}
			});
		}

		const lines = [];
		if (included.length) lines.push('Включено в стоимость: ' + included.join(', ') + '.');
		if (atProperty.length) lines.push('Оплачивается при заселении (в валюте отеля): ' + atProperty.join(', ') + '.');
		if (lines.length) return lines.join(' ');
		return 'Налоги и сборы включены в стоимость или не применяются.';
	}

	function updateRenderedRoomExtraInfo(hotel) {
		const rates = Array.isArray(hotel.rates) ? hotel.rates.map(normalizeRateForRoom) : [];
		if (!rates.length) return;

		qsa('.room-grid__item').forEach(function (item, index) {
			qsa('.room-price__tag', item).forEach(function (node) {
				node.textContent = '';
				node.style.display = 'none';
			});

			const btn = qs('.room-price__add', item);
			let rateIndex = btn ? parseInt(btn.getAttribute('data-rate-index'), 10) : NaN;
			if (!Number.isFinite(rateIndex)) rateIndex = index;

			const rate = rates[rateIndex];
			if (!rate) return;

			const conditions = qs('.room-conditions', item);
			if (conditions) {
				const conditionItems = qsa('.room-conditions__item', conditions);
				let bedNode = qsa('.room-conditions__title', conditions).find(function (node) {
					return /кровать|king|queen|bed|спальн|односпальн|двуспальн/i.test(node.textContent || '');
				});

				if (!bedNode) {
					conditions.insertAdjacentHTML('afterbegin', '<div class="room-conditions__item"><div class="room-conditions__icon"><img src="' + escapeHtml(getStaticPath('images/room/icon/Beds.svg')) + '" alt=""></div><p class="room-conditions__title"></p></div>');
					bedNode = qs('.room-conditions__item:first-child .room-conditions__title', conditions);
				}

				if (bedNode) {
					bedNode.textContent = getRateBedText(rate);
					const bedItem = bedNode.closest('.room-conditions__item');
					const bedIcon = bedItem ? qs('.room-conditions__icon', bedItem) : null;
					if (bedIcon && !bedIcon.querySelector('svg,img')) bedIcon.innerHTML = getBedIconSvg();
				}

				const mealNode = qsa('.room-conditions__title', conditions).find(function (node) {
					return /питани|завтрак|полупансион|пансион|всё включено|meal|breakfast/i.test(node.textContent || '');
				});

				if (mealNode) {
					mealNode.textContent = translateValue(rate.meal || (rate.meal_data && rate.meal_data.value) || 'nomeal');
					const mealItem = mealNode.closest('.room-conditions__item');
					if (mealItem) mealItem.classList.toggle('active', isMealIncluded(rate));
				}

				const paymentNode = qsa('.room-conditions__title', conditions).find(function (node) {
					return /оплата/i.test(node.textContent || '');
				});

				if (paymentNode) {
					const paymentIcon = qs('.room-conditions__icon', paymentNode.closest('.room-conditions__item'));
					if (paymentIcon && !paymentIcon.querySelector('svg,img')) paymentIcon.innerHTML = getPaymentIconSvg();
				}
			}

			let cancellationNode = qsa('.room-conditions__title', item).find(function (node) {
				return /отмен|условия отмены/i.test(node.textContent || '');
			});

			if (!cancellationNode) {
				if (conditions) {
					conditions.insertAdjacentHTML('beforeend', '<div class="room-conditions__item active"><div class="room-conditions__icon"><img src="' + escapeHtml(getStaticPath('images/services/Calendar.svg')) + '" alt=""></div><p class="room-conditions__title"></p></div>');
					cancellationNode = qs('.room-conditions__item:last-child .room-conditions__title', conditions);
				}
			}

			if (cancellationNode) {
				cancellationNode.textContent = getCancellationText(rate);
			}

			let taxNode = qs('.room-price__nalog', item);
			const roomPrice = qs('.room-price', item);
			if (!taxNode && roomPrice) {
				const addBtn = qs('.room-price__add', roomPrice);
				const html = '<p class="room-price__nalog"></p>';
				if (addBtn) addBtn.insertAdjacentHTML('beforebegin', html);
				else roomPrice.insertAdjacentHTML('beforeend', html);
				taxNode = qs('.room-price__nalog', roomPrice);
			}

			if (taxNode) {
				taxNode.textContent = getTaxText(rate);
			}

			let taxInfoNode = qs('.room-price__nalog-info', item);
			if (!taxInfoNode && roomPrice) {
				const addBtn = qs('.room-price__add', roomPrice);
				const html = '<p class="room-price__nalog-info"></p>';
				if (addBtn) addBtn.insertAdjacentHTML('beforebegin', html);
				else roomPrice.insertAdjacentHTML('beforeend', html);
				taxInfoNode = qs('.room-price__nalog-info', roomPrice);
			}

			if (taxInfoNode) {
				taxInfoNode.textContent = ROOM_PRICE_TAX_INFO_TEXT;
			}

			const preview = qs('.room-main__preview', item.closest('.room-item'));
			if (preview && !String(preview.getAttribute('src') || '').trim()) {
				preview.setAttribute('src', getRoomPlaceholderImage());
			}
		});
	}

	function buildPlainObjectText(obj) {
		if (!obj || typeof obj !== 'object') return translateValue(obj);
		return Object.keys(obj).map(function (key) {
			const value = obj[key];
			if (value === null || value === '' || value === 'unspecified') return '';
			if (typeof value === 'object') return getPolicyTitle(key) + ': ' + buildPlainObjectText(value);
			return getPolicyTitle(key) + ': ' + translateValue(value);
		}).filter(Boolean).join(', ');
	}
	function getAmenityGroups(hotel) {
		if (Array.isArray(hotel.amenity_groups)) {
			return hotel.amenity_groups.map(function (group) {
				return {
					title: group.group_name || group.title || 'Удобства',
					amenities: Array.isArray(group.amenities) ? group.amenities : []
				};
			}).filter(function (group) {
				return group.amenities.length;
			});
		}

		if (Array.isArray(hotel.amenities_groups)) {
			return hotel.amenities_groups.map(function (group) {
				return {
					title: group.group_name || group.title || 'Удобства',
					amenities: Array.isArray(group.amenities) ? group.amenities : []
				};
			}).filter(function (group) {
				return group.amenities.length;
			});
		}

		if (typeof hotel.amenities === 'string') {
			const list = hotel.amenities.split(',').map(function (item) {
				return item.trim();
			}).filter(Boolean);

			return list.length ? [{ title: 'Удобства', amenities: list }] : [];
		}

		if (Array.isArray(hotel.amenities)) {
			return hotel.amenities.length ? [{ title: 'Удобства', amenities: hotel.amenities }] : [];
		}

		return [];
	}

	function getAmenityList(hotel) {
		const groups = getAmenityGroups(hotel);
		let list = [];

		groups.forEach(function (group) {
			list = list.concat(group.amenities || []);
		});

		return list.filter(Boolean);
	}

	function getPopularAmenities(hotel) {
		const list = getAmenityList(hotel);
		const lower = list.map(function (item) {
			return String(item).toLowerCase();
		});

		const popular = [];

		function addIf(keys, title, icon) {
			const found = lower.some(function (item) {
				return keys.some(function (key) {
					return item.indexOf(key) !== -1;
				});
			});

			if (found) {
				popular.push({
					title: title,
					icon: icon
				});
			}
		}

		addIf(['wi-fi', 'wifi', 'интернет', 'доступ в интернет'], 'Бесплатный интернет', 'Wifi.svg');
		addIf(['ресторан', 'бар', 'питание', 'завтрак'], 'Бар или ресторан', 'Lunch.svg');
		addIf(['дет', 'семейн'], 'Подходит для детей', 'Kid.svg');
		addIf(['конференц', 'бизнес'], 'Конференц-зал', 'Desk.svg');
		addIf(['бассейн', 'pool'], 'Бассейн', 'Pool.svg');

		if (popular.length) return popular.slice(0, 5);

		return list.slice(0, 5).map(function (item) {
			return {
				title: item,
				icon: 'Star.svg'
			};
		});
	}

	function renderStayDates(hotel) {
		const params = getSearchParams();
		const checkin = params.get('checkin');
		const checkout = params.get('checkout');

		const dateItems = qsa('.single-date__item');

		if (dateItems[0]) {
			setText('b', formatDateRu(checkin), dateItems[0]);
			setText('p:last-child', formatTime(hotel.check_in || hotel.check_in_time, 'с ') || '', dateItems[0]);
		}

		if (dateItems[1]) {
			setText('b', formatDateRu(checkout), dateItems[1]);
			setText('p:last-child', formatTime(hotel.check_out || hotel.check_out_time, 'до ') || '', dateItems[1]);
		}

		const info = qs('.room-selection__info');
		if (info) {
			const nights = getNights();
			info.textContent = 'На ' + nights + ' ' + plural(nights, ['ночь', 'ночи', 'ночей']) + ', для ' + getGuestText();
		}
	}

	function renderPopularAmenities(hotel) {
		const block = qsa('.single-popular')[0];
		if (!block) return;

		const listNode = qs('.single-popular__list', block);
		const items = getPopularAmenities(hotel);

		if (!listNode || !items.length) {
			hideNode(block);
			return;
		}

		showNode(block);

		listNode.innerHTML = items.map(function (item) {
			return '' +
				'<div class="single-popular__item">' +
					'<div class="single-popular__item-icon">' +
						'<img src="' + escapeHtml(getStaticPath('images/single-popular/1/' + item.icon)) + '" alt="">' +
					'</div>' +
					'<p class="single-popular__item-title">' + escapeHtml(item.title) + '</p>' +
				'</div>';
		}).join('');
	}

	function renderNearbyBlockLoading() {
		const block = qsa('.single-popular')[1];
		if (!block) return;

		const listNode = qs('.single-popular__list', block);
		if (!listNode) return;

		showNode(block);

		listNode.innerHTML = '' +
			'<div class="single-popular__item single-popular__item_loading">' +
				'<div class="single-popular__item-icon">' +
					'<img src="' + escapeHtml(getStaticPath('images/single-popular/2/Museum.svg')) + '" alt="">' +
				'</div>' +
				'<p class="single-popular__item-title">Загружаем места рядом...</p>' +
			'</div>';
	}

	function renderNearbyBlock(hotel) {
		const block = qsa('.single-popular')[1];
		if (!block) return;

		const listNode = qs('.single-popular__list', block);
		if (!listNode) return;

		const places = normalizeNearbyPlaces((hotel && hotel.nearby_places) || hotel || {});
		const items = places.attractions.slice(0, 5);
		const mapBtn = qs('.single-content__btn', block);

		if (mapBtn) {
			mapBtn.classList.add('place');
			mapBtn.classList.add('js-popup');
			mapBtn.setAttribute('data-popup', 'map');
			mapBtn.setAttribute('data-map-mode', 'places');
			mapBtn.setAttribute('data-map-target', 'places');
			mapBtn.setAttribute('href', '#');

			if (items.length) {
				mapBtn.classList.remove('disabled');
			} else {
				mapBtn.classList.add('disabled');
			}
		}

		showNode(block);

		if (!items.length) {
			listNode.innerHTML = '' +
				'<div class="single-popular__item">' +
					'<div class="single-popular__item-icon">' +
						'<img src="' + escapeHtml(getStaticPath('images/single-popular/2/Museum.svg')) + '" alt="">' +
					'</div>' +
					'<p class="single-popular__item-title">Места рядом пока не найдены</p>' +
				'</div>';
			return;
		}

		listNode.innerHTML = items.map(function (item) {
			const title = item.name || item.title || '';
			const distance = item.distance_text || (item.distance_m ? item.distance_m + ' м' : '');

			return '' +
				'<div class="single-popular__item">' +
					'<div class="single-popular__item-icon">' +
						'<img src="' + escapeHtml(getStaticPath('images/single-popular/2/Museum.svg')) + '" alt="">' +
					'</div>' +
					'<p class="single-popular__item-title">' +
						escapeHtml(title) +
						(distance ? ' <span>' + escapeHtml(distance) + '</span>' : '') +
					'</p>' +
				'</div>';
		}).join('');
	}


	function formatDistanceLabel(value) {
		const number = parseFloat(value);

		if (!Number.isFinite(number) || number < 0) {
			return '';
		}

		if (number < 1) {
			return Math.round(number * 1000) + ' м';
		}

		return number.toLocaleString('ru-RU', {
			maximumFractionDigits: 1
		}) + ' км';
	}

	function getDistanceCenterText(hotel) {
		hotel = hotel || {};

		const label = getFirstValue(
			hotel.distance_center_text,
			hotel.distance_center_label
		);

		if (label) {
			return String(label).trim();
		}

		const distance = getFirstValue(
			hotel.distance_center,
			hotel.distance_center_api,
			hotel.distance_center_calculated
		);

		return formatDistanceLabel(distance);
	}

	function getSimilarNearText(item) {
		item = item || {};

		const parts = [];
		const centerText = getDistanceCenterText(item);
		const address = String(item.address || item.city || '').trim();

		if (centerText) {
			parts.push(centerText + ' от центра');
		}

		if (address) {
			parts.push(address);
		}

		return parts.join(' • ');
	}

	function getNearestMetroText(placesData) {
		const places = normalizeNearbyPlaces(placesData || {});
		const metroItems = Array.isArray(places.metro) ? places.metro.slice() : [];

		if (!metroItems.length) {
			return '';
		}

		metroItems.sort(function (a, b) {
			const distanceA = parseFloat(a.distance_km || 0) || ((parseFloat(a.distance_m || 0) || 0) / 1000);
			const distanceB = parseFloat(b.distance_km || 0) || ((parseFloat(b.distance_m || 0) || 0) / 1000);
			return distanceA - distanceB;
		});

		const item = metroItems[0] || {};
		const rawName = String(item.name || item.title || '').trim();
		const name = rawName.replace(/^метро\s+/i, '').trim();
		const distance = item.distance_text || (item.distance_m ? item.distance_m + ' м' : formatDistanceLabel(item.distance_km));

		if (!name || !distance) {
			return '';
		}

		return distance + ' от метро ' + name;
	}

	function renderBannerNearby(hotel, placesData) {
		const list = qs('.single-banner__nearby');
		if (!list) return;

		const currentHotel = hotel || window.__HOTEL_SINGLE_DATA__ || {};
		const items = [];
		const centerText = getDistanceCenterText(currentHotel);
		const metroText = getNearestMetroText(placesData || currentHotel.nearby_places);

		if (centerText) {
			items.push(centerText + ' от центра');
		}

		if (metroText) {
			items.push(metroText);
		}

		if (!items.length) {
			list.innerHTML = '';
			list.style.display = 'none';
			return;
		}

		list.style.display = '';
		list.innerHTML = items.map(function (item) {
			return '<li>' + escapeHtml(item) + '</li>';
		}).join('');
	}

	function saveNearbyPlacesForMap(data) {
		const places = normalizeNearbyPlaces(data || {});
		const groups = ['around', 'attractions', 'metro', 'stations', 'airports'];
		const used = {};
		const mapItems = [];

		groups.forEach(function (groupKey) {
			const list = Array.isArray(places[groupKey]) ? places[groupKey] : [];

			list.forEach(function (item, index) {
				const latitude = parseFloat(item.latitude || item.lat);
				const longitude = parseFloat(item.longitude || item.lng || item.lon);
				const id = 'place-' + (item.osm_id || item.id || item.name || item.title || groupKey + '-' + index);

				if (Number.isNaN(latitude) || Number.isNaN(longitude) || used[id]) return;

				used[id] = true;
				mapItems.push({
					id: id,
					name: item.name || item.title || 'Место рядом',
					latitude: latitude,
					longitude: longitude,
					link: '',
					type: item.type || groupKey || 'place',
					icon: item.icon || 'museum',
					distance_text: item.distance_text || ''
				});
			});
		});

		window.hotelSingleNearbyPlacesMapData = mapItems;
	}

	window.saveNearbyPlacesForMap = saveNearbyPlacesForMap;

	function getDescriptionItems(hotel) {
		if (Array.isArray(hotel.description_struct) && hotel.description_struct.length) {
			return hotel.description_struct.map(function (item) {
				return {
					title: item.title || 'Описание',
					text: Array.isArray(item.paragraphs) ? item.paragraphs.join('\n') : ''
				};
			}).filter(function (item) {
				return item.text;
			});
		}

		if (Array.isArray(hotel.description_items) && hotel.description_items.length) {
			return hotel.description_items;
		}

		if (hotel.description) {
			const text = String(hotel.description)
				.replace(/<b>/g, '')
				.replace(/<\/b>/g, '\n')
				.replace(/<[^>]*>/g, '')
				.trim();

			return [{
				title: 'Описание отеля',
				text: text
			}];
		}

		return [];
	}

	function renderDescriptionBlock(hotel) {
		const description = qs('.description');
		const content = qs('.description-content');

		if (!description || !content) return;

		const items = getDescriptionItems(hotel);

		if (!items.length) {
			hideNode(description);
			return;
		}

		showNode(description);

		content.innerHTML = items.map(function (item, index) {
			return '' +
				'<div class="description-item' + (index > 1 ? ' hide' : '') + '">' +
					'<div class="description-item__title">' +
						'<img src="' + escapeHtml(getStaticPath(index === 0 ? 'images/location/Park.svg' : 'images/location/Museum.svg')) + '" alt="">' +
						'<p>' + escapeHtml(item.title || 'Описание') + '</p>' +
					'</div>' +
					'<div class="description-item__info">' +
						String(item.text || '').split('\n').filter(Boolean).map(function (paragraph) {
							return '<p>' + escapeHtml(paragraph) + '</p>';
						}).join('') +
					'</div>' +
				'</div>';
		}).join('');

		if (items.length > 2) {
			content.innerHTML += '' +
				'<a href="#" class="description-more">' +
					'<i class="fa-arrow-down"></i>' +
					'<span>Развернуть</span>' +
				'</a>';
		}
	}

	function renderFactsBlock(hotel) {
		const factBlock = qs('.description-fact');
		if (!factBlock) return;

		const facts = hotel.facts || {};
		const items = [];

		if (hotel.star_certificate && hotel.star_certificate.certificate_id) {
			items.push(['Аккредитация', 'Объект прошёл классификацию']);
		}

		if (facts.year_built) items.push(['Год постройки', facts.year_built + ' год']);
		if (facts.year_renovated) items.push(['Год ремонта', facts.year_renovated + ' год']);
		if (facts.rooms_number) items.push(['Номеров', facts.rooms_number]);
		if (facts.floors_number) items.push(['Этажей', facts.floors_number]);
		if (facts.type) items.push(['Тип объекта', translateValue(facts.type)]);
		if (hotel.kind) items.push(['Тип размещения', translateValue(hotel.kind)]);
		if (hotel.region && hotel.region.name) items.push(['Регион', hotel.region.name]);
		if (hotel.region && hotel.region.country_code) items.push(['Страна', hotel.region.country_code]);
		if (hotel.postal_code && hotel.postal_code !== 'N/A') items.push(['Почтовый индекс', hotel.postal_code]);
		if (facts.electricity && Array.isArray(facts.electricity.voltage) && facts.electricity.voltage.length) {
			items.push(['Напряжение', facts.electricity.voltage.join(', ') + ' В']);
		}
		if (facts.electricity && Array.isArray(facts.electricity.sockets) && facts.electricity.sockets.length) {
			items.push(['Тип розеток', facts.electricity.sockets.join(', ').toUpperCase()]);
		}
		if (Array.isArray(hotel.serp_filters) && hotel.serp_filters.length) {
			items.push(['Особенности', hotel.serp_filters.map(translateValue).join(', ')]);
		}

		if (!items.length) {
			hideNode(factBlock);
			return;
		}

		showNode(factBlock);

		factBlock.innerHTML = '<p class="description-fact__title">Факты об отеле</p>' + items.map(function (item) {
			return '' +
				'<div class="description-fact__item">' +
					'<p class="description-fact__item-title">' + escapeHtml(item[0]) + '</p>' +
					'<p class="description-fact__item-info">' + escapeHtml(item[1]) + '</p>' +
				'</div>';
		}).join('');
	}


	function hideForcedSingleBlocks() {
		qsa('.single-banner__address a').forEach(function (node) {
			if (!node.classList.contains('js-popup')) hideNode(node);
		});
	}


	function renderServicesBlock(hotel) {
		const services = qs('.services');
		const wrap = qsa('.services-wrap')[0];
		if (!services || !wrap) return;

		const listNode = qs('.services-list', wrap);
		if (!listNode) return;

		const groups = getAmenityGroups(hotel);

		if (!groups.length) {
			hideNode(wrap);
			return;
		}

		showNode(services);
		showNode(wrap);

		const iconMap = {
			'Общее': 'Hotel.svg',
			'В номерах': 'Bed.svg',
			'Услуги и удобства': 'Service.svg',
			'Питание': 'Lunch.svg',
			'Интернет': 'Wifi.svg',
			'Бассейн и пляж': 'Pool.svg',
			'Бизнес': 'Desk.svg',
			'Красота и здоровье': 'Beauty.svg',
			'Дети': 'Kid.svg',
			'Животные': 'Pets.svg',
			'Доступность': 'Disabled.svg',
			'Санитарные меры': 'Cleaning.svg'
		};

		listNode.innerHTML = groups.map(function (group) {
			const icon = iconMap[group.title] || 'Star.svg';
			return '' +
				'<div class="services-group">' +
					'<div class="services-item">' +
						'<div class="services-item__title">' +
							'<img src="' + escapeHtml(getStaticPath('images/services/' + icon)) + '" alt="">' +
							'<p>' + escapeHtml(group.title || 'Удобства') + '</p>' +
						'</div>' +
						'<ul class="services-item__info">' +
							group.amenities.map(function (item) {
								return '<li>' + escapeHtml(translateValue(item)) + '</li>';
							}).join('') +
						'</ul>' +
					'</div>' +
				'</div>';
		}).join('');
	}


	function renderPolicyBlock(hotel) {
		const services = qs('.services');
		const wrap = qsa('.services-wrap')[1];
		if (!services || !wrap) return;

		const listNode = qs('.services-list_single', wrap) || qs('.services-list', wrap);
		if (!listNode) return;

		let html = '';

		html += '' +
			'<div class="services-from">' +
				'<div class="services-from__title">' +
					'<img src="' + escapeHtml(getStaticPath('images/services/Calendar.svg')) + '" alt="">' +
					'<p>Заселение и выезд</p>' +
				'</div>' +
				'<div class="services-from__list">' +
					'<div class="services-from__item">' +
						'<p class="services-from__item-title">Заселение</p>' +
						'<p class="services-from__item-info">' + escapeHtml(formatTime(hotel.check_in || hotel.check_in_time, 'После ') || 'Уточняется') + '</p>' +
					'</div>' +
					'<div class="services-from__item">' +
						'<p class="services-from__item-title">Выезд</p>' +
						'<p class="services-from__item-info">' + escapeHtml(formatTime(hotel.check_out || hotel.check_out_time, 'До ') || 'Уточняется') + '</p>' +
					'</div>' +
				'</div>' +
			'</div>';

		const policyText = Array.isArray(hotel.policy_struct) ? hotel.policy_struct : [];
		policyText.forEach(function (group) {
			const groupTitle = String(group.title || '').trim().toLowerCase();

			if (groupTitle === 'дополнительно' || groupTitle === 'дополнительная информация') {
				return;
			}

			const paragraphs = Array.isArray(group.paragraphs) ? group.paragraphs : [];
			if (!paragraphs.length) return;

			html += '' +
				'<div class="services-group">' +
					'<div class="services-item">' +
						'<div class="services-item__title">' +
							'<img src="' + escapeHtml(getStaticPath('images/services/Star.svg')) + '" alt="">' +
							'<p>' + escapeHtml(group.title || 'Условия') + '</p>' +
						'</div>' +
						'<ul class="services-item__info">' +
							paragraphs.map(function (item) {
								return '<li>' + escapeHtml(String(item || '').trim()) + '</li>';
							}).join('') +
						'</ul>' +
					'</div>' +
				'</div>';
		});

		const policy = hotel.metapolicy_struct || {};
		Object.keys(policy).forEach(function (key) {
			const value = policy[key];
			let rows = [];

			if (Array.isArray(value)) {
				rows = value.map(buildPlainObjectText).filter(Boolean);
			} else if (value && typeof value === 'object') {
				const text = buildPlainObjectText(value);
				if (text) rows = [text];
			}

			if (!rows.length) return;

			html += '' +
				'<div class="services-group">' +
					'<div class="services-item">' +
						'<div class="services-item__title">' +
							'<img src="' + escapeHtml(getStaticPath('images/services/Star.svg')) + '" alt="">' +
							'<p>' + escapeHtml(getPolicyTitle(key)) + '</p>' +
						'</div>' +
						'<ul class="services-item__info">' + rows.map(function (row) {
							return '<li>' + escapeHtml(row) + '</li>';
						}).join('') + '</ul>' +
					'</div>' +
				'</div>';
		});

		showNode(services);
		showNode(wrap);
		listNode.innerHTML = html;
	}


	function sanitizeHotelHtml(value) {
		const raw = String(value || '').trim();
		if (!raw) return '';

		const template = document.createElement('template');

		template.innerHTML = raw
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<p>\s*<b>/gi, '<div class="dop-info-group"><h3>')
			.replace(/<\/b>\s*\n?/gi, '</h3>')
			.replace(/<\/p>\s*<p>/gi, '</p><p>')
			.replace(/<p>\s*<ul/gi, '<ul')
			.replace(/<\/ul>\s*<\/p>/gi, '</ul>');

		const allowedTags = ['P', 'UL', 'OL', 'LI', 'B', 'STRONG', 'I', 'EM', 'BR', 'A', 'H3', 'DIV'];
		const allowedAttrs = {
			A: ['href', 'target', 'rel'],
			DIV: ['class'],
			H3: ['class']
		};

		template.content.querySelectorAll('*').forEach(function (node) {
			if (allowedTags.indexOf(node.tagName) === -1) {
				node.replaceWith(document.createTextNode(node.textContent || ''));
				return;
			}

			Array.prototype.slice.call(node.attributes).forEach(function (attr) {
				const allowed = allowedAttrs[node.tagName] || [];

				if (allowed.indexOf(attr.name) === -1) {
					node.removeAttribute(attr.name);
				}
			});

			if (node.tagName === 'A') {
				node.setAttribute('target', '_blank');
				node.setAttribute('rel', 'nofollow noopener noreferrer');
			}
		});

		return template.innerHTML;
	}

	function renderExtraInfoBlock(hotel) {
		const dop = qs('.dop');
		if (!dop) return;

		const contents = qsa('.dop-content', dop);
		const info = getFirstValue(hotel.important_info, hotel.metapolicy_extra_info, '');
		const visa = hotel.metapolicy_struct && hotel.metapolicy_struct.visa ? hotel.metapolicy_struct.visa : null;

		if (contents[0]) {
			if (info) {
				contents[0].innerHTML =
					'<h2>Дополнительная информация</h2>' +
					'<div class="dop-info">' + sanitizeHotelHtml(info) + '</div>';
			} else {
				hideNode(contents[0]);
			}
		}

		if (contents[1]) {
			if (visa && visa.visa_support && visa.visa_support !== 'unspecified') {
				contents[1].innerHTML = '<h2>Визовая информация</h2><p>' + escapeHtml(String(visa.visa_support)) + '</p>';
			} else {
				hideNode(contents[1]);
			}
		}

		if (!info && (!visa || visa.visa_support === 'unspecified')) {
			hideNode(dop);
		}
}


	function normalizeMapHotel(item, fallbackIndex) {
		item = item || {};

		const lat = parseFloat(item.latitude || item.lat);
		const lng = parseFloat(item.longitude || item.lng || item.lon);

		if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

		const params = window.location.search.replace(/^\?/, '');
		const id = String(item.id || item.hotel_id || item.hid || ('near-' + fallbackIndex));
		const link = item.link || item.url || ('/single/?id=' + encodeURIComponent(id) + (params ? '&' + params : ''));

		return {
			id: id,
			name: item.name || item.title || 'Отель',
			latitude: lat,
			longitude: lng,
			link: link,
			isCurrent: !!item.isCurrent
		};
	}

	function getNearbyHotelsForMap(hotel) {
		const source = getFirstValue(
			hotel.nearby_hotels,
			hotel.hotels_nearby,
			hotel.similar_hotels,
			hotel.similar,
			[]
		);

		if (!Array.isArray(source)) return [];

		return source.map(function (item, index) {
			return normalizeMapHotel(item, index);
		}).filter(Boolean);
	}

	function getNearbyPlaceIcon(place, groupKey) {
		const type = String((place && (place.icon || place.type)) || groupKey || '').toLowerCase();

		if (/airport|airports|аэропорт/.test(type)) return 'Airport.svg';
		if (/metro|subway|метро/.test(type)) return 'Subway.svg';
		if (/station|train|railway|вокзал|станц/.test(type)) return 'Train.svg';
		if (/park|garden|парк/.test(type)) return 'Park.svg';
		return 'Museum.svg';
	}

	function normalizeNearbyPlaces(data) {
		const places = data && (data.nearby_places || data.places || data.data || data);

		return {
			around: Array.isArray(places && places.around) ? places.around : [],
			attractions: Array.isArray(places && places.attractions) ? places.attractions : [],
			airports: Array.isArray(places && places.airports) ? places.airports : [],
			stations: Array.isArray(places && places.stations) ? places.stations : [],
			metro: Array.isArray(places && places.metro) ? places.metro : []
		};
	}

	function renderNearbyPlacesList(places) {
		const locationList = qs('.location-list');
		if (!locationList) return;

		places = normalizeNearbyPlaces(places || {});

		function renderGroup(group) {
			const items = Array.isArray(places[group.key]) ? places[group.key] : [];
			if (!items.length) return '';

			return '' +
				'<div class="location-group">' +
					'<p class="location-list__title">' + escapeHtml(group.title) + '</p>' +
					items.slice(0, group.key === 'airports' ? 4 : 12).map(function (item) {
						const title = item.name || item.title || '';
						const distance = item.distance_text || (item.distance_m ? item.distance_m + ' м' : '');
						const icon = getNearbyPlaceIcon(item, group.key);

						if (!title) return '';

						return '' +
							'<div class="location-item">' +
								'<div class="location-item__icon">' +
									'<img src="' + escapeHtml(getStaticPath('images/location/' + icon)) + '" alt="">' +
								'</div>' +
								'<p class="location-item__title">' + escapeHtml(title) + (distance ? ' <span>' + escapeHtml(distance) + '</span>' : '') + '</p>' +
							'</div>';
					}).join('') +
				'</div>';
		}

		const html = '' +
			'<div class="location-column">' +
				renderGroup({ key: 'around', title: 'Что вокруг' }) +
			'</div>' +
			'<div class="location-column">' +
				renderGroup({ key: 'attractions', title: 'Достопримечательности' }) +
			'</div>' +
			'<div class="location-column">' +
				renderGroup({ key: 'stations', title: 'Вокзалы' }) +
				renderGroup({ key: 'airports', title: 'Аэропорты' }) +
				renderGroup({ key: 'metro', title: 'Метро' }) +
			'</div>';

		if (!html.replace(/<[^>]*>/g, '').trim()) {
			hideNode(locationList);
			return;
		}

		showNode(locationList);
		locationList.innerHTML = html;
	}

	function setNearbyPlacesLoading() {
		const locationList = qs('.location-list');
		if (!locationList) return;

		showNode(locationList);
		locationList.innerHTML = '' +
			'<div class="location-group">' +
				'<p class="location-list__title">Что вокруг</p>' +
				'<div class="location-item">' +
					'<p class="location-item__title">Загружаем места рядом...</p>' +
				'</div>' +
			'</div>';
	}

	function buildNearbyPlacesUrl(hotel) {
		const url = new URL('/api/hotels/nearby-places/', window.location.origin);
		const lat = parseFloat(hotel && hotel.latitude);
		const lng = parseFloat(hotel && hotel.longitude);

		if (hotel && (hotel.id || hotel.hid || getHotelId())) {
			url.searchParams.set('hotel_id', hotel.id || hotel.hid || getHotelId());
		}
		if (!Number.isNaN(lat)) url.searchParams.set('lat', String(lat));
		if (!Number.isNaN(lng)) url.searchParams.set('lng', String(lng));
		url.searchParams.set('language', 'ru');

		return url.toString();
	}

	function fetchNearbyPlaces(hotel) {
		const lat = parseFloat(hotel && hotel.latitude);
		const lng = parseFloat(hotel && hotel.longitude);
		const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);

		if (!hasCoords && !(hotel && (hotel.id || hotel.hid || getHotelId()))) return;

		setNearbyPlacesLoading();
		renderNearbyBlockLoading();

		fetch(buildNearbyPlacesUrl(hotel), {
			method: 'GET',
			headers: {
				'Accept': 'application/json'
			},
			credentials: 'same-origin'
		})
			.then(function (response) {
				return response.json().catch(function () {
					return null;
				});
			})
			.then(function (data) {
				console.log('[hotel nearby places response]', data);
				renderNearbyPlacesList(data);
				renderNearbyBlock({ nearby_places: data && (data.nearby_places || data) });
				saveNearbyPlacesForMap(data);
				renderBannerNearby(window.__HOTEL_SINGLE_DATA__ || hotel, data && (data.nearby_places || data));
			})
			.catch(function (error) {
				console.error('[hotel nearby places]', error);
				renderNearbyPlacesList({});
				renderNearbyBlock({ nearby_places: {} });
				renderBannerNearby(window.__HOTEL_SINGLE_DATA__ || hotel, {});
			});
	}

	function renderLocationBlock(hotel) {
		const location = qs('.location');
		if (!location) return;

		const lat = parseFloat(hotel.latitude);
		const lng = parseFloat(hotel.longitude);
		const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);
		const address = getFirstValue(hotel.address, hotel.region && hotel.region.name, '');

		if (!address && !hasCoords) {
			hideNode(location);
			return;
		}

		showNode(location);
		setText('.location-info', address);

		const currentHotel = hasCoords ? {
			id: String(hotel.id || hotel.hid || getHotelId() || 'current-hotel'),
			name: hotel.name || 'Отель',
			latitude: lat,
			longitude: lng,
			link: window.location.href,
			isCurrent: true
		} : null;

		const nearbyHotels = getNearbyHotelsForMap(hotel);
		const hotelsForPopup = currentHotel ? [currentHotel].concat(nearbyHotels) : nearbyHotels;

		window.hotelSingleLocationData = {
			current: currentHotel,
			nearby: nearbyHotels,
			all: hotelsForPopup
		};

		const mapFrame = qs('.location-map-frame');

		if (mapFrame && currentHotel) {
			mapFrame.setAttribute('data-lat', currentHotel.latitude);
			mapFrame.setAttribute('data-lng', currentHotel.longitude);
			mapFrame.setAttribute('data-title', currentHotel.name);
		}

		qsa('.location-map__size').forEach(function (btn) {
			btn.setAttribute('data-map-mode', 'hotel');
		});

		qsa('.location-btn').forEach(function (btn) {
			// Не трогаем кнопку блока "места рядом".
			// Она может иметь общий класс location-btn по верстке,
			// но должна открывать режим places, а не nearby.
			if (btn.classList.contains('place') || btn.getAttribute('data-map-mode') === 'places' || btn.closest('.single-popular')) {
				btn.classList.add('place');
				btn.setAttribute('data-map-mode', 'places');
				return;
			}

			btn.classList.add('js-popup');
			btn.setAttribute('data-popup', 'map');
			btn.setAttribute('data-map-mode', 'nearby');

			if (!nearbyHotels.length) {
				btn.classList.add('disabled');
			} else {
				btn.classList.remove('disabled');
			}
		});

		const initialNearbyPlaces = getFirstValue(hotel.nearby_places, {});
		saveNearbyPlacesForMap(initialNearbyPlaces);
		window.hotelSingleLocationData.places = window.hotelSingleNearbyPlacesMapData || [];
		renderNearbyPlacesList(initialNearbyPlaces);

		document.dispatchEvent(new CustomEvent('hotel-single:location-updated', {
			detail: window.hotelSingleLocationData
		}));
	}

	function renderSimilarBlock(hotel) {
		const similar = qs('.similar');
		const listNode = qs('.similar-list');
		const items = getFirstValue(hotel.similar, hotel.similar_hotels, []);

		if (!similar || !listNode) return;

		if (!Array.isArray(items) || !items.length) {
			hideNode(similar);
			return;
		}

		showNode(similar);

		listNode.innerHTML = items.slice(0, 4).map(function (item) {
			const params = new URLSearchParams();
			const id = item.hid || item.id || item.hotel_id || '';
			const slug = item.slug || item.hotel_id || item.id || '';

			if (id) params.set('id', id);
			if (slug) params.set('slug', slug);

			const link = '/single/?' + params.toString();
			const images = Array.isArray(item.images) ? item.images : [];
			const img = images[0] || getStaticPath('images/empty-photo.png');
			const price = item.min_price || item.price || getHotelMinPrice(item);
			const nearText = getSimilarNearText(item);

			return '' +
				'<div class="similar-item">' +
					'<a href="' + escapeHtml(link) + '" class="similar-item__photo">' +
						'<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(item.name || '') + '">' +
					'</a>' +
					'<div class="similar-item__wrap">' +
						'<a href="' + escapeHtml(link) + '" class="similar-item__title">' + escapeHtml(item.name || 'Отель') + '</a>' +
					'</div>' +
					(nearText ? '<ul class="similar-item__near"><li>' + escapeHtml(nearText) + '</li></ul>' : '') +
					'<p class="similar-item__price">' + escapeHtml(formatPrice(price)) + '</p>' +
				'</div>';
		}).join('');
	}

	function fillExtendedHotelBlocks(hotel) {
		renderStayDates(hotel);
		renderPopularAmenities(hotel);
		renderNearbyBlock(hotel);
		renderDescriptionBlock(hotel);
		renderFactsBlock(hotel);
		renderServicesBlock(hotel);
		renderPolicyBlock(hotel);
		renderExtraInfoBlock(hotel);
		renderLocationBlock(hotel);
		renderBannerNearby(hotel, hotel.nearby_places);
		renderSimilarBlock(hotel);
	}

	function bindRoomBookingButtons(hotel) {
		const hotelId = hotel.hid || hotel.id || getHotelId();
		const hotelName = String(hotel.name || hotel.title || '').trim();
		const rates = Array.isArray(hotel.rates) ? hotel.rates : [];

		document.querySelectorAll('.room-price__add').forEach(function (btn, index) {
			const rate = rates[index] || {};
			const hash = getRateHash(rate);

			btn.setAttribute('data-hotel-id', hotelId);
			btn.setAttribute('data-hotel-name', hotelName);
			btn.setAttribute('data-book-hash', hash);
			btn.setAttribute('data-rate-index', String(index));

			if (rate.room_name) btn.setAttribute('data-room-name', rate.room_name);
			const ratePrice = getRatePrice(rate);
			if (ratePrice) btn.setAttribute('data-price', String(ratePrice));
		});
	}

	function fillHotelData(hotel) {
		window.__HOTEL_SINGLE_DATA__ = hotel || {};

		const hotelName = String(hotel.name || hotel.title || '').trim();

		setText('.single-banner__title', hotelName || 'Отель');
		document.title = hotelName || 'Отель';

		const starNode = qs('.single-banner__star');
		if (starNode) {
			starNode.innerHTML = renderStars(hotel.stars || hotel.star_rating);
			starNode.style.display = parseInt(hotel.stars || hotel.star_rating || 0, 10) > 0 ? '' : 'none';
		}

		const addressNode = qs('.single-banner__address span');
		if (addressNode) {
			addressNode.textContent = hotel.address || '';
		}

		qsa('.single-banner__address a').forEach(function (node) {
			node.classList.add('js-popup');
			node.setAttribute('data-popup', 'map');
			node.setAttribute('data-map-mode', 'hotel');
		});

		const priceNode = qs('.single-banner__price b');
		if (priceNode) {
			const totalPrice = getHotelMinPrice(hotel);
			const priceNight = totalPrice ? totalPrice / getNights() : 0;

			priceNode.textContent = formatPrice(priceNight);
		}

		renderGallery(hotel);
		fillExtendedHotelBlocks(hotel);
		hideForcedSingleBlocks();

		const roomHotel = normalizeHotelForRoomRenderer(hotel);

		if (Array.isArray(roomHotel.rates) && roomHotel.rates.length) {
			renderSingleHotelRoomsOnly(roomHotel);
		} else if (typeof window.renderRooms === 'function') {
			try {
				window.renderRooms(roomHotel);
				bindRoomBookingButtons(roomHotel);
				updateRenderedRoomExtraInfo(roomHotel);
			} catch (error) {
				console.error('[hotel-single renderRooms]', error);
				renderSingleHotelRoomsOnly(roomHotel);
			}
		} else {
			renderSingleHotelRoomsOnly(roomHotel);
		}

		window.__HOTEL_CURRENT_HOTEL__ = roomHotel;
		window.__HOTEL_RATES__ = Array.isArray(roomHotel.rates) ? roomHotel.rates.slice() : [];

		if (typeof window.initRoomFilters === 'function') {
			window.initRoomFilters(window.__HOTEL_RATES__, roomHotel);
		}
	}

	async function fetchHotel() {
		const hotelId = getHotelId();

		if (!hotelId) {
			throw new Error('Не передан id отеля.');
		}

		const detailUrl = buildDetailUrl(hotelId);
		const response = await fetch(detailUrl, {
			method: 'GET',
			headers: {
				'Accept': 'application/json'
			},
			credentials: 'same-origin'
		});

		const data = await response.json().catch(function () {
			return null;
		});

		// console.log('[hotel-single response]', data);

		if (!response.ok || !data) {
			throw new Error((data && (data.detail || data.message || data.error)) || 'Не удалось загрузить отель.');
		}

		return normalizeHotelResponse(data);
	}

	async function initSingleHotelPage() {
		if (!qs('.single-banner__title')) return;

		showSkeleton();

		try {
			const hotel = await fetchHotel();

			fillHotelData(hotel);
			hideSkeleton();
			showContentPage();
		} catch (error) {
			hideSkeleton();
			showContentPage();

			const title = qs('.single-banner__title');
			if (title) title.textContent = 'Отель недоступен на выбранные даты';

			const price = qs('.single-banner__price b');
			if (price) price.textContent = 'Цена недоступна';

			const gallery = qs('.single-gallery');
			if (gallery) gallery.style.display = 'none';

			hideForcedSingleBlocks();

			console.error('[hotel-single]', error);
		}
	}

	function collectBookingStateFromButton(btn) {
		const searchState = getSearchState();
		const searchParams = getSearchParams();
		const hotelId = btn.getAttribute('data-hotel-id') || getHotelId();
		const hotelName = btn.getAttribute('data-hotel-name') || '';
		const bookHash = btn.getAttribute('data-book-hash') || '';
		const roomName = btn.getAttribute('data-room-name') || '';
		const price = btn.getAttribute('data-price') || '';

		const rooms = Array.isArray(searchState.rooms) ? searchState.rooms : [];

		let adults = 0;
		let children = [];

		if (rooms.length) {
			rooms.forEach(function (room) {
				adults += parseInt(room.adults || 0, 10) || 0;

				(room.children || []).forEach(function (child) {
					const age = typeof child === 'object' ? child.age : parseInt(child, 10);
					if (!isNaN(age)) children.push(age);
				});
			});
		} else {
			adults = parseInt(searchState.adults || searchParams.get('adults') || 2, 10) || 2;
			children = searchParams.getAll('children');
		}

		return {
			hotel_id: hotelId,
			hotel_name: hotelName,

			book_hash: bookHash,
			room_name: roomName,
			price: price,

			checkin: searchParams.get('checkin') || searchState.checkin || '',
			checkout: searchParams.get('checkout') || searchState.checkout || '',
			residency: searchParams.get('residency') || searchState.residency || 'ru',

			adults: adults,
			children: children,
			children_count: children.length,

			rooms_count: rooms.length || 1,
			rooms: rooms,

			created_at: new Date().toISOString()
		};
	}

	document.addEventListener('click', async function (event) {
		const galleryTarget = event.target.closest('.single-gallery__full, .single-gallery__item, .single-gallery__all');

		if (galleryTarget) {
			event.preventDefault();
			const indexNode = galleryTarget.closest('[data-gallery-index]');
			const index = parseInt(indexNode ? indexNode.getAttribute('data-gallery-index') : '0', 10) || 0;
			if (typeof openPopup === 'function') openPopup('gallery');
			setTimeout(function () {
				if (window.hotelGalleryFull && window.hotelGalleryFull.slideTo) window.hotelGalleryFull.slideTo(index, 0);
			}, 50);
			return;
		}

		const moreBtn = event.target.closest('.description-more');

		if (moreBtn) {
			event.preventDefault();

			const content = qs('.description-content');
			if (!content) return;

			qsa('.description-item.hide', content).forEach(function (item) {
				item.classList.remove('hide');
			});

			hideNode(moreBtn);
			return;
		}

		const nearbyMapBtn = event.target.closest('.single-popular .single-content__btn.place, .single-popular .single-content__btn[data-map-mode="places"]');

		if (nearbyMapBtn) {
			event.preventDefault();
			event.stopPropagation();
			if (event.stopImmediatePropagation) event.stopImmediatePropagation();

			if ((!window.hotelSingleNearbyPlacesMapData || !window.hotelSingleNearbyPlacesMapData.length) && window.__HOTEL_SINGLE_DATA__) {
				saveNearbyPlacesForMap(window.__HOTEL_SINGLE_DATA__.nearby_places || {});
			}

			const places = window.hotelSingleNearbyPlacesMapData || [];

			window.hotelSingleLocationData = window.hotelSingleLocationData || {};
			window.hotelSingleLocationData.places = places;
			window.hotelSingleLocationData.mapMode = 'places';

			nearbyMapBtn.classList.add('js-popup');
			nearbyMapBtn.setAttribute('data-popup', 'map');
			nearbyMapBtn.setAttribute('data-map-mode', 'places');

			if (typeof window.openLocationMapPopup === 'function') {
				window.openLocationMapPopup('places');
			} else if (typeof openPopup === 'function') {
				openPopup('map');
			}

			document.dispatchEvent(new CustomEvent('hotel-single:location-updated', {
				detail: window.hotelSingleLocationData
			}));

			return;
		}

		const btn = event.target.closest('.room-price__add');
		if (!btn) return;

		event.preventDefault();

		if (btn.dataset.prebookLoading === 'true') return;

		const bookingState = collectBookingStateFromButton(btn);

		if (!bookingState.book_hash || !bookingState.hotel_id || !bookingState.checkin || !bookingState.checkout) {
			alert('Не хватает данных для бронирования. Попробуйте заново выбрать даты и номер.');
			return;
		}

		btn.dataset.prebookLoading = 'true';
		setBookingButtonLoading(btn, true);

		try {
			const prebookData = await prebookRoomFromSingle(bookingState);
			const paymentState = buildPaymentStateFromPrebook(bookingState, prebookData);

			saveLocalState(BOOKING_STORAGE_KEY, bookingState);
			saveLocalState(PAYMENT_STORAGE_KEY, paymentState);

			window.location.href = '/payment.html';
		} catch (error) {
			console.error('[single prebook]', error);
			alert(BOOKING_ERROR_MESSAGE);
			btn.dataset.prebookLoading = 'false';
			setBookingButtonLoading(btn, false);
		}
	});

	document.addEventListener('DOMContentLoaded', function () {
		bindSingleDateForm();
		initSingleHotelPage();
	});
})();
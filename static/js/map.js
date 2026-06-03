const MAP_STATIC_URL = window.STATIC_URL || '/static/';

function getMapStaticPath(path) {
	return String(MAP_STATIC_URL).replace(/\/$/, '') + '/' + String(path || '').replace(/^\//, '');
}
(g => {
	let h, a, k;
	const p = "The Google Maps JavaScript API";
	const c = "google";
	const l = "importLibrary";
	const q = "__ib__";
	const m = document;
	let b = window;

	b = b[c] || (b[c] = {});
	const d = b.maps || (b.maps = {});
	const r = new Set();
	const e = new URLSearchParams();

	const u = () =>
		h ||
		(h = new Promise(async (f, n) => {
			a = m.createElement("script");
			e.set("libraries", [...r] + "");

			for (k in g) {
				e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]);
			}

			e.set("callback", c + ".maps." + q);
			a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
			d[q] = f;
			a.onerror = () => (h = n(new Error(p + " could not load.")));
			m.head.append(a);
		}));

	if (d[l]) {
		console.warn(p + " only loads once. Ignoring:", g);
	} else {
		d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
	}
})({
	key: "AIzaSyBoN4H0HoFSuOST0j6HMXaNbAxILr12288",
	v: "weekly"
});

let map;
let markers = [];
let clusterer = null;
let AdvancedMarkerElementClass = null;

const markerNodesById = new Map();
const markerInstancesById = new Map();
const locationMaps = [];

function collectHotelsFromDom() {
	return [...document.querySelectorAll(".catalog-item")]
		.map(item => ({
			id: String(item.dataset.id || ""),
			latitude: parseFloat(item.dataset.lat),
			longitude: parseFloat(item.dataset.lng),
			link: item.dataset.link || "#",
			name: item.querySelector(".catalog-item__title-main")?.textContent.trim() || ""
		}))
		.filter(hotel => hotel.id && !Number.isNaN(hotel.latitude) && !Number.isNaN(hotel.longitude));
}

function createHotelMarkerNode(hotel) {
	const link = document.createElement("a");

	link.className = "hotel-marker";
	link.href = hotel.link;
	link.setAttribute("aria-label", hotel.name);

	link.innerHTML = `
		<span class="hotel-marker__title">
			<span>${hotel.name}</span>
		</span>
		<img class="hotel-marker__icon" src="${getMapStaticPath('images/icon/marker.svg')}" alt="">
	`;

	link.addEventListener("click", e => {
		e.stopPropagation();
	});

	return link;
}

function createLocationMarkerNode(title, isCurrent, linkUrl) {
	const marker = document.createElement(!isCurrent && linkUrl ? "a" : "div");

	marker.className = "hotel-marker" + (isCurrent ? " is-current" : "");
	marker.setAttribute("aria-label", title || "Местоположение");

	if (!isCurrent && linkUrl) {
		marker.href = linkUrl;
	}

	marker.innerHTML = `
		<span class="hotel-marker__title">
			<span>${title || "Отель"}</span>
		</span>
		<img class="hotel-marker__icon" src="${getMapStaticPath('images/icon/marker.svg')}" alt="">
	`;

	marker.addEventListener("click", e => {
		e.stopPropagation();
	});

	return marker;
}


function createPlaceMarkerNode(place) {
	const marker = document.createElement("div");
	const title = place && (place.name || place.title) ? (place.name || place.title) : "Место рядом";
	const distance = place && place.distance_text ? String(place.distance_text) : "";

	marker.className = "hotel-marker place-marker";
	marker.setAttribute("aria-label", title);
	marker.innerHTML = `
		<span class="hotel-marker__title">
			<span>${title}${distance ? " • " + distance : ""}</span>
		</span>
		<img class="hotel-marker__icon" src="${getMapStaticPath('images/icon/marker.svg')}" alt="">
	`;

	marker.addEventListener("click", e => {
		e.stopPropagation();
	});

	return marker;
}


function createClusterNode(count) {
	const el = document.createElement("div");

	el.className = "hotel-cluster";
	el.textContent = count;

	return el;
}

function clearActiveMarkers() {
	markerNodesById.forEach(node => node.classList.remove("is-active"));

	markerInstancesById.forEach(marker => {
		marker.zIndex = 1;
	});
}

function setActiveMarker(hotelId) {
	clearActiveMarkers();

	hotelId = String(hotelId || "");

	const markerNode = markerNodesById.get(hotelId);
	const marker = markerInstancesById.get(hotelId);

	if (!markerNode || !marker) return;

	markerNode.classList.add("is-active");
	marker.zIndex = 999;
}

function bindCatalogHover() {
	document.querySelectorAll(".catalog-item").forEach(item => {
		if (item.dataset.mapHoverBound === "true") return;
		item.dataset.mapHoverBound = "true";

		const hotelId = String(item.dataset.id || "");

		item.addEventListener("mouseenter", () => {
			setActiveMarker(hotelId);
		});

		item.addEventListener("mouseleave", () => {
			clearActiveMarkers();
		});
	});
}

function clearMapMarkers() {
	if (clusterer) {
		clusterer.clearMarkers();
		clusterer = null;
	}

	markers.forEach(marker => {
		marker.map = null;
	});

	markers = [];
	markerNodesById.clear();
	markerInstancesById.clear();
}

function buildClusters() {
	if (!window.markerClusterer || !map || !markers.length || !AdvancedMarkerElementClass) return;

	clusterer = new markerClusterer.MarkerClusterer({
		map,
		markers,
		renderer: {
			render({ count, position }) {
				return new AdvancedMarkerElementClass({
					position,
					content: createClusterNode(count),
					zIndex: 1000 + count
				});
			}
		}
	});
}

function showHotelsOnMap(hotels) {
	if (!map || !AdvancedMarkerElementClass) return;

	clearMapMarkers();

	if (!hotels.length) return;

	const bounds = new google.maps.LatLngBounds();

	hotels.forEach(hotel => {
		const markerNode = createHotelMarkerNode(hotel);

		const marker = new AdvancedMarkerElementClass({
			map,
			position: {
				lat: hotel.latitude,
				lng: hotel.longitude
			},
			title: hotel.name,
			content: markerNode,
			zIndex: 1
		});

		markers.push(marker);
		markerNodesById.set(hotel.id, markerNode);
		markerInstancesById.set(hotel.id, marker);

		bounds.extend({
			lat: hotel.latitude,
			lng: hotel.longitude
		});
	});

	buildClusters();

	if (hotels.length > 1) {
		map.fitBounds(bounds);
	} else {
		map.setCenter({
			lat: hotels[0].latitude,
			lng: hotels[0].longitude
		});
		map.setZoom(14);
	}
}

function refreshCatalogMap() {
	if (!map || !AdvancedMarkerElementClass) return;

	const hotels = collectHotelsFromDom();

	showHotelsOnMap(hotels);
	bindCatalogHover();
}


function normalizeHotelsForMap(hotels) {
	return (Array.isArray(hotels) ? hotels : [])
		.map(hotel => ({
			id: String(hotel.id || hotel.hid || ""),
			latitude: parseFloat(hotel.latitude),
			longitude: parseFloat(hotel.longitude),
			link: hotel.link || "#",
			name: hotel.name || ""
		}))
		.filter(hotel => hotel.id && !Number.isNaN(hotel.latitude) && !Number.isNaN(hotel.longitude));
}

function refreshCatalogMapFromHotels(hotels) {
	if (!map || !AdvancedMarkerElementClass) return;

	showHotelsOnMap(normalizeHotelsForMap(hotels));
	bindCatalogHover();
}

async function initCatalogMap() {
	const mapNode = document.getElementById("map");

	if (!mapNode) return;

	const { Map } = await google.maps.importLibrary("maps");
	const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

	AdvancedMarkerElementClass = AdvancedMarkerElement;

	map = new Map(mapNode, {
		center: {
			lat: 55.7558,
			lng: 37.6176
		},
		zoom: 11,
		mapId: "DEMO_MAP_ID"
	});

	refreshCatalogMap();
}

const singleLocationMapState = {
	ready: false,
	mapClass: null,
	markerClass: null,
	mainMap: null,
	popupMap: null,
	mainMarkers: [],
	popupMarkers: [],
	mode: "hotel"
};

function normalizeSinglePlaceForMap(item, groupKey, index) {
	if (!item) return null;

	const lat = parseFloat(item.latitude || item.lat);
	const lng = parseFloat(item.longitude || item.lng || item.lon);

	if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

	return {
		id: String('place-' + (item.osm_id || item.id || item.name || item.title || groupKey || index)),
		name: item.name || item.title || 'Место рядом',
		latitude: lat,
		longitude: lng,
		link: '',
		type: item.type || groupKey || 'place',
		icon: item.icon || 'museum',
		distance_text: item.distance_text || ''
	};
}

function flattenNearbyPlacesForMap(source) {
	const places = source && (source.nearby_places || source.places || source.data || source);
	const groups = ['around', 'attractions', 'metro', 'stations', 'airports'];
	const result = [];
	const used = new Set();

	if (Array.isArray(places)) {
		places.forEach((item, index) => {
			const normalized = normalizeSinglePlaceForMap(item, item && item.type, index);
			if (!normalized || used.has(normalized.id)) return;
			used.add(normalized.id);
			result.push(normalized);
		});
		return result;
	}

	groups.forEach(groupKey => {
		(Array.isArray(places && places[groupKey]) ? places[groupKey] : []).forEach((item, index) => {
			const normalized = normalizeSinglePlaceForMap(item, groupKey, index);
			if (!normalized || used.has(normalized.id)) return;
			used.add(normalized.id);
			result.push(normalized);
		});
	});

	return result;
}

function getSingleLocationData() {
	const data = window.hotelSingleLocationData || {};
	let places = [];

	if (Array.isArray(data.places) && data.places.length) {
		places = flattenNearbyPlacesForMap(data.places);
	}

	if (!places.length && Array.isArray(window.hotelSingleNearbyPlacesMapData) && window.hotelSingleNearbyPlacesMapData.length) {
		places = flattenNearbyPlacesForMap(window.hotelSingleNearbyPlacesMapData);
	}

	if (!places.length && window.__HOTEL_SINGLE_DATA__) {
		places = flattenNearbyPlacesForMap(window.__HOTEL_SINGLE_DATA__.nearby_places || window.__HOTEL_SINGLE_DATA__);
	}

	if (!places.length) {
		places = flattenNearbyPlacesForMap(data.nearby_places || data);
	}

	return {
		current: data.current || null,
		nearby: Array.isArray(data.nearby) ? data.nearby : [],
		all: Array.isArray(data.all) ? data.all : [],
		places: places
	};
}

function syncPlacesMapData() {
	window.hotelSingleLocationData = window.hotelSingleLocationData || {};

	if ((!window.hotelSingleNearbyPlacesMapData || !window.hotelSingleNearbyPlacesMapData.length) && window.__HOTEL_SINGLE_DATA__) {
		if (typeof window.saveNearbyPlacesForMap === 'function') {
			window.saveNearbyPlacesForMap(window.__HOTEL_SINGLE_DATA__.nearby_places || {});
		} else {
			window.hotelSingleNearbyPlacesMapData = flattenNearbyPlacesForMap(window.__HOTEL_SINGLE_DATA__.nearby_places || window.__HOTEL_SINGLE_DATA__);
		}
	}

	const places = flattenNearbyPlacesForMap(window.hotelSingleNearbyPlacesMapData || (window.__HOTEL_SINGLE_DATA__ && window.__HOTEL_SINGLE_DATA__.nearby_places) || []);
	window.hotelSingleLocationData.places = places;
	return places;
}

function clearSingleMarkers(list) {
	list.forEach(marker => {
		marker.map = null;
	});

	list.length = 0;
}

function addSingleMarker(targetMap, hotel, markerList) {
	if (!targetMap || !hotel || !singleLocationMapState.markerClass) return;

	const lat = parseFloat(hotel.latitude);
	const lng = parseFloat(hotel.longitude);

	if (Number.isNaN(lat) || Number.isNaN(lng)) return;

	const isCurrent = !!hotel.isCurrent;
	const isPlace = String(hotel.id || '').indexOf('place-') === 0 || hotel.type === 'place' || hotel.type === 'around' || hotel.type === 'attractions' || hotel.type === 'metro' || hotel.type === 'stations' || hotel.type === 'airports';
	const contentNode = isPlace
		? createPlaceMarkerNode(hotel)
		: createLocationMarkerNode(hotel.name || "Отель", isCurrent, hotel.link || "");

	const marker = new singleLocationMapState.markerClass({
		map: targetMap,
		position: {
			lat,
			lng
		},
		title: hotel.name || hotel.title || (isPlace ? "Место рядом" : "Отель"),
		content: contentNode,
		zIndex: isCurrent ? 999 : (isPlace ? 50 : 1)
	});

	markerList.push(marker);
}

function renderSingleMap(targetMap, markerList, hotels, zoom) {
	if (!targetMap || !singleLocationMapState.markerClass) return;

	clearSingleMarkers(markerList);

	hotels = (Array.isArray(hotels) ? hotels : []).filter(hotel => {
		const lat = parseFloat(hotel.latitude);
		const lng = parseFloat(hotel.longitude);

		return !Number.isNaN(lat) && !Number.isNaN(lng);
	});

	if (!hotels.length) return;

	const bounds = new google.maps.LatLngBounds();

	hotels.forEach(hotel => {
		addSingleMarker(targetMap, hotel, markerList);

		bounds.extend({
			lat: parseFloat(hotel.latitude),
			lng: parseFloat(hotel.longitude)
		});
	});

	if (hotels.length > 1) {
		targetMap.fitBounds(bounds);
	} else {
		targetMap.setCenter({
			lat: parseFloat(hotels[0].latitude),
			lng: parseFloat(hotels[0].longitude)
		});
		targetMap.setZoom(zoom || 15);
	}
}

function refreshSingleLocationMaps(mode) {
	if (mode === "places" || singleLocationMapState.mode === "places") {
		syncPlacesMapData();
	}

	const data = getSingleLocationData();

	if (mode) {
		singleLocationMapState.mode = mode;
	}

	if (singleLocationMapState.mainMap && data.current) {
		renderSingleMap(
			singleLocationMapState.mainMap,
			singleLocationMapState.mainMarkers,
			[data.current],
			15
		);
	}

	if (singleLocationMapState.popupMap) {
		let popupHotels = [];

		if (singleLocationMapState.mode === "places") {
			popupHotels = data.places.length
				? (data.current ? [data.current].concat(data.places) : data.places)
				: (data.current ? [data.current] : []);
		} else if (singleLocationMapState.mode === "nearby") {
			popupHotels = data.all.length
				? data.all
				: (data.current ? [data.current] : []);
		} else {
			popupHotels = data.current ? [data.current] : [];
		}

		renderSingleMap(
			singleLocationMapState.popupMap,
			singleLocationMapState.popupMarkers,
			popupHotels,
			singleLocationMapState.mode === "nearby" || singleLocationMapState.mode === "places" ? 13 : 15
		);
	}
}

async function initLocationMap() {
	const mainContainer = document.querySelector(".location-map-frame");
	const popupContainer = document.querySelector(".popup-map__iframe");

	if (!mainContainer && !popupContainer) return;

	const { Map } = await google.maps.importLibrary("maps");
	const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

	singleLocationMapState.mapClass = Map;
	singleLocationMapState.markerClass = AdvancedMarkerElement;
	singleLocationMapState.ready = true;

	const fallbackCoords = {
		lat: 55.755864,
		lng: 37.617698
	};

	if (mainContainer) {
		singleLocationMapState.mainMap = new Map(mainContainer, {
			center: fallbackCoords,
			zoom: 15,
			disableDefaultUI: true,
			zoomControl: true,
			mapId: "DEMO_MAP_ID"
		});
	}

	if (popupContainer) {
		singleLocationMapState.popupMap = new Map(popupContainer, {
			center: fallbackCoords,
			zoom: 15,
			disableDefaultUI: false,
			zoomControl: true,
			mapId: "DEMO_MAP_ID"
		});
	}

	refreshSingleLocationMaps("hotel");
}


async function initAllMaps() {
	await initCatalogMap();
	await initLocationMap();
}

initAllMaps();

let mapRefreshTimer = null;

function scheduleCatalogMapRefresh() {
	clearTimeout(mapRefreshTimer);

	mapRefreshTimer = setTimeout(function () {
		refreshCatalogMap();
	}, 100);
}

document.addEventListener("hotels:rendered", scheduleCatalogMapRefresh);
document.addEventListener("hotels:loaded:first-page", scheduleCatalogMapRefresh);
document.addEventListener("hotels:filtered", function (event) {
	const hotels = event.detail && Array.isArray(event.detail.hotels) ? event.detail.hotels : [];
	refreshCatalogMapFromHotels(hotels);
});

const catalogList = document.querySelector('.catalog-list');

if (catalogList) {
	const observer = new MutationObserver(function () {
		scheduleCatalogMapRefresh();
	});

	observer.observe(catalogList, {
		childList: true,
		subtree: true
	});
}

document.addEventListener("hotel-single:location-updated", function () {
	if (!singleLocationMapState.ready) return;
	refreshSingleLocationMaps(singleLocationMapState.mode || "hotel");
});

function openLocationMapPopup(mode) {
	singleLocationMapState.mode = mode || "hotel";

	if (singleLocationMapState.mode === "places") {
		syncPlacesMapData();
	}

	if (typeof openPopup === "function") {
		openPopup("map");
	} else {
		const popup = document.querySelector('.target-box[data-popup="map"], .popup[data-popup="map"], .popup.map');
		const frame = document.querySelector(".target-frame, .popup-frame");

		if (popup) {
			popup.classList.add("active", "open", "show");
		}

		if (frame) {
			frame.classList.add("active", "open", "show");
		}

		document.body.classList.add("lock", "popup-open");
	}

	setTimeout(function () {
		if (window.google && google.maps && google.maps.event && singleLocationMapState.popupMap) {
			google.maps.event.trigger(singleLocationMapState.popupMap, "resize");
		}
		refreshSingleLocationMaps(singleLocationMapState.mode);
	}, 250);
}

window.openLocationMapPopup = openLocationMapPopup;

function getMapClickMode(target) {
	if (!target || !target.closest) return '';

	// Приоритет 1: кнопка мест рядом.
	// Важно: эта кнопка иногда одновременно имеет общий класс location-btn,
	// поэтому places проверяем раньше nearby.
	const placesBtn = target.closest(
		'.single-content__btn.place, ' +
		'.single-content__btn[data-map-mode="places"], ' +
		'.single-content__btn[data-map-target="places"], ' +
		'[data-map-mode="places"], ' +
		'[data-map-target="places"]'
	);

	if (placesBtn && placesBtn.getAttribute('data-popup') !== 'date') {
		return 'places';
	}

	// Приоритет 2: карта конкретного текущего отеля.
	const hotelBtn = target.closest(
		'.single-banner__address a.map, ' +
		'.single-banner__address a[data-map-mode="hotel"], ' +
		'.location-map__size[data-map-mode="hotel"], ' +
		'[data-map-target="hotel"]'
	);

	if (hotelBtn) {
		return 'hotel';
	}

	// Приоритет 3: отели рядом. Сюда не должны попадать кнопки places.
	const nearbyBtn = target.closest('.location-btn, [data-map-mode="nearby"], [data-map-target="nearby"]');

	if (nearbyBtn) {
		if (nearbyBtn.classList.contains('place') || nearbyBtn.getAttribute('data-map-mode') === 'places' || nearbyBtn.getAttribute('data-map-target') === 'places') {
			return 'places';
		}

		return 'nearby';
	}

	return '';
}

function handleMapModeClick(event) {
	const mode = getMapClickMode(event.target);

	if (!mode) return;

	event.preventDefault();
	event.stopPropagation();
	if (event.stopImmediatePropagation) event.stopImmediatePropagation();

	if (mode === 'places') {
		syncPlacesMapData();
	}

	openLocationMapPopup(mode);
}

document.addEventListener("click", handleMapModeClick, true);

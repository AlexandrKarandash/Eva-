import requests
import logging
from django.conf import settings
from django.core.cache import cache
from .models import HotelRoomStatic, HotelStatic, HotelImage, HotelCache, City, HotelNearbyCache
from datetime import datetime
from decimal import Decimal, InvalidOperation
import re
import json
import time
import math
import hmac
import hashlib


logger = logging.getLogger(__name__)
MONEY_QUANT = Decimal("0.01")


try:
    from django.conf import settings
except ImportError:
    settings = None

class EmergingTravelService:
    DEFAULT_IMAGE = "/static/img/defualt.png" 
    
    def __init__(self):
        self.BASE_URL = str(getattr(settings, "ETG_BASE_URL", "")).rstrip("/")
        self.auth = (getattr(settings, 'ETG_KEY_ID', ''), getattr(settings, 'ETG_KEY', ''))
        self.session = requests.Session()
        self.session.auth = self.auth
        self.session.headers.update({"Content-Type": "application/json"})


    CITY_CENTER_FALLBACKS = {
        'санкт-петербург': (59.9386, 30.3141, 'RU'),
        'saint petersburg': (59.9386, 30.3141, 'RU'),
        'st petersburg': (59.9386, 30.3141, 'RU'),
        'москва': (55.7558, 37.6173, 'RU'),
        'moscow': (55.7558, 37.6173, 'RU'),
        'париж': (48.8566, 2.3522, 'FR'),
        'paris': (48.8566, 2.3522, 'FR'),
        'дубай': (25.2048, 55.2708, 'AE'),
        'dubai': (25.2048, 55.2708, 'AE'),
        'лондон': (51.5074, -0.1278, 'GB'),
        'london': (51.5074, -0.1278, 'GB'),
        'рим': (41.9028, 12.4964, 'IT'),
        'rome': (41.9028, 12.4964, 'IT'),
        'стамбул': (41.0082, 28.9784, 'TR'),
        'istanbul': (41.0082, 28.9784, 'TR'),
        'барселона': (41.3851, 2.1734, 'ES'),
        'barcelona': (41.3851, 2.1734, 'ES'),
        'лос-анджелес': (34.0522, -118.2437, 'US'),
        'los angeles': (34.0522, -118.2437, 'US'),
        'нью-йорк': (40.7128, -74.0060, 'US'),
        'new york': (40.7128, -74.0060, 'US'),
        'токио': (35.6762, 139.6503, 'JP'),
        'tokyo': (35.6762, 139.6503, 'JP'),
    }

    def _to_float(self, value):
        try:
            if value is None or value == '':
                return None
            if isinstance(value, str):
                value = value.strip().replace(',', '.')
                match = re.search(r'-?\d+(?:\.\d+)?', value)
                if not match:
                    return None
                value = match.group(0)
            return float(value)
        except (TypeError, ValueError):
            return None

    def _to_money_decimal(self, value):
        try:
            return Decimal(str(value)).quantize(MONEY_QUANT)
        except (InvalidOperation, TypeError, ValueError):
            return None

    def _to_money_string(self, value):
        money = self._to_money_decimal(value)
        return format(money, "f") if money is not None else None

    def _get_region_data(self, data):
        region = data.get('region') if isinstance(data, dict) else None
        return region if isinstance(region, dict) else {}

    def _get_city_name_from_data(self, data, hotel_obj=None):
        region = self._get_region_data(data)
        value = (
            region.get('name') or
            data.get('city') or
            data.get('city_name') or
            (hotel_obj.city if hotel_obj else '') or
            ''
        )
        return str(value or '').strip()

    def _get_country_code_from_data(self, data, hotel_obj=None):
        region = self._get_region_data(data)
        value = (
            region.get('country_code') or
            data.get('country_code') or
            data.get('country') or
            (hotel_obj.country_code if hotel_obj else '') or
            ''
        )
        return str(value or '').strip()[:10]

    def _extract_point_from_dict(self, data):
        if not isinstance(data, dict):
            return None, None

        lat = self._to_float(
            data.get('latitude') or
            data.get('lat') or
            data.get('center_latitude') or
            data.get('center_lat')
        )
        lng = self._to_float(
            data.get('longitude') or
            data.get('lng') or
            data.get('lon') or
            data.get('center_longitude') or
            data.get('center_lng') or
            data.get('center_lon')
        )

        if lat is not None and lng is not None:
            return lat, lng

        center = data.get('center') or data.get('coordinates') or data.get('coord')
        if isinstance(center, dict):
            lat = self._to_float(center.get('latitude') or center.get('lat'))
            lng = self._to_float(center.get('longitude') or center.get('lng') or center.get('lon'))
            if lat is not None and lng is not None:
                return lat, lng

        return None, None

    def _get_city_center_fallback(self, city_name):
        key = str(city_name or '').strip().lower()
        key = key.replace('ё', 'е')
        key = re.sub(r'\s+', ' ', key)
        return self.CITY_CENTER_FALLBACKS.get(key)

    def _get_or_update_city(self, city_name, country_code='', latitude=None, longitude=None):
        city_name = str(city_name or '').strip()
        if not city_name:
            return None

        try:
            city, _ = City.objects.get_or_create(
                name=city_name,
                defaults={
                    'country_code': country_code or None,
                    'latitude': latitude,
                    'longitude': longitude,
                }
            )

            changed = False
            if country_code and not city.country_code:
                city.country_code = country_code
                changed = True
            if latitude is not None and city.latitude is None:
                city.latitude = latitude
                changed = True
            if longitude is not None and city.longitude is None:
                city.longitude = longitude
                changed = True
            if changed:
                city.save(update_fields=['country_code', 'latitude', 'longitude'])

            return city
        except Exception as e:
            logger.warning(f'Cannot update city {city_name}: {e}')
            return None

    def _ensure_city_for_hotel_data(self, data, hotel_obj=None):
        if not isinstance(data, dict):
            return None

        city_name = self._get_city_name_from_data(data, hotel_obj=hotel_obj)
        country_code = self._get_country_code_from_data(data, hotel_obj=hotel_obj)
        region = self._get_region_data(data)

        center_lat, center_lng = self._extract_point_from_dict(region)

        if center_lat is None or center_lng is None:
            fallback = self._get_city_center_fallback(city_name)
            if fallback:
                center_lat, center_lng, fallback_country = fallback
                if not country_code:
                    country_code = fallback_country

        city = self._get_or_update_city(city_name, country_code, center_lat, center_lng)

        if city:
            data.setdefault('city', city.name)
            data.setdefault('country', city.country_code)
            data['city_center'] = {
                'name': city.name,
                'country_code': city.country_code,
                'latitude': city.latitude,
                'longitude': city.longitude,
            }

        return city

    def _get_api_distance_center_value(self, data):
        if not isinstance(data, dict):
            return None

        for key in ('distance_center', 'distance_to_center', 'center_distance'):
            if key in data and data.get(key) not in (None, ''):
                value = data.get(key)
                if isinstance(value, dict):
                    value = value.get('value') or value.get('amount') or value.get('distance')
                parsed = self._to_float(value)
                if parsed is not None:
                    return parsed

        return None

    def _enrich_distance_center(self, data, hotel_obj=None):
        if not isinstance(data, dict):
            return data

        city = self._ensure_city_for_hotel_data(data, hotel_obj=hotel_obj)
        api_distance = self._get_api_distance_center_value(data)

        if api_distance is not None:
            data['distance_center_api'] = round(api_distance, 3)
            data['distance_center'] = round(api_distance, 3)
            data['distance_center_text'] = self._format_distance_label(api_distance)
            data['distance_center_label'] = data['distance_center_text']
            data['distance_center_source'] = 'api'
            return data

        hotel_lat = self._to_float(data.get('latitude') or (hotel_obj.latitude if hotel_obj else None))
        hotel_lng = self._to_float(data.get('longitude') or (hotel_obj.longitude if hotel_obj else None))
        center_lat = self._to_float(city.latitude if city else None)
        center_lng = self._to_float(city.longitude if city else None)

        distance = self._distance_km(hotel_lat, hotel_lng, center_lat, center_lng)

        if distance is not None:
            data['distance_center_calculated'] = round(distance, 3)
            data['distance_center'] = round(distance, 3)
            data['distance_center_text'] = self._format_distance_label(distance)
            data['distance_center_label'] = data['distance_center_text']
            data['distance_center_source'] = 'calculated'
        else:
            data.setdefault('distance_center', None)
            data.setdefault('distance_center_text', '')
            data.setdefault('distance_center_label', '')
            data.setdefault('distance_center_source', '')

        return data

    def _fallback_hotel_info_from_db(self, hotel_obj):
        db_images = [i.url_template for i in hotel_obj.images.all()]

        data = {
            "id": hotel_obj.hotel_id,
            "hid": hotel_obj.hid,
            "name": hotel_obj.name,
            "kind": hotel_obj.kind or "hotel",
            "address": hotel_obj.address,
            "description": hotel_obj.description or "",
            "images": db_images,
            "images_ext": [{"url": url} for url in db_images],
            "has_images": len(db_images) > 0,
            "latitude": hotel_obj.latitude,
            "longitude": hotel_obj.longitude,
            "stars": hotel_obj.star_rating or 0,
            "star_rating": hotel_obj.star_rating or 0,
            "phone": hotel_obj.phone,
            "email": hotel_obj.email,
            "check_in": hotel_obj.check_in_time,
            "check_out": hotel_obj.check_out_time,
            "check_in_time": hotel_obj.check_in_time,
            "check_out_time": hotel_obj.check_out_time,
            "city": hotel_obj.city,
            "country": hotel_obj.country_code,
            "chain": hotel_obj.hotel_chain,
            "hotel_chain": hotel_obj.hotel_chain,
            "amenities": hotel_obj.amenities_list,
            "important_info": hotel_obj.important_info,
            "metapolicy_extra_info": hotel_obj.important_info,
            "postal_code": hotel_obj.postal_code,
        }

        return self._enrich_distance_center(data, hotel_obj=hotel_obj)

    def _normalize_hotel_info_response(self, data, hotel_obj=None):
        data = dict(data or {})

        if hotel_obj:
            data.setdefault("id", hotel_obj.hotel_id)
            data.setdefault("hid", hotel_obj.hid)
            data.setdefault("name", hotel_obj.name)
            data.setdefault("address", hotel_obj.address)
            data.setdefault("latitude", hotel_obj.latitude)
            data.setdefault("longitude", hotel_obj.longitude)

        images = []
        if isinstance(data.get("images_ext"), list):
            images = [img.get("url") for img in data.get("images_ext", []) if isinstance(img, dict) and img.get("url")]
        if not images and isinstance(data.get("images"), list):
            images = data.get("images")

        images = [str(img).replace("{size}", "1024x768") for img in images if img]
        data["images"] = images
        data["has_images"] = len(images) > 0

        star_rating = data.get("star_rating")
        if star_rating is None:
            star_rating = data.get("stars")
        data["star_rating"] = star_rating or 0
        data["stars"] = star_rating or 0

        if "check_in" not in data:
            data["check_in"] = data.get("check_in_time")
        if "check_out" not in data:
            data["check_out"] = data.get("check_out_time")

        region = data.get("region") or {}
        if isinstance(region, dict):
            data.setdefault("city", region.get("name"))
            data.setdefault("country", region.get("country_code"))

        data.setdefault("important_info", data.get("metapolicy_extra_info"))
        data.setdefault("chain", data.get("hotel_chain"))

        return self._enrich_distance_center(data, hotel_obj=hotel_obj)

    def _save_hotel_info_to_db(self, hotel_obj, data):
        if not hotel_obj or not data:
            return hotel_obj

        try:
            real_hotel_id = str(data.get('id') or '').strip()

            # Если отель открыли по hid, раньше мог создаться отдельный кеш
            # с hotel_id вроде "6773002". После ответа hotel/info нужно
            # привязать запись к настоящему ETG id, чтобы single всегда открывался
            # с полными данными, а не с пустой цифровой заглушкой.
            if real_hotel_id and real_hotel_id != str(hotel_obj.hotel_id):
                existing = HotelStatic.objects.filter(hotel_id=real_hotel_id).exclude(pk=hotel_obj.pk).first()

                if existing:
                    if not existing.hid and (data.get('hid') or hotel_obj.hid):
                        existing.hid = data.get('hid') or hotel_obj.hid
                    hotel_obj = existing
                else:
                    hotel_obj.hotel_id = real_hotel_id

            hotel_obj.hid = data.get('hid') or hotel_obj.hid
            hotel_obj.kind = str(data.get('kind') or hotel_obj.kind or 'hotel').lower()
            hotel_obj.name = data.get('name') or hotel_obj.name
            hotel_obj.address = data.get('address') or hotel_obj.address
            hotel_obj.star_rating = data.get('star_rating') or data.get('stars') or 0
            hotel_obj.latitude = data.get('latitude')
            hotel_obj.longitude = data.get('longitude')
            hotel_obj.phone = (data.get('phone') or "").strip('<> ')
            hotel_obj.email = (data.get('email') or "").strip('<> ')
            hotel_obj.check_in_time = data.get('check_in_time') or data.get('check_in')
            hotel_obj.check_out_time = data.get('check_out_time') or data.get('check_out')
            hotel_obj.postal_code = data.get('postal_code')
            hotel_obj.hotel_chain = data.get('hotel_chain') or data.get('chain')

            region = data.get('region') or {}
            if isinstance(region, dict):
                hotel_obj.city = region.get('name') or hotel_obj.city
                hotel_obj.country_code = region.get('country_code') or hotel_obj.country_code

            hotel_obj.important_info = data.get('metapolicy_extra_info') or data.get('important_info')

            desc = ""
            struct = data.get('description_struct') or []
            if isinstance(struct, list) and struct:
                desc = "\n\n".join([
                    f"<b>{s.get('title')}</b>\n" + "\n".join(s.get('paragraphs', []))
                    for s in struct if isinstance(s, dict)
                ])
            hotel_obj.description = desc or data.get('description') or hotel_obj.description

            amenities = []
            for group in data.get('amenity_groups') or []:
                if isinstance(group, dict):
                    amenities.extend(group.get('amenities') or [])
            hotel_obj.amenities_list = ", ".join([str(item) for item in amenities if item])

            hotel_obj.save()
            self._ensure_city_for_hotel_data(data, hotel_obj=hotel_obj)

            images = data.get('images') or []
            if images:
                hotel_obj.images.all().delete()
                HotelImage.objects.bulk_create([
                    HotelImage(hotel=hotel_obj, url_template=str(url).replace('{size}', '1024x768'))
                    for url in images[:20]
                ])

            hotel_obj.refresh_from_db()
        except Exception as e:
            logger.error(f"Error saving hotel static data for {hotel_obj.hotel_id}: {e}")

        return hotel_obj

    def _fetch_hotel_info_from_etg(self, hotel_obj, hotel_id_str, language="ru"):
        url = f"{self.BASE_URL}/hotel/info/"
        payload = {"language": language or "ru"}

        if hotel_obj and hotel_obj.hid:
            payload["hid"] = str(hotel_obj.hid)
        elif str(hotel_id_str).isdigit():
            payload["hid"] = str(hotel_id_str)
        else:
            payload["id"] = str(hotel_id_str)

        response = self.session.post(url, json=payload, timeout=10)
        if response.status_code != 200:
            response = self.session.post(url, json={"data": payload}, timeout=10)

        if response.status_code != 200:
            logger.error(f"ETG hotel/info error for {hotel_id_str}: {response.status_code} {response.text}")
            return None

        response_data = response.json()
        data = response_data.get('data') if isinstance(response_data, dict) else None

        if isinstance(data, dict) and isinstance(data.get('hotel'), dict):
            data = data.get('hotel')

        return data if isinstance(data, dict) else None

    def _get_or_create_hotel_static(self, hotel_id_str, provided_hid=None):
        hotel_id_str = str(hotel_id_str or '').strip().strip('/')
        hid_value = provided_hid

        if not hid_value and hotel_id_str.isdigit():
            try:
                hid_value = int(hotel_id_str)
            except (TypeError, ValueError):
                hid_value = None

        hotel_obj = HotelStatic.objects.filter(hotel_id=hotel_id_str).first()

        # Важно: если пришёл numeric hid, сначала ищем уже сохранённый
        # полноценный отель по hid, а не создаём новую пустую запись с id=hid.
        if not hotel_obj and hid_value:
            hotel_obj = HotelStatic.objects.filter(hid=hid_value).first()

        if hotel_obj:
            if hid_value and not hotel_obj.hid:
                hotel_obj.hid = hid_value
                hotel_obj.save(update_fields=['hid'])
            return hotel_obj, False

        return HotelStatic.objects.get_or_create(
            hotel_id=hotel_id_str,
            defaults={
                'hid': hid_value,
                'name': hotel_id_str.replace('_', ' ').title(),
                'address': "Адрес уточняется"
            }
        )

    def _is_hotel_static_incomplete(self, hotel_obj):
        if not hotel_obj:
            return True

        return (
            not hotel_obj.name or
            not hotel_obj.address or
            hotel_obj.address == "Адрес уточняется" or
            str(hotel_obj.name).strip().lower() == str(hotel_obj.hotel_id).replace('_', ' ').title().lower() or
            not hotel_obj.latitude or
            not hotel_obj.longitude or
            hotel_obj.images.count() == 0 or
            not hotel_obj.description or
            not hotel_obj.amenities_list or
            not hotel_obj.check_in_time or
            not hotel_obj.check_out_time
        )

    def get_hotel_info_cached(self, hotel_id, provided_hid=None, force_refresh=False, language="ru"):
        hotel_id_str = str(hotel_id).strip().strip('/')

        hotel_obj, created = self._get_or_create_hotel_static(hotel_id_str, provided_hid=provided_hid)

        needs_update = (
            force_refresh or
            created or
            self._is_hotel_static_incomplete(hotel_obj)
        )

        if needs_update:
            try:
                time.sleep(0.1)
                etg_data = self._fetch_hotel_info_from_etg(hotel_obj, hotel_id_str, language=language)
                if etg_data:
                    hotel_obj = self._save_hotel_info_to_db(hotel_obj, etg_data)
                    result = self._normalize_hotel_info_response(etg_data, hotel_obj)
                else:
                    result = self._fallback_hotel_info_from_db(hotel_obj)
            except Exception as e:
                logger.error(f"Error updating hotel static data for {hotel_id_str}: {e}")
                result = self._fallback_hotel_info_from_db(hotel_obj)
        else:
            result = self._fallback_hotel_info_from_db(hotel_obj)

        try:
            HotelCache.objects.update_or_create(
                id=hotel_obj.hotel_id,
                defaults={
                    'name': hotel_obj.name,
                    'latitude': hotel_obj.latitude,
                    'longitude': hotel_obj.longitude,
                    'stars': hotel_obj.star_rating,
                }
            )
        except Exception as e:
            logger.error(f"Error updating HotelCache for {hotel_id_str}: {e}")

        return result

    def _distance_km(self, lat1, lon1, lat2, lon2):
        try:
            lat1 = float(lat1)
            lon1 = float(lon1)
            lat2 = float(lat2)
            lon2 = float(lon2)
        except (TypeError, ValueError):
            return None

        radius = 6371.0
        d_lat = math.radians(lat2 - lat1)
        d_lon = math.radians(lon2 - lon1)
        a = (
            math.sin(d_lat / 2) ** 2 +
            math.cos(math.radians(lat1)) *
            math.cos(math.radians(lat2)) *
            math.sin(d_lon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return radius * c

    def _format_distance_label(self, distance_km):
        if distance_km is None:
            return ""
        if distance_km < 1:
            return f"{int(round(distance_km * 1000))} м"
        return f"{distance_km:.1f} км".replace('.', ',')

    def get_nearby_hotels(self, current_hotel, radius_km=5, limit=40):
        if not current_hotel:
            return []

        current_lat = current_hotel.get('latitude')
        current_lng = current_hotel.get('longitude')
        current_id = str(current_hotel.get('id') or current_hotel.get('hotel_id') or '').strip()

        try:
            current_lat = float(current_lat)
            current_lng = float(current_lng)
        except (TypeError, ValueError):
            return []

        queryset = HotelStatic.objects.exclude(hotel_id=current_id).exclude(latitude__isnull=True).exclude(longitude__isnull=True)

        city = current_hotel.get('city')
        if not city and isinstance(current_hotel.get('region'), dict):
            city = current_hotel.get('region', {}).get('name')
        if city:
            queryset = queryset.filter(city=city)

        nearby = []
        for hotel in queryset[:3000]:
            distance = self._distance_km(current_lat, current_lng, hotel.latitude, hotel.longitude)
            if distance is None or distance > radius_km:
                continue

            images = [image.url_template for image in hotel.images.all()[:3]]
            nearby.append({
                "id": hotel.hotel_id,
                "hid": hotel.hid,
                "name": hotel.name or hotel.hotel_id,
                "kind": hotel.kind or "hotel",
                "address": hotel.address or "",
                "latitude": hotel.latitude,
                "longitude": hotel.longitude,
                "stars": hotel.star_rating or 0,
                "star_rating": hotel.star_rating or 0,
                "city": hotel.city,
                "country": hotel.country_code,
                "images": images,
                "distance_km": round(distance, 3),
                "distance_label": self._format_distance_label(distance),
                "distance_text": self._format_distance_label(distance),
            })

        nearby.sort(key=lambda item: item['distance_km'])
        return nearby[:limit]

    def get_hotel_min_price_for_dates(self, hid, checkin, checkout, adults=2, children=None, language="ru", currency="USD", residency="ru"):
        """
        Возвращает минимальную цену похожего отеля на те же даты и гостей.
        Используется только для блока similar, поэтому результат кешируется ненадолго.
        """
        if not hid or not checkin or not checkout:
            return None

        children_list = children if isinstance(children, list) else []
        cache_key = f"similar_price:v1:{hid}:{checkin}:{checkout}:{adults}:{','.join(map(str, children_list))}:{language}:{currency}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        url = f"{self.BASE_URL}/search/hp/"
        payload = {
            "checkin": checkin,
            "checkout": checkout,
            "residency": residency,
            "language": language or "ru",
            "guests": [{"adults": int(adults or 2), "children": children_list}],
            "hid": int(hid),
            "currency": currency or "USD"
        }

        min_price = None

        try:
            response = self.session.post(url, json={"data": payload}, timeout=30)
            if response.status_code != 200:
                response = self.session.post(url, json=payload, timeout=30)

            if response.status_code != 200:
                logger.warning(f"Similar hotel price API error for {hid}: {response.status_code} {response.text}")
                cache.set(cache_key, None, 60 * 5)
                return None

            hotels_data = response.json().get('data', {}).get('hotels', [])
            rates = hotels_data[0].get('rates', []) if hotels_data else []
            prices = []

            for rate in rates:
                if not isinstance(rate, dict):
                    continue

                payment_types = rate.get('payment_options', {}).get('payment_types', [])
                payment = payment_types[0] if payment_types else {}
                price = payment.get('show_amount') or payment.get('amount') or rate.get('price') or 0

                price = self._to_money_decimal(price)
                if price and price > 0:
                    prices.append(price)

            if prices:
                min_price = format(min(prices), "f")

        except Exception as e:
            logger.warning(f"Similar hotel price error for {hid}: {e}")
            min_price = None

        cache.set(cache_key, min_price, 60 * 15)
        return min_price

    def get_similar_hotels(self, current_hotel, limit=4, checkin=None, checkout=None, adults=2, children=None, language="ru", currency="USD"):
        """
        Возвращает 4 похожих отеля для блока similar на single.
        Берём из HotelStatic: сначала тот же город + похожий тип,
        затем тот же город, потом ближайшие по координатам.
        Для каждого похожего отеля пробуем получить min_price на текущие даты и гостей.
        """
        if not current_hotel:
            return []

        current_id = str(current_hotel.get('id') or current_hotel.get('hotel_id') or '').strip()
        current_hid = str(current_hotel.get('hid') or '').strip()
        current_city = str(current_hotel.get('city') or '').strip()
        current_kind = str(current_hotel.get('kind') or '').strip().lower()

        if not current_city and isinstance(current_hotel.get('region'), dict):
            current_city = str(current_hotel.get('region', {}).get('name') or '').strip()

        queryset = HotelStatic.objects.exclude(latitude__isnull=True).exclude(longitude__isnull=True)

        if current_id:
            queryset = queryset.exclude(hotel_id=current_id)

        if current_hid:
            queryset = queryset.exclude(hid=current_hid)

        candidates = []
        used_ids = set()

        def build_item(hotel, distance=None):
            images = [image.url_template for image in hotel.images.all()[:3]]
            if not images:
                images = [self.DEFAULT_IMAGE]

            # ETG: при открытии страницы отеля должен быть РОВНО ОДИН /search/hp.
            # Поэтому для блока «похожие отели» НЕ запрашиваем live-цену по каждому
            # (это создавало +N запросов /search/hp). Цена подтянется при открытии
            # карточки похожего отеля.
            min_price = None

            # Для фронта похожие отели отдаём в той же логике, что каталог:
            # id = numeric HID для открытия single, slug/hotel_id = строковый ETG id.
            # Так ссылка получается /single/?id=8655840&slug=bed_and_breakfast_camille
            # и не зависит от query текущего отеля.
            similar_id = hotel.hid or hotel.hotel_id
            similar_slug = hotel.hotel_id

            item = {
                "id": similar_id,
                "hid": hotel.hid,
                "slug": similar_slug,
                "hotel_id": similar_slug,
                "name": hotel.name or hotel.hotel_id,
                "kind": hotel.kind or "hotel",
                "address": hotel.address or "",
                "latitude": hotel.latitude,
                "longitude": hotel.longitude,
                "stars": hotel.star_rating or 0,
                "star_rating": hotel.star_rating or 0,
                "city": hotel.city,
                "country": hotel.country_code,
                "images": images,
                "min_price": min_price,
                "price": min_price,
                "currency": currency or "USD",
                "distance_km": round(distance, 3) if distance is not None else None,
                "distance_text": self._format_distance_label(distance),
                "distance_label": self._format_distance_label(distance),
            }

            return self._enrich_distance_center(item)

        def add_candidates(qs, max_scan=2000):
            for hotel in qs[:max_scan]:
                if hotel.hotel_id in used_ids:
                    continue

                distance = None
                try:
                    if current_hotel.get('latitude') is not None and current_hotel.get('longitude') is not None:
                        distance = self._distance_km(
                            current_hotel.get('latitude'),
                            current_hotel.get('longitude'),
                            hotel.latitude,
                            hotel.longitude
                        )
                except Exception:
                    distance = None

                used_ids.add(hotel.hotel_id)
                candidates.append(build_item(hotel, distance=distance))

                if len(candidates) >= limit:
                    return True

            return len(candidates) >= limit

        base_qs = queryset

        if current_city:
            city_qs = base_qs.filter(city=current_city)

            if current_kind:
                if add_candidates(city_qs.filter(kind=current_kind)):
                    return candidates[:limit]

            if add_candidates(city_qs):
                return candidates[:limit]

        nearby_hotels = self.get_nearby_hotels(current_hotel, radius_km=15, limit=limit * 3)
        for hotel_data in nearby_hotels:
            hotel_id = str(hotel_data.get('id') or '').strip()
            if not hotel_id or hotel_id in used_ids:
                continue

            hotel_obj = HotelStatic.objects.filter(hotel_id=hotel_id).first()
            if not hotel_obj:
                continue

            used_ids.add(hotel_id)
            candidates.append(build_item(hotel_obj, distance=hotel_data.get('distance_km')))

            if len(candidates) >= limit:
                return candidates[:limit]

        add_candidates(base_qs.order_by('-star_rating', 'name'))
        return candidates[:limit]

    def _get_osm_point(self, item):
        lat = item.get('lat')
        lon = item.get('lon')

        if lat is None or lon is None:
            center = item.get('center') or {}
            lat = center.get('lat')
            lon = center.get('lon')

        try:
            return float(lat), float(lon)
        except (TypeError, ValueError):
            return None, None

    def _get_osm_name(self, tags):
        tags = tags or {}
        return (
            tags.get('name:ru') or
            tags.get('name') or
            tags.get('official_name:ru') or
            tags.get('official_name') or
            tags.get('name:en') or
            ''
        )

    def _classify_osm_place(self, tags):
        tags = tags or {}
        tourism = str(tags.get('tourism') or '').lower()
        historic = str(tags.get('historic') or '').lower()
        leisure = str(tags.get('leisure') or '').lower()
        amenity = str(tags.get('amenity') or '').lower()
        railway = str(tags.get('railway') or '').lower()
        station = str(tags.get('station') or '').lower()
        public_transport = str(tags.get('public_transport') or '').lower()
        aeroway = str(tags.get('aeroway') or '').lower()
        subway = str(tags.get('subway') or '').lower()

        if aeroway in ('aerodrome', 'airport'):
            return 'airports', 'airport'

        if railway in ('subway_entrance', 'halt', 'station') or public_transport == 'station':
            if railway == 'subway_entrance' or station == 'subway' or subway == 'yes':
                return 'metro', 'subway'
            return 'stations', 'train'

        if leisure in ('park', 'garden'):
            return 'attractions', 'park'

        if tourism in ('museum', 'gallery'):
            return 'attractions', 'museum'

        if tourism in ('attraction', 'zoo', 'aquarium', 'theme_park') or historic or amenity in ('theatre', 'arts_centre'):
            return 'attractions', 'museum'

        return 'around', 'museum'

    def _build_overpass_query(self, lat, lng):
        return f"""
    [out:json][timeout:45];
    (
    nwr(around:3000,{lat},{lng})["tourism"]["name"];
    nwr(around:3000,{lat},{lng})["leisure"~"park|garden"]["name"];
    nwr(around:3000,{lat},{lng})["amenity"~"theatre|arts_centre|museum|place_of_worship"]["name"];
    nwr(around:3000,{lat},{lng})["place"~"square"]["name"];

    nwr(around:3000,{lat},{lng})["railway"~"station|subway_entrance|halt"]["name"];
    nwr(around:3000,{lat},{lng})["public_transport"~"station|stop_position"]["name"];

    nwr(around:50000,{lat},{lng})["aeroway"~"aerodrome|airport"]["name"];
    );
    out center tags 40;
    """

    def get_nearby_places(self, current_hotel):
        empty = {
            "around": [],
            "attractions": [],
            "airports": [],
            "stations": [],
            "metro": [],
        }

        if not current_hotel:
            return empty

        try:
            current_lat = float(current_hotel.get('latitude'))
            current_lng = float(current_hotel.get('longitude'))
        except (TypeError, ValueError):
            return empty

        if not (-90.0 <= current_lat <= 90.0 and -180.0 <= current_lng <= 180.0):
            return empty

        cache_key = f"hotel_nearby_places:v4:{round(current_lat, 4)}:{round(current_lng, 4)}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        result = {
            "around": [],
            "attractions": [],
            "airports": [],
            "stations": [],
            "metro": [],
        }

        elements = []
        overpass_query = self._build_overpass_query(current_lat, current_lng)
        
        overpass_urls = [
            "https://overpass-api.de/api/interpreter",
        ]

        for url in overpass_urls:
            try:
                response = requests.post(
                    url,
                    data={"data": overpass_query},
                    timeout=(3, 60),
                    headers={"User-Agent": "AiforyHotel/1.0"}
                )

                if response.status_code == 429 or response.status_code >= 500:
                    logger.warning(f"Overpass nearby places temporary error {response.status_code} on {url}")
                    continue

                response.raise_for_status()
                elements = response.json().get('elements', [])

                logger.warning("Overpass URL: %s", url)
                logger.warning("Overpass elements count: %s", len(elements))

                if elements:
                    break
            except Exception as e:
                logger.warning(f"Overpass nearby places endpoint failed {url}: {e}")

        if not elements:
            return result

        seen_names = set()
        collected = []

        for item in elements:
            tags = item.get('tags') or {}
            name = self._get_osm_name(tags)
            if not name:
                continue

            name_key = name.strip().lower()
            if name_key in seen_names:
                continue

            lat, lng = self._get_osm_point(item)
            if lat is None or lng is None:
                continue

            distance = self._distance_km(current_lat, current_lng, lat, lng)
            if distance is None:
                continue

            group, icon = self._classify_osm_place(tags)
            place = {
                "name": name,
                "title": name,
                "type": group,
                "icon": icon,
                "latitude": lat,
                "longitude": lng,
                "distance_km": round(distance, 3),
                "distance_m": int(round(distance * 1000)),
                "distance_text": self._format_distance_label(distance),
                "osm_type": item.get('type'),
                "osm_id": item.get('id'),
            }

            seen_names.add(name_key)
            collected.append(place)

        collected.sort(key=lambda place: place['distance_km'])

        for place in collected:
            group = place.get('type') or 'around'
            if group not in result:
                group = 'around'

            if group == 'airports' and len(result[group]) >= 4:
                continue
            if group in ('stations', 'metro') and len(result[group]) >= 10:
                continue
            if group == 'attractions' and len(result[group]) >= 16:
                continue
            if group == 'around' and len(result[group]) >= 16:
                continue

            result[group].append(place)

            if group == 'attractions' and len(result['around']) < 16:
                result['around'].append(place)

        if any(result[key] for key in result):
            cache.set(cache_key, result, 60 * 60 * 24)

        return result

    def _empty_nearby_places_payload(self):
        return {
            "around": [],
            "attractions": [],
            "airports": [],
            "stations": [],
            "metro": [],
        }

    def get_nearby_places_from_db(self, hotel_id=None, hid=None):
        hotel_id = str(hotel_id or '').strip()
        query = None

        try:
            if hotel_id:
                query = HotelNearbyCache.objects.filter(etg_hotel_id=hotel_id).first()

            if not query and hid:
                try:
                    hid_value = int(hid)
                except (TypeError, ValueError):
                    hid_value = None

                if hid_value:
                    query = HotelNearbyCache.objects.filter(hid=hid_value).first()

            if not query:
                return self._empty_nearby_places_payload()

            return query.as_payload()
        except Exception as e:
            logger.warning(f"Cannot read HotelNearbyCache for hotel_id={hotel_id}, hid={hid}: {e}")
            return self._empty_nearby_places_payload()

    def get_nearest_metro_from_db(self, hotel_id=None, hid=None):
        places = self.get_nearby_places_from_db(hotel_id=hotel_id, hid=hid)
        metro = places.get('metro') or []
        return metro[0] if metro else None
    # --- НОВАЯ ЛОГИКА: АВТОМАТИЧЕСКОЕ СОПОСТАВЛЕНИЕ И КЭШИРОВАНИЕ НОМЕРОВ ---

    def _ensure_room_static(self, hotel_obj, rate_dict):
        if not hotel_obj:
            return None
            
        room_name = str(rate_dict.get('room_name') or 'Номер').strip()
        
        # Получаем room_ext_id из API. Если API его не прислал, генерируем хеш-сигнатуру по имени
        room_ext_id = rate_dict.get('room_ext_id')
        if not room_ext_id:
            name_hash = abs(hash(room_name)) % 1000000
            room_ext_id = f"auto_{name_hash}"
            
        room_ext_id = str(room_ext_id).strip()
        
        try:
            room_static, created = HotelRoomStatic.objects.get_or_create(
                hotel=hotel_obj,
                room_ext_id=room_ext_id,
                defaults={'name': room_name}
            )
            
            # Если имя номера обновилось в API, синхронизируем в БД
            if not created and room_static.name != room_name and room_name != 'Номер':
                room_static.name = room_name
                room_static.save(update_fields=['name'])
                
            return room_static
        except Exception as e:
            logger.warning(f"Ошибка сопоставления номера '{room_name}' для отеля {hotel_obj.hotel_id}: {e}")
            return None

    def get_hotel_details(self, hotel_id, checkin, checkout, adults=2, children=None, language="ru", currency="USD", residency="ru"):
        hotel_id_str = str(hotel_id).strip('/')
        static_info = self.get_hotel_info_cached(hotel_id_str, force_refresh=True, language=language)

        children_list = children if isinstance(children, list) else []

        target_hid = None
        if static_info and static_info.get('hid'):
            target_hid = static_info['hid']
        elif hotel_id_str.isdigit():
            target_hid = int(hotel_id_str)

        if not target_hid:
            logger.error(f"Не удалось найти HID для отеля {hotel_id_str}")
            return None
        #  Достаем инстанс HotelStatic для передачи в обработчик тарифов номеров
        hotel_obj = HotelStatic.objects.filter(hotel_id=hotel_id_str).first()

        url = f"{self.BASE_URL}/search/hp/"
        payload = {
            "checkin": checkin,
            "checkout": checkout,
            "residency": residency, # Передаем параметр residency
            "language": language,
            "guests": [{"adults": int(adults), "children": children_list}],
            "hid": int(target_hid),
            "currency": currency
        }

        rates = []
        try:
            # ETG /search/hp ожидает payload напрямую (без обёртки {"data": ...}).
            # Один запрос — чтобы при открытии страницы отеля был РОВНО ОДИН /search/hp.
            resp = self.session.post(url, json=payload, timeout=30)

            if resp.status_code == 200:
                hotels_data = resp.json().get('data', {}).get('hotels', [])
                if hotels_data:
                    #Передаем инстанс отеля в метод обработки тарифов
                    rates = self._process_rates(hotels_data[0].get('rates', []), hotel_obj=hotel_obj)
            else:
                logger.error(f"HP API Error {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.error(f"HP API Error: {e}")

        result = static_info if static_info else {"id": hotel_id_str, "name": "Отель", "images": [self.DEFAULT_IMAGE]}
        result = self._enrich_distance_center(result)
        result['rates'] = rates
        result['nearby_hotels'] = self.get_nearby_hotels(result)

        result['similar_hotels'] = self.get_similar_hotels(
            result,
            limit=4,
            checkin=checkin,
            checkout=checkout,
            adults=adults,
            children=children_list,
            language=language,
            currency=currency
        )

        # Быстро берём готовые места из отдельной таблицы кэша.
        # Если кэш ещё не прогрет — возвращается пустая структура, страница не тормозит.
        result['nearby_places'] = self.get_nearby_places_from_db(
            hotel_id=result.get('id') or hotel_id_str,
            hid=result.get('hid') or target_hid
        )
        result['nearest_metro'] = (result['nearby_places'].get('metro') or [None])[0]
        result['nearby_attractions'] = (result['nearby_places'].get('attractions') or [])[:16]

        return result

    def search_hotels(self, region_id, checkin, checkout, adults=2, children=None, language="ru", kind=None, residency="ru", serp_filters=None, page=1, **kwargs):
        url = f"{self.BASE_URL}/search/serp/region/"
        limit = 20
        page = int(page)
        
        children_list = children if isinstance(children, list) else []

        try:
            checkin_str, checkout_str = str(checkin), str(checkout)
            if datetime.strptime(checkout_str, '%Y-%m-%d') <= datetime.strptime(checkin_str, '%Y-%m-%d'):
                return {"status": "success", "total_hotels": 0, "hotels": []}
        except Exception:
            return {"status": "error", "message": "Invalid dates"}

        payload = {
            "checkin": checkin_str,
            "checkout": checkout_str,
            "residency": residency, # Прокидываем параметр residency 
            "language": language,
            "guests": [{"adults": int(adults), "children": children_list}], 
            "region_id": int(region_id),
            "currency": "USD"
        }

        try:
            # ETG /search/serp/region/ ожидает payload напрямую (без {"data": ...}).
            # Один запрос — serp/region лимитируется (10 RPM), двойной вызов недопустим.
            response = self.session.post(url, json=payload, timeout=30)

            response_data = response.json()
            data = response_data.get('data', {})
            raw_hotels = data.get('hotels', [])
            
            if not raw_hotels:
                return {"status": "success", "total_hotels": 0, "total_pages": 0, "current_page": page, "hotels": []}

            KIND_MAP = {
                "unspecified": "Отель", "hotel": "Отель", "resort": "Курортный отель",
                "guesthouse": "Гостевой дом", "hostel": "Хостел", "sanatorium": "Санаторий",
                "mini-hotel": "Мини-отель", "apartment": "Апартаменты", "camping": "Кемпинг",
                "villas-and-bungalows": "Вилла/Бунгало", "bnb": "B&B", "cottages-and-houses": "Коттедж/Дом",
                "boutique-and-design": "Бутик-отель", "castle": "Замок", "farm": "Ферма",
                "apart-hotel": "Апарт-отель", "glamping": "Глэмпинг"
            }

            full_list = []
            target_kind = str(kind).lower().replace('-', '').replace('_', '').strip() if kind else None
            
            for hotel_raw in raw_hotels:
                hotel_id = hotel_raw.get('id', '').lower()
                
                is_match = True
                static = None
                
                if target_kind:
                    is_match = False
                    if target_kind in hotel_id:
                        is_match = True
                    if not is_match:
                        static = self.get_hotel_info_cached(hotel_id, provided_hid=hotel_raw.get('hid'))
                        raw_k = str(hotel_raw.get('kind') or static.get('kind', 'hotel')).lower()
                        norm_k = raw_k.replace('_', '-')
                        
                        if target_kind in norm_k or target_kind.replace('hotel', '') in norm_k:
                            is_match = True
                        elif "апарт" in target_kind and "апарт" in raw_k:
                            is_match = True
                        elif "хостел" in target_kind and "хостел" in raw_k:
                            is_match = True
                
                if is_match:
                    if not static:
                        static = self.get_hotel_info_cached(hotel_id, provided_hid=hotel_raw.get('hid'))
                    
                    # Достаем инстанс отеля и передаем его в _process_full_data для SERP
                    hotel_obj = HotelStatic.objects.filter(hotel_id=hotel_id).first()
                    processed_single = self._process_full_data([hotel_raw], hotel_obj=hotel_obj)[0]
                    
                    raw_k = hotel_raw.get('kind') or static.get('kind', 'hotel')
                    norm_k = str(raw_k).lower().replace('_', '-')
                    final_images = static.get('images', [])
                    if not final_images:
                        search_images = hotel_raw.get('images', [])
                        final_images = [img.replace('{size}', '1024x768') for img in search_images]
                    
                    if not final_images or 'default' in str(final_images):
                        final_images = ["/static/img/default_hotel.png"]

                    nearby_places = self.get_nearby_places_from_db(
                        hotel_id=static.get('id') or hotel_id,
                        hid=static.get('hid') or hotel_raw.get('hid')
                    )
                    nearest_metro = (nearby_places.get('metro') or [None])[0]
                    nearby_attractions = nearby_places.get('attractions') or []

                    hotel_item = {
                        "id": hotel_id,
                        "hid": hotel_raw.get('hid'),
                        "min_price": processed_single.get('min_price'),
                        "rates": processed_single.get('rates', []),
                        "name": static.get('name', hotel_id),
                        "stars": static.get('stars', 0),
                        "address": static.get('address', ""),
                        "description": static.get('description', ""),
                        "latitude": static.get('latitude') or hotel_raw.get('latitude'),
                        "longitude": static.get('longitude') or hotel_raw.get('longitude'),
                        "kind": KIND_MAP.get(norm_k, raw_k),
                        "city": static.get('city') or hotel_raw.get('city'),
                        "country": static.get('country') or hotel_raw.get('country'),
                        "distance_center": hotel_raw.get('distance_center'),
                        "nearby_places": nearby_places,
                        "nearest_metro": nearest_metro,
                        "nearby_attractions": nearby_attractions[:16],
                        "images": final_images[:20],
                    }

                    full_list.append(self._enrich_distance_center(hotel_item))

                if len(full_list) >= page * limit + 10:
                    break

            start = (page - 1) * limit
            final_list = full_list[start : start + limit]
            total_found = len(full_list)

            return {
                "status": "success",
                "total_hotels": total_found,
                "total_pages": (total_found + limit - 1) // limit if total_found > 0 else 0,
                "current_page": page,
                "hotels": final_list
            }

        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def _process_full_data(self, raw_hotels, hotel_obj=None):
        formatted = []
        for hotel in raw_hotels:
            all_prices = []
            rates_list = []
            for rate in hotel.get('rates', []):
                payment_types = rate.get('payment_options', {}).get('payment_types', [])
                price_val = payment_types[0].get('show_amount', "0") if payment_types else "0"
                money_price = self._to_money_decimal(price_val)
                if money_price and money_price > 0:
                    all_prices.append(money_price)
                rate_item = {
                    "match_hash": rate.get('match_hash'),
                    "book_hash": rate.get('book_hash') or rate.get('hash'),
                    "room_name": rate.get('room_name'),
                    "meal": rate.get('meal'),
                    "price": price_val,
                }

                #  Привязываем/создаем типы номеров и подтягиваем фото для каталога
                if hotel_obj:
                    room_static = self._ensure_room_static(hotel_obj, rate)
                    if room_static:
                        rate_item['room_static_id'] = room_static.id
                        custom_images = []
                        if hasattr(room_static, 'images'):
                            for img in room_static.images.all():
                                if getattr(img, 'image', None): custom_images.append(img.image.url)
                                elif getattr(img, 'url', None): custom_images.append(img.url)
                        rate_item['room_images'] = custom_images if custom_images else []
                else:
                    rate_item['room_images'] = []

                rates_list.append(rate_item)

                
            
            formatted.append({
                "id": hotel.get('id'),     
                "hid": hotel.get('hid'),   
                "name": hotel.get('name'),
                "stars": hotel.get('stars'),
                "min_price": format(min(all_prices), "f") if all_prices else "0.00",
                "rates": rates_list
            })
        return formatted

    def _process_rates(self, raw_rates, hotel_obj=None):
        processed = []

        for rate in raw_rates:
            if not isinstance(rate, dict):
                continue

            item = dict(rate)
            payment_types = item.get('payment_options', {}).get('payment_types', [])
            payment = payment_types[0] if payment_types else {}
            price = payment.get('show_amount') or payment.get('amount') or item.get('price') or "0"

            item['book_hash'] = item.get('book_hash') or item.get('hash') or ''
            item['match_hash'] = item.get('match_hash') or ''
            item['room_name'] = item.get('room_name') or 'Номер'
            item['meal'] = item.get('meal') or (item.get('meal_data') or {}).get('value') or 'nomeal'
            item['price'] = price
            item['price_total'] = price
            item['currency'] = payment.get('show_currency_code') or payment.get('currency_code') or 'USD'

            item['tax_data'] = payment.get('tax_data') or item.get('tax_data') or {}
            
            item['cancellation_info'] = payment.get('cancellation_penalties') or item.get('cancellation_penalties') or {}
            item['all_amenities'] = item.get('amenities_data') or item.get('all_amenities') or item.get('serp_filters') or []

            #  Добавляем логику связки с HotelRoomStatic и выгрузки кастомных картинок
            if hotel_obj:
                room_static = self._ensure_room_static(hotel_obj, item)
                if room_static:
                    item['room_static_id'] = room_static.id
                    
                    # Собираем менеджерские картинки номера
                    custom_images = []
                    if hasattr(room_static, 'images'):
                        for img in room_static.images.all():
                            if getattr(img, 'image', None):
                                custom_images.append(img.image.url)
                            elif getattr(img, 'url', None):
                                custom_images.append(img.url)
                    
                    item['room_images'] = custom_images if custom_images else []
            else:
                item['room_images'] = []

            processed.append(item)

        return processed

    def prebook(self, book_hash):
        url = f"{self.BASE_URL}/hotel/prebook/"
        try:
            # Увеличен таймаут до 60 секунд согласно требованиям ETG
            response = self.session.post(url, json={"data": {"hash": str(book_hash)}}, timeout=60)
            if response.status_code != 200:
                response = self.session.post(url, json={"hash": str(book_hash)}, timeout=60)
            
            return response.json()
        except Exception as e:
            logger.error(f"Prebook Error: {e}")
            return None

    def create_booking_process(self, book_hash, user_ip, internal_order_id, language="ru"):
        url = f"{self.BASE_URL}/hotel/order/booking/form/"
        
        # ИСПРАВЛЕНО: Вместо хардкода '82.29.0.86' берем IP из настроек
        fallback_ip = getattr(settings, "ETG_FALLBACK_IP", "82.29.0.86")
        valid_ip = user_ip if user_ip != '127.0.0.1' else fallback_ip

        payload = {
            "partner_order_id": str(internal_order_id),
            "book_hash": str(book_hash),
            "language": language, 
            "user_ip": valid_ip
        }
        
        try:
            response = self.session.post(url, json=payload, timeout=20)
            return response.json()
        except Exception as e:
            logger.error(f"Booking Form Exception: {e}")
            return None

    def finish_booking(self, guest_data, contact_data, internal_order_id, price, currency="USD"):
        url = f"{self.BASE_URL}/hotel/order/booking/finish/"
        
        formatted_price = self._to_money_string(price)
        if formatted_price is None:
            logger.error(f"Finish Booking Error: invalid price {price!r}")
            return {"status": "error", "message": "Invalid booking price"}

        user_email = str(contact_data.get('email', '')).strip()
        user_phone = str(contact_data.get('phone', '')).strip()
        user_comment = str(contact_data.get('comment', 'Order from Web')).strip()
        user_language = str(contact_data.get('language', 'ru')).strip()

        payload = {
            "user": {
                # Корпоративный email для ETG-ваучера (net price). Настраивается через env.
                "email": getattr(settings, "ETG_VOUCHER_EMAIL", "voucher@aifory.pro"),
                "phone": user_phone,
                "comment": user_comment
            },
            "partner": {
                "partner_order_id": str(internal_order_id)
            },
            "language": user_language,
            "rooms": [
                {
                    "guests": guest_data # Список гостей (имена, фамилии) с фронта
                }
            ],
            "payment_type": {
                "type": "deposit",
                "amount": formatted_price,
                "currency_code": currency # По умолчанию USD
            }
        }
        
        try:
            response = self.session.post(url, json=payload, timeout=20)
            if response.status_code == 400:
                response = self.session.post(url, json={"data": payload}, timeout=20)
            return response.json()
        except Exception as e:
            logger.error(f"Finish Booking Error: {e}")
            return {"status": "error", "message": str(e)}


    def check_booking_status(self, internal_order_id):
        url = f"{self.BASE_URL}/hotel/order/booking/finish/status/"
        payload = {
            "partner_order_id": str(internal_order_id)
        }
        
        try:
            logger.info(f"Checking status for order: {internal_order_id}")
            response = self.session.post(url, json=payload, timeout=10)
            
            logger.debug(f"ETG status response: {response.status_code} - {response.text}")
            
            return response.json()
        except Exception as e:
            logger.error(f"Ошибка проверки статуса ETG: {e}")
            return None
        
    def get_final_order_details(self, internal_order_id):
        url = f"{self.BASE_URL}/hotel/order/info/"
        payload = {
            "ordering": {
                "ordering_type": "desc",
                "ordering_by": "created_at"
            },
            "pagination": {
                "page_size": 1,
                "page_number": 1
            },
            "search": {
                "partner_order_id": [str(internal_order_id)]
            },
            "language": "ru"
        }
        
        try:
            logger.debug(f"ETG v3 Flat Payload: {payload}")
            response = self.session.post(url, json=payload, timeout=15)
            res_data = response.json()
            
            if res_data.get('status') == 'ok':
                orders = res_data.get('data', {}).get('orders', [])
                return orders[0] if orders else None
            
            logger.error(f"ETG API Error: {res_data}")
            return None
        except Exception as e:
            logger.error(f"Exception: {e}")
            return None

    def cancel_booking(self, internal_order_id):
        url = f"{self.BASE_URL}/hotel/order/cancel/"
        payload = {"partner_order_id": str(internal_order_id)}

        try:
            response = self.session.post(url, json=payload, timeout=20)
            result = response.json()
        except Exception as e:
            logger.error(f"Cancel Booking Error: {e}")
            return {"status": "error", "message": str(e)}

        if response.status_code >= 400:
            logger.error(f"Cancel Booking Error {response.status_code}: {result}")

        return result
        



class AbcexPaymentService:
    BASE_URL = "https://api.abcex.io"

    def __init__(self):
        self._api_key = str(getattr(settings, 'ABCEX_API_KEY', '')).strip()
        self._secret_key = str(getattr(settings, 'ABCEX_SECRET_KEY', '')).strip()
        self._wallet_id = str(getattr(settings, 'ABCEX_WALLET_ID', '')).strip().replace('"', '').replace("'", "")
        # Опциональный прокси со статичным "чистым" IP (ABCEX режет дата-центровые IP на WAF).
        proxy_url = str(getattr(settings, 'ABCEX_PROXY_URL', '')).strip()
        self._proxies = {'http': proxy_url, 'https': proxy_url} if proxy_url else None

    def _call(self, method, path, query_str=None, body=None):
        full_path = f"{path}?{query_str}" if query_str else path

        body_str = json.dumps(body, separators=(',', ':')) if body else ''
        timestamp = str(int(time.time() * 1000))
        message = f"{timestamp}\n{method.upper()}\n{full_path}\n{body_str}"
        signature = hmac.new(self._secret_key.encode(), message.encode(), hashlib.sha256).hexdigest()

        headers = {
            'Content-Type': 'application/json',
            'X-API-KEY': self._api_key,
            'X-API-TIMESTAMP': timestamp,
            'X-API-SIGNATURE': signature
        }

        return requests.request(
            method=method,
            url=self.BASE_URL + full_path,
            data=body_str if body_str else None,
            headers=headers,
            timeout=15,
            proxies=self._proxies
        )

    def generate_new_address(self, network_id="TRX"):
        if not self._wallet_id or not self._api_key or not self._secret_key:
            logger.error("ABCEX: Проверьте ABCEX_API_KEY, ABCEX_SECRET_KEY и ABCEX_WALLET_ID в переменных окружения")
            return None

        path = "/api/v1/wallet/get-new-crypto-address"
        # СТРОГИЙ АЛФАВИТНЫЙ ПОРЯДОК: networkId идет перед walletId (n < w)
        query_str = f"networkId={network_id}&walletId={self._wallet_id}"
        
        try:
            response = self._call('GET', path, query_str=query_str)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) > 0:
                    return data[0].get("address")
                return None
                
            logger.error(f"ABCEX Error {response.status_code}: {response.text}")
            return None
            
        except Exception as e:
            logger.error(f"ABCEX Connection Error: {e}")
            return None

    def get_funding_wallet_id(self, currency_name="USDT"):
        path = "/api/v1/accounting/client/report-account/accounts/overview"
        try:
            # Здесь параметров нет, поэтому передаем только путь
            response = self._call('GET', path)
            if response.status_code == 200:
                data = response.json()
                wallets = data.get('accounts', {}).get('funding', [])
                for w in wallets:
                    if w.get('name') == currency_name:
                        return w.get('id')
            return None
        except Exception as e:
            logger.error(f"ABCEX Wallet List Error: {e}")
            return None

    def get_usdt_balance(self, currency_name="USDT"):
        """Текущий баланс USDT в ABCEX (serviceBalance funding-счёта). None при ошибке."""
        from decimal import Decimal as D
        path = "/api/v1/accounting/client/report-account/accounts/overview"
        try:
            response = self._call('GET', path)
            if response.status_code != 200:
                logger.warning("ABCEX balance HTTP %s: %s", response.status_code, response.text[:200])
                return None
            wallets = response.json().get('accounts', {}).get('funding', [])
            for w in wallets:
                if w.get('name') == currency_name:
                    return D(str(w.get('serviceBalance', '0')))
            return None
        except Exception as e:
            logger.error(f"ABCEX Balance Error: {e}")
            return None
        
    def check_payment(self, target_address, expected_amount, currency="USDT", network="TRX"):
        path = "/api/v1/wallet/transactions/list/my"
        amount_tolerance = Decimal("0.000001")
        query_str = (
            f"filter.currencyId=$eq:{currency}&"
            f"filter.direction=$eq:in&"
            f"filter.networkId=$eq:{network}&"
            f"filter.status=$eq:completed&"
            f"limit=50&"
            f"page=1"
        )
        
        try:
            response = self._call('GET', path, query_str=query_str)
            
            if response.status_code == 200:
                transactions = response.json().get('data', [])
                
                for tx in transactions:
                    if tx.get('addressTo') == target_address:
                        try:
                            tx_amount = Decimal(str(tx.get('amount', '0')))
                            expected_decimal = Decimal(str(expected_amount))
                        except (InvalidOperation, TypeError, ValueError):
                            logger.warning(
                                f"ABCEX: Некорректная сумма платежа. Ожидалось {expected_amount}, пришло {tx.get('amount')}"
                            )
                            continue
                        
                        if tx_amount >= expected_decimal - amount_tolerance:
                            # Извлекаем комиссию ABCEX за платёж (поле может называться по-разному)
                            fee = Decimal("0")
                            for k in ("fee", "feeAmount", "commission", "serviceFee",
                                      "serviceCommission", "networkFee", "feeValuation"):
                                v = tx.get(k)
                                if v not in (None, ""):
                                    try:
                                        fee = Decimal(str(v))
                                        break
                                    except (InvalidOperation, TypeError, ValueError):
                                        pass
                            logger.info("ABCEX tx keys=%s | fee=%s", list(tx.keys()), fee)
                            return {
                                "paid": True,
                                "txId": tx.get('txId'),
                                "actual_amount": tx_amount,
                                "fee": fee,
                            }
                        else:
                            logger.warning(f"ABCEX: Платеж найден, но сумма меньше! Ожидалось {expected_decimal}, пришло {tx_amount}")
                
                return {"paid": False, "reason": "not_found"}
                
            else:
                logger.error(f"ABCEX Check Payment Error {response.status_code}: {response.text}")
                return {"paid": False, "reason": "connection_error"}
                
        except Exception as e:
            logger.error(f"ABCEX Check Connection Error: {e}")
            return {"paid": False, "reason": "connection_error"}

    def create_withdrawal(self, address_to, amount, currency="USDT", network="TRX"):
        if not self._wallet_id or not self._api_key or not self._secret_key:
            logger.error("ABCEX Withdrawal Error: Секреты API не настроены.")
            return {"success": False, "error": "API credentials missing"}

        path = "/api/v1/accounting/client/crypto-withdrawals/create"
        
        payload = {
            "walletId": self._wallet_id,
            "currencyId": currency,
            "networkId": network,
            "addressTo": str(address_to),
            "amount": float(amount),  
        }

        try:
            response = self._call('POST', path, body=payload)
            
            if response.status_code in (200, 201):
                data = response.json()
                logger.info(f"ABCEX Withdrawal Successful for address {address_to}. Info: {data}")
                return {
                    "success": True, 
                    "withdrawal_id": data.get("id") or data.get("withdrawalId")
                }
            
            logger.error(f"ABCEX Withdrawal API Error {response.status_code}: {response.text}")
            return {"success": False, "error": f"API Error {response.status_code}"}
            
        except Exception as e:
            logger.error(f"ABCEX Withdrawal Connection Exception: {e}")
            return {"success": False, "error": "Connection error"}
        




abcex_service = AbcexPaymentService()
etg_service = EmergingTravelService()

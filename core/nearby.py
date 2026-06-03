import math
import logging

from .models import HotelStatic

logger = logging.getLogger(__name__)


def _to_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def distance_km(lat1, lng1, lat2, lng2):
    lat1 = _to_float(lat1)
    lng1 = _to_float(lng1)
    lat2 = _to_float(lat2)
    lng2 = _to_float(lng2)

    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return None

    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)

    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return radius * c


def format_distance(distance):
    if distance is None:
        return ""

    if distance < 1:
        return f"{int(round(distance * 1000))} м"

    return f"{distance:.1f} км".replace(".", ",")


def get_hotel_id_from_data(hotel_data):
    return str(
        hotel_data.get("id")
        or hotel_data.get("hotel_id")
        or hotel_data.get("hid")
        or ""
    ).strip()


def get_nearby_hotels_for_response(hotel_data, radius_km=5, limit=20):
    """
    Добавляет отели рядом для ответа детальной страницы.
    Работает с SQLite без PostGIS: берём кандидатов из HotelStatic и считаем Haversine в Python.
    """
    if not isinstance(hotel_data, dict):
        return []

    current_lat = _to_float(hotel_data.get("latitude"))
    current_lng = _to_float(hotel_data.get("longitude"))

    if current_lat is None or current_lng is None:
        return []

    current_id = get_hotel_id_from_data(hotel_data)
    current_hid = str(hotel_data.get("hid") or "").strip()
    current_city = ""

    region = hotel_data.get("region")
    if isinstance(region, dict):
        current_city = str(region.get("name") or "").strip()

    if not current_city:
        current_city = str(hotel_data.get("city") or "").strip()

    queryset = HotelStatic.objects.exclude(latitude__isnull=True).exclude(longitude__isnull=True)

    if current_id:
        queryset = queryset.exclude(hotel_id=current_id)

    if current_hid:
        queryset = queryset.exclude(hid=current_hid)

    if current_city:
        queryset = queryset.filter(city=current_city)

    nearby = []

    for item in queryset[:3000]:
        distance = distance_km(current_lat, current_lng, item.latitude, item.longitude)

        if distance is None or distance > radius_km:
            continue

        images = []
        try:
            images = [img.url_template for img in item.images.all()[:3]]
        except Exception as exc:
            logger.debug("Cannot read nearby hotel images: %s", exc)

        nearby.append({
            "id": item.hotel_id,
            "hid": item.hid,
            "name": item.name or item.hotel_id,
            "kind": item.kind or "hotel",
            "address": item.address or "",
            "latitude": item.latitude,
            "longitude": item.longitude,
            "stars": item.star_rating or 0,
            "city": item.city,
            "country": item.country_code,
            "images": images,
            "distance_km": round(distance, 3),
            "distance_text": format_distance(distance),
            "distance_label": format_distance(distance),
        })

    nearby.sort(key=lambda hotel: hotel["distance_km"])
    return nearby[:limit]

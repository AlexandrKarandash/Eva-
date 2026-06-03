import time

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import HotelStatic, HotelNearbyCache
from core.services import etg_service


class Command(BaseCommand):
    help = 'Заполняет отдельную таблицу HotelNearbyCache: метро, достопримечательности и места рядом с отелями.'

    def add_arguments(self, parser):
        parser.add_argument('--region', dest='region_id', default='', help='ID региона для записи в кэш, например 2734')
        parser.add_argument('--city', dest='city', default='', help='Фильтр по городу из HotelStatic.city')
        parser.add_argument('--country', dest='country_code', default='', help='Фильтр по country_code, например FR')
        parser.add_argument('--hotel-id', dest='hotel_id', default='', help='Прогреть только один hotel_id')
        parser.add_argument('--limit', dest='limit', type=int, default=0, help='Ограничить количество отелей')
        parser.add_argument('--sleep', dest='sleep', type=float, default=1.0, help='Пауза между запросами к Overpass')
        parser.add_argument('--force', action='store_true', help='Перезаписать уже существующий кэш')
        parser.add_argument('--empty-only', action='store_true', help='Обновлять только пустые записи')

    def handle(self, *args, **options):
        qs = HotelStatic.objects.exclude(latitude__isnull=True).exclude(longitude__isnull=True).order_by('id')

        if options['city']:
            qs = qs.filter(city__iexact=options['city'])
        if options['country_code']:
            qs = qs.filter(country_code__iexact=options['country_code'])
        if options['hotel_id']:
            qs = qs.filter(hotel_id=options['hotel_id'])
        if options['limit'] and options['limit'] > 0:
            qs = qs[:options['limit']]

        total = qs.count() if hasattr(qs, 'count') else len(qs)
        self.stdout.write(self.style.NOTICE(f'Найдено отелей для прогрева: {total}'))

        created_count = 0
        updated_count = 0
        skipped_count = 0
        error_count = 0

        for index, hotel in enumerate(qs, start=1):
            existing = HotelNearbyCache.objects.filter(etg_hotel_id=hotel.hotel_id).first()

            if existing and not options['force']:
                if options['empty_only']:
                    has_data = any([
                        existing.metro,
                        existing.attractions,
                        existing.stations,
                        existing.airports,
                        existing.around,
                    ])
                    if has_data:
                        skipped_count += 1
                        self.stdout.write(f'[{index}/{total}] skip: {hotel.hotel_id}')
                        continue
                else:
                    skipped_count += 1
                    self.stdout.write(f'[{index}/{total}] skip: {hotel.hotel_id}')
                    continue

            self.stdout.write(f'[{index}/{total}] warm: {hotel.hotel_id} / {hotel.name}')

            try:
                payload = etg_service.build_nearby_cache_payload(
                    hotel,
                    region_id=options['region_id'] or None,
                )

                with transaction.atomic():
                    obj, created = HotelNearbyCache.objects.update_or_create(
                        etg_hotel_id=hotel.hotel_id,
                        defaults={
                            'hotel': hotel,
                            'hid': hotel.hid,
                            'region_id': options['region_id'] or '',
                            'city': hotel.city or '',
                            'country_code': hotel.country_code or '',
                            'latitude': hotel.latitude,
                            'longitude': hotel.longitude,
                            'metro': payload.get('metro') or [],
                            'attractions': payload.get('attractions') or [],
                            'stations': payload.get('stations') or [],
                            'airports': payload.get('airports') or [],
                            'around': payload.get('around') or [],
                            'source': 'osm',
                        }
                    )

                if created:
                    created_count += 1
                else:
                    updated_count += 1

                self.stdout.write(self.style.SUCCESS(
                    '  ok: metro={metro}, attractions={attractions}, stations={stations}, airports={airports}'.format(
                        metro=len(payload.get('metro') or []),
                        attractions=len(payload.get('attractions') or []),
                        stations=len(payload.get('stations') or []),
                        airports=len(payload.get('airports') or []),
                    )
                ))
            except Exception as exc:
                error_count += 1
                self.stdout.write(self.style.ERROR(f'  error: {hotel.hotel_id}: {exc}'))

            if options['sleep'] > 0:
                time.sleep(options['sleep'])

        self.stdout.write(self.style.SUCCESS(
            f'Готово. created={created_count}, updated={updated_count}, skipped={skipped_count}, errors={error_count}'
        ))

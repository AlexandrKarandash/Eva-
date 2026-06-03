# Generated manually for nearby places cache.
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_city'),
    ]

    operations = [
        migrations.CreateModel(
            name='HotelNearbyCache',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('etg_hotel_id', models.CharField(db_index=True, max_length=100, verbose_name='ID отеля')),
                ('hid', models.BigIntegerField(blank=True, db_index=True, null=True, verbose_name='HID')),
                ('region_id', models.CharField(blank=True, db_index=True, max_length=64, null=True, verbose_name='ID региона')),
                ('city', models.CharField(blank=True, db_index=True, max_length=100, null=True, verbose_name='Город')),
                ('country_code', models.CharField(blank=True, max_length=10, null=True, verbose_name='Код страны')),
                ('latitude', models.FloatField(blank=True, null=True, verbose_name='Широта')),
                ('longitude', models.FloatField(blank=True, null=True, verbose_name='Долгота')),
                ('metro', models.JSONField(blank=True, default=list, verbose_name='Метро')),
                ('attractions', models.JSONField(blank=True, default=list, verbose_name='Достопримечательности')),
                ('stations', models.JSONField(blank=True, default=list, verbose_name='Станции / вокзалы')),
                ('airports', models.JSONField(blank=True, default=list, verbose_name='Аэропорты')),
                ('around', models.JSONField(blank=True, default=list, verbose_name='Места рядом')),
                ('source', models.CharField(default='osm', max_length=64, verbose_name='Источник')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Обновлено')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Создано')),
                ('hotel', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='nearby_cache', to='core.hotelstatic', verbose_name='Отель')),
            ],
            options={
                'verbose_name': 'Кэш мест рядом с отелем',
                'verbose_name_plural': 'Кэш мест рядом с отелями',
            },
        ),
        migrations.AddConstraint(
            model_name='hotelnearbycache',
            constraint=models.UniqueConstraint(fields=('etg_hotel_id',), name='unique_nearby_cache_etg_hotel_id'),
        ),
        migrations.AddIndex(
            model_name='hotelnearbycache',
            index=models.Index(fields=['etg_hotel_id'], name='core_hoteln_hotel_i_c81de4_idx'),
        ),
        migrations.AddIndex(
            model_name='hotelnearbycache',
            index=models.Index(fields=['hid'], name='core_hoteln_hid_87b70a_idx'),
        ),
        migrations.AddIndex(
            model_name='hotelnearbycache',
            index=models.Index(fields=['city'], name='core_hoteln_city_ead783_idx'),
        ),
        migrations.AddIndex(
            model_name='hotelnearbycache',
            index=models.Index(fields=['region_id'], name='core_hoteln_region__d9512b_idx'),
        ),
    ]

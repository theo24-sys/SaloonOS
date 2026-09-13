from django.db import migrations, models


def backfill_empty_logos(apps, schema_editor):
    Business = apps.get_model('core', 'Business')
    Business.objects.filter(logo_data_url__isnull=True).update(logo_data_url='')


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0008_staffsession'),
    ]

    operations = [
        migrations.RunPython(backfill_empty_logos, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='business',
            name='logo_data_url',
            field=models.TextField(blank=True, default=''),
        ),
    ]

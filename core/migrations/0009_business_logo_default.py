from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0008_staffsession'),
    ]

    operations = [
        migrations.AlterField(
            model_name='business',
            name='logo_data_url',
            field=models.TextField(blank=True, default=''),
        ),
    ]

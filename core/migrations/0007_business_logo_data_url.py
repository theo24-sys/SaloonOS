from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0006_seed_default_plans'),
    ]

    operations = [
        migrations.AddField(
            model_name='business',
            name='logo_data_url',
            field=models.TextField(blank=True),
        ),
    ]

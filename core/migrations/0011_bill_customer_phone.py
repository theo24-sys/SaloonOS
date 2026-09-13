from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0010_staff_pins'),
    ]

    operations = [
        migrations.AddField(
            model_name='bill',
            name='customer_phone',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
    ]

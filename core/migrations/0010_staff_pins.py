from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0009_business_logo_default'),
    ]

    operations = [
        migrations.AddField(
            model_name='staffmember',
            name='staff_pin',
            field=models.CharField(blank=True, default='', max_length=8),
        ),
        migrations.AddField(
            model_name='staffinvite',
            name='staff_pin',
            field=models.CharField(default='0000', max_length=8),
            preserve_default=False,
        ),
    ]

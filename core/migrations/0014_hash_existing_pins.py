"""One-time upgrade: hash every plaintext PIN already in the database.

Runs after 0013 widened the PIN columns to fit `pbkdf2_sha256$...` hashes.
Rows already hashed (idempotent re-runs, partial upgrades) are skipped.
"""
from django.db import migrations

from core.pins import hash_pin, is_hashed


def hash_all_pins(apps, schema_editor):
    Business = apps.get_model('core', 'Business')
    StaffMember = apps.get_model('core', 'StaffMember')
    StaffInvite = apps.get_model('core', 'StaffInvite')

    for biz in Business.objects.all().iterator():
        if not is_hashed(biz.owner_pin):
            biz.owner_pin = hash_pin(biz.owner_pin)
            biz.save(update_fields=['owner_pin'])
    for member in StaffMember.objects.all().iterator():
        if member.staff_pin and not is_hashed(member.staff_pin):
            member.staff_pin = hash_pin(member.staff_pin)
            member.save(update_fields=['staff_pin'])
    for inv in StaffInvite.objects.all().iterator():
        if not is_hashed(inv.staff_pin):
            inv.staff_pin = hash_pin(inv.staff_pin)
            inv.save(update_fields=['staff_pin'])
        if inv.created_by_pin and not is_hashed(inv.created_by_pin):
            inv.created_by_pin = hash_pin(inv.created_by_pin)
            inv.save(update_fields=['created_by_pin'])


def unhash_back(apps, schema_editor):
    # One-way by design: plaintext is unrecoverable from a peppered hash.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0013_alter_business_owner_pin_and_more'),
    ]

    operations = [
        migrations.RunPython(hash_all_pins, unhash_back),
    ]

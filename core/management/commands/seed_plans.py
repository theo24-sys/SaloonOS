"""Upsert the four pricing tiers. Idempotent — safe to run on every deploy."""
from django.core.management.base import BaseCommand

from core.models import Plan

PLANS = [
    dict(code='starter', name='Starter', price_monthly=299, price_annual=2990,
         monthly_verified_bills=200, max_staff=4, tagline='Solo barber / tiny salon',
         is_target=False,
         features=['Customer QR bill verification', 'Services + prices', 'Payment recording',
                   'Digital receipts', 'Basic sales dashboard', '4 staff', '200 verified bills/mo']),
    dict(code='growth', name='Growth', price_monthly=499, price_annual=4990,
         monthly_verified_bills=500, max_staff=8, tagline='Small/medium salon', is_target=True,
         features=['Everything in Starter', '8 staff', 'Customer history', 'Staff sales',
                   'Daily reconciliation', 'Discounts/voids tracking', 'Audit history',
                   '500 verified bills/mo']),
    dict(code='business', name='Business', price_monthly=799, price_annual=7990,
         monthly_verified_bills=1000, max_staff=15, tagline='Busy salon + barber', is_target=False,
         features=['Everything in Growth', '15 staff', 'Salon + barber departments',
                   'Staff performance', 'Commission tracking', 'Revenue discrepancy alerts',
                   'Advanced reports', '1,000 verified bills/mo']),
    dict(code='pro', name='Pro', price_monthly=1299, price_annual=12990,
         monthly_verified_bills=2000, max_staff=25, tagline='Large salon/beauty centre',
         is_target=False,
         features=['Everything in Business', '25+ staff', '2,000 verified bills/mo',
                   'Multiple managers', 'Advanced analytics', 'Branch support', 'Priority support']),
]


class Command(BaseCommand):
    help = 'Upsert pricing plans (idempotent, safe on every deploy)'

    def handle(self, *args, **options):
        for p in PLANS:
            obj, created = Plan.objects.update_or_create(code=p['code'], defaults=p)
            self.stdout.write(f"  {'created' if created else 'updated'}: {obj.code}")
        self.stdout.write(self.style.SUCCESS(f'{len(PLANS)} plans ensured.'))

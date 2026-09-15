"""Seed plans + demo business (XYZ Salon) with bills demonstrating the leak and an edit."""
import os
import sys

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.utils import timezone
from datetime import timedelta, datetime
from core.models import (Plan, Business, StaffMember, Service, Bill, BillItem,
                         BillEdit, AuditEvent)

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


def run():
    for p in PLANS:
        Plan.objects.update_or_create(code=p['code'], defaults=p)

    if Business.objects.filter(slug='xyz-salon').exists():
        # Re-date the seeded bills to today so the owner dashboard always demos well.
        from core.models import AuditEvent
        biz = Business.objects.get(slug='xyz-salon')
        today = timezone.localdate()
        for bill in biz.bills.all():
            old = bill.created_at
            day_offset = 0 if old.hour >= 9 else -timedelta(days=1)
            if day_offset == 0 and old.date() == today:
                continue
            new_created = timezone.make_aware(datetime.combine(
                today if old.hour >= 9 else today - timedelta(days=1), old.time()))
            shift = new_created - old
            bill.created_at = new_created
            bill.save(update_fields=['created_at'])
            if bill.approved_at:
                bill.approved_at += shift
                bill.save(update_fields=['approved_at'])
            if bill.paid_at:
                bill.paid_at += shift
                bill.save(update_fields=['paid_at'])
            for ev in AuditEvent.objects.filter(bill=bill):
                ev.at += shift
                ev.save(update_fields=['at'])
        print('Demo data refreshed to today.')
        return

    plan_growth = Plan.objects.get(code='growth')
    biz = Business.objects.create(name='XYZ Salon', slug='xyz-salon',
                                  plan=plan_growth, owner_pin='2026',
                                  plan_paid_until=timezone.now() + timedelta(days=30))

    staff = {}
    for nm, role in [('Jane', 'staff'), ('Alice', 'staff'), ('Brian', 'manager')]:
        staff[nm] = StaffMember.objects.create(business=biz, name=nm, role=role)
    services = {}
    for nm, price in [('Braiding', 2500), ('Treatment', 800), ('Hair wash', 300),
                      ('Haircut', 500), ('Shave', 200), ('Manicure', 700)]:
        services[nm] = Service.objects.create(business=biz, name=nm, default_price=price)

    now = timezone.now()
    today = now.replace(hour=11, minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)

    def make_bill(code, customer, staff_name, items, created, status='paid',
                  approved_offset=timedelta(minutes=30), paid_offset=timedelta(hours=1),
                  method='M-Pesa', dispute_note=''):
        bill = Bill.objects.create(
            business=biz, code=code, customer_name=customer, staff=staff[staff_name],
            status=status, total=sum(p for _, p in items), created_at=created,
            approved_at=(created + approved_offset) if status not in ('pending', 'draft') else None,
            paid_at=(created + paid_offset) if status == 'paid' else None,
            payment_method=method if status == 'paid' else '',
            dispute_note=dispute_note)
        for nm, price in items:
            BillItem.objects.create(bill=bill, name=nm, price=price)
        AuditEvent.objects.create(bill=bill, type='created', at=created,
                                  detail=f"KSh {bill.total} — served by {staff_name}")
        if status == 'disputed':
            AuditEvent.objects.create(bill=bill, type='disputed', at=created + approved_offset,
                                      detail=dispute_note or 'Customer reported a problem')
        elif status not in ('pending', 'draft'):
            AuditEvent.objects.create(bill=bill, type='verified', at=created + approved_offset,
                                      detail=f"Customer {customer} verified the bill")
        if status == 'paid':
            AuditEvent.objects.create(bill=bill, type='paid', at=created + paid_offset,
                                      detail=f"KSh {bill.total} recorded — {method}")
        return bill

    # Yesterday — clean, fully verified day
    make_bill('8F72KQ', 'Wanjiru', 'Alice', [('Haircut', 500), ('Shave', 200)], yesterday)
    make_bill('K2M9PD', 'Njeri', 'Jane', [('Braiding', 2500)], yesterday + timedelta(hours=1))
    make_bill('T4X8RB', 'Achieng', 'Alice', [('Treatment', 800), ('Hair wash', 300)],
              yesterday + timedelta(hours=2), method='Cash')

    # Today — the story: an edited bill, a verified-but-unpaid leak, a pending, a disputed
    edited = make_bill('Q7W3ZN', 'Mary', 'Jane',
                       [('Braiding', 2500), ('Treatment', 800), ('Hair wash', 300)],
                       today + timedelta(hours=1), status='pending')
    BillEdit.objects.create(bill=edited, item_name='Braiding', old_price=2500, new_price=2000,
                            reason='Customer discount', edited_by=staff['Jane'],
                            at=edited.created_at + timedelta(minutes=15))
    AuditEvent.objects.create(bill=edited, type='edited',
                              at=edited.created_at + timedelta(minutes=15),
                              detail='Braiding: KSh 2,500 → KSh 2,000 (Customer discount)')
    edited.total = 3100
    edited.save()

    make_bill('M5J8VC', 'Faith', 'Brian', [('Manicure', 700), ('Hair wash', 300)],
              today + timedelta(hours=2), status='pending')
    make_bill('B9N4KD', 'Grace', 'Alice', [('Haircut', 500), ('Shave', 200)],
              today + timedelta(hours=3), status='disputed',
              dispute_note='Customer says the shave was not done.')
    # Mary's bill gets verified later today (with the discount applied) but NOT paid → the leak
    edited.status = 'approved'
    edited.approved_at = now - timedelta(minutes=40)
    edited.save()
    AuditEvent.objects.create(bill=edited, type='verified', at=edited.approved_at,
                              detail='Customer Mary verified the bill')

    print('Seeded plans + XYZ Salon demo data.')


if __name__ == '__main__':
    run()

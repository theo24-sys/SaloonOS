"""SaloonOS regression suite for the money-critical paths.

Covers: bill lifecycle guardrails, plan-cap enforcement (create + verify),
M-Pesa settlement (callback, poll, amount mismatch, double-settle), once-only
receipt redemption, PIN hashing/upgrade, rate limiting, and platform-admin
auth. Run with:

    DATABASE_URL=sqlite:///dev-test.db python manage.py test core
"""
from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from .models import (AuditEvent, Bill, BillItem, Business, MpesaPayment, Plan,
                     Service, StaffInvite, StaffMember)
from . import throttle, views
from .pins import check_pin, hash_pin, is_hashed


def _plan(**over):
    # Migration 0006 seeds the real tiers; reuse them instead of colliding.
    defaults = dict(name='Starter', price_monthly=299,
                    price_annual=2990, monthly_verified_bills=30, max_staff=4)
    defaults.update(over)
    plan, _ = Plan.objects.get_or_create(code=defaults.pop('code', 'starter'), defaults=defaults)
    return plan


class Base(TestCase):
    def setUp(self):
        self.plan = _plan()
        self.biz = Business.objects.create(
            name='Kempinski Salon', slug='kempinski', plan=self.plan, owner_pin='1234')
        self.staffer = StaffMember.objects.create(business=self.biz, name='Asha', staff_pin='9999')
        Service.objects.create(business=self.biz, name='Braids', default_price=1500)
        throttle.cache.clear()
        self.addCleanup(throttle.cache.clear)


class PinToolsTest(TestCase):
    def test_hash_roundtrip_and_pepper_change(self):
        h = hash_pin('4321')
        self.assertTrue(is_hashed(h))
        self.assertTrue(check_pin('4321', h))
        self.assertFalse(check_pin('4322', h))
        with override_settings(PIN_PEPPER='a-different-secret'):
            self.assertFalse(check_pin('4321', h))

    def test_legacy_plaintext_verify_only(self):
        self.assertTrue(check_pin('1234', '1234'))
        self.assertFalse(check_pin('4321', '1234'))
        # is_hashed stays False so the caller re-hashes on next success.
        self.assertFalse(is_hashed('1234'))


class SignupAndLoginTest(Base):
    def test_signup_hashes_owner_pin(self):
        res = self.client.post('/api/signup/', content_type='application/json',
                               data={'name': 'Glow', 'phone': '254711000111',
                                     'plan_code': 'starter', 'owner_pin': '5678'})
        self.assertEqual(res.status_code, 201, res.content)
        biz = Business.objects.get(slug='glow')
        self.assertTrue(is_hashed(biz.owner_pin))
        self.assertTrue(check_pin('5678', biz.owner_pin))
        self.assertNotIn('5678', biz.owner_pin)

    def test_owner_login_success_and_lazy_upgrade(self):
        res = self.client.post('/api/owner-login/', content_type='application/json',
                               data={'identifier': 'kempinski', 'pin': '1234'})
        self.assertEqual(res.status_code, 200, res.content)
        self.biz.refresh_from_db()
        self.assertTrue(is_hashed(self.biz.owner_pin))
        # Old plaintext PIN keeps working after the lazy upgrade.
        res = self.client.post('/api/owner-login/', content_type='application/json',
                               data={'identifier': 'kempinski', 'pin': '1234'})
        self.assertEqual(res.status_code, 200)

    def test_owner_login_rate_limit_lockout(self):
        payload = {'identifier': 'kempinski', 'pin': '0000'}
        for _ in range(10):
            res = self.client.post('/api/owner-login/', content_type='application/json', data=payload)
            self.assertEqual(res.status_code, 401)
        res = self.client.post('/api/owner-login/', content_type='application/json', data=payload)
        self.assertEqual(res.status_code, 429)

    def test_owner_login_not_case_sensitive_on_slug(self):
        res = self.client.post('/api/owner-login/', content_type='application/json',
                               data={'identifier': 'KEMPINSKI', 'pin': '1234'})
        self.assertEqual(res.status_code, 200)


class BillLifecycleTest(Base):
    def create_bill(self, status_flow=True):
        res = self.client.post('/api/bills/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'customer_name': 'Wanjiru', 'staff_id': self.staffer.id,
                                     'items': [{'name': 'Braids', 'price': 1500}]})
        self.assertEqual(res.status_code, 201, res.content)
        return Bill.objects.get(code=res.data['code'])

    def test_draft_when_no_named_items(self):
        # Items without a name are skipped; a bill with no priced lines falls
        # back to draft instead of asking a customer to verify KSh 0.
        res = self.client.post('/api/bills/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'customer_name': 'X', 'staff_id': self.staffer.id,
                                     'items': [{'name': '', 'price': 100}]})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['status'], 'draft')

    def test_verify_then_pay_and_no_repay(self):
        bill = self.create_bill()
        res = self.client.post(f'/api/bills/{bill.code}/verify/', content_type='application/json',
                               data={'payment_method': 'M-Pesa'})
        self.assertEqual(res.status_code, 200)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'approved')
        self.assertIsNotNone(bill.approved_at)

        res = self.client.post(f'/api/bills/{bill.code}/pay/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'method': 'Cash'})
        self.assertEqual(res.status_code, 200)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'paid')
        self.assertEqual(bill.payment_method, 'Cash')

        res = self.client.post(f'/api/bills/{bill.code}/pay/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'method': 'Cash'})
        self.assertEqual(res.status_code, 409)
        res = self.client.post(f'/api/bills/{bill.code}/verify/', content_type='application/json',
                               data={'payment_method': 'Cash'})
        self.assertEqual(res.status_code, 409)

    def test_verify_requires_valid_payment_method(self):
        bill = self.create_bill()
        res = self.client.post(f'/api/bills/{bill.code}/verify/', content_type='application/json',
                               data={'payment_method': 'Bitcoin'})
        self.assertEqual(res.status_code, 400)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'pending')

    def test_dispute_flow(self):
        bill = self.create_bill()
        res = self.client.post(f'/api/bills/{bill.code}/verify/', content_type='application/json',
                               data={'dispute': True, 'note': 'Did not do my nails'})
        self.assertEqual(res.status_code, 200)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'disputed')
        self.assertEqual(bill.dispute_note, 'Did not do my nails')
        self.assertTrue(AuditEvent.objects.filter(bill=bill, type='disputed').exists())

    def test_paid_bill_cannot_be_voided(self):
        bill = self.create_bill()
        self.client.post(f'/api/bills/{bill.code}/verify/', content_type='application/json',
                         data={'payment_method': 'Cash'})
        self.client.post(f'/api/bills/{bill.code}/pay/', content_type='application/json',
                         headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'}, data={})
        res = self.client.post(f'/api/bills/{bill.code}/void/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'}, data={})
        self.assertEqual(res.status_code, 409)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'paid')

    def test_void_needs_owner_pin(self):
        bill = self.create_bill()
        res = self.client.post(f'/api/bills/{bill.code}/void/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski'}, data={})
        self.assertEqual(res.status_code, 401)

    def test_edit_only_while_pending(self):
        bill = self.create_bill()
        item = bill.items.first()
        res = self.client.post(f'/api/bills/{bill.code}/edit/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'changes': [{'item_id': item.id, 'new_price': 2000}],
                                     'reason': 'Longer braids'})
        self.assertEqual(res.status_code, 200)
        bill.refresh_from_db()
        self.assertEqual(bill.total, 2000)

        self.client.post(f'/api/bills/{bill.code}/verify/', content_type='application/json',
                         data={'payment_method': 'Cash'})
        res = self.client.post(f'/api/bills/{bill.code}/edit/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'changes': [{'item_id': item.id, 'new_price': 5}]})
        self.assertEqual(res.status_code, 409)


class PlanCapTest(Base):
    def setUp(self):
        super().setUp()
        self.biz.plan.monthly_verified_bills = 1
        self.biz.plan.save()

    def _bill(self):
        return Bill.objects.create(business=self.biz, code=views.gen_code(),
                                   customer_name='C', staff=self.staffer, status='pending',
                                   total=500)

    def test_create_bill_blocked_when_expired(self):
        self.biz.trial_ends_at = timezone.now() - timedelta(days=1)
        self.biz.save(update_fields=['trial_ends_at'])
        res = self.client.post('/api/bills/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'customer_name': 'C', 'staff_id': self.staffer.id,
                                     'items': [{'name': 'Wash', 'price': 300}]})
        self.assertEqual(res.status_code, 402)

    def test_verify_blocked_at_cap(self):
        b1 = self._bill()
        res = self.client.post(f'/api/bills/{b1.code}/verify/', content_type='application/json',
                               data={'payment_method': 'Cash'})
        self.assertEqual(res.status_code, 200)
        b2 = self._bill()
        res = self.client.post(f'/api/bills/{b2.code}/verify/', content_type='application/json',
                               data={'payment_method': 'Cash'})
        self.assertEqual(res.status_code, 402)

    def test_voided_bills_do_not_count_toward_cap(self):
        b1 = self._bill()
        self.client.post(f'/api/bills/{b1.code}/verify/', content_type='application/json',
                         data={'payment_method': 'Cash'})
        self.client.post(f'/api/bills/{b1.code}/void/', content_type='application/json',
                         headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'}, data={})
        b2 = self._bill()
        res = self.client.post(f'/api/bills/{b2.code}/verify/', content_type='application/json',
                               data={'payment_method': 'Cash'})
        self.assertEqual(res.status_code, 200)


class MpesaSettlementTest(Base):
    def _payment(self, amount=None):
        return MpesaPayment.objects.create(
            business=self.biz, plan=self.biz.plan, cycle='monthly',
            amount=amount if amount is not None else self.biz.plan.price_monthly,
            phone='254711000111', status='pending', checkout_request_id=views.gen_code() + '-CR')

    def callback(self, pay, code='0', receipt='SJ84K2ABCD', amount=None):
        body = {'Body': {'stkCallback': {
            'CheckoutRequestID': pay.checkout_request_id,
            'ResultCode': code, 'ResultDesc': 'ok' if code == '0' else 'cancelled',
            'CallbackMetadata': {'Item': [
                {'Name': 'Amount', 'Value': pay.amount if amount is None else amount},
                {'Name': 'MpesaReceiptNumber', 'Value': receipt}]}}}}
        return self.client.post('/api/mpesa/callback/', content_type='application/json', data=body)

    def test_callback_success_extends_subscription(self):
        pay = self._payment()
        res = self.callback(pay)
        self.assertEqual(res.status_code, 200)
        pay.refresh_from_db()
        self.biz.refresh_from_db()
        self.assertEqual(pay.status, 'success')
        self.assertEqual(pay.mpesa_receipt, 'SJ84K2ABCD')
        self.assertEqual(self.biz.subscription_info()['state'], 'paid')

    def test_duplicate_callback_does_not_extend_twice(self):
        pay = self._payment()
        self.callback(pay)
        self.biz.refresh_from_db()
        before = self.biz.plan_paid_until
        res = self.callback(pay)
        self.assertEqual(res.status_code, 200)
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.plan_paid_until, before)

    def test_amount_mismatch_rejected(self):
        pay = self._payment()
        res = self.callback(pay, amount=1)
        self.assertEqual(res.status_code, 200)
        pay.refresh_from_db()
        self.biz.refresh_from_db()
        self.assertEqual(pay.status, 'failed')
        self.assertIn('mismatch', pay.result_desc.lower())
        self.assertEqual(self.biz.subscription_info()['state'], 'trial')

    def test_callback_failure_marks_cancelled(self):
        pay = self._payment()
        self.callback(pay, code='1032')
        pay.refresh_from_db()
        self.assertEqual(pay.status, 'cancelled')

    def test_poll_settles_success_under_lock(self):
        pay = self._payment()
        with override_settings(MPESA_SIMULATE=False):
            with mock.patch.object(views, 'stk_query', return_value='0'):
                res = self.client.get(f'/api/mpesa/status/{pay.id}/',
                                      headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'})
        self.assertEqual(res.status_code, 200)
        pay.refresh_from_db()
        self.biz.refresh_from_db()
        self.assertEqual(pay.status, 'success')
        self.assertEqual(self.biz.subscription_info()['state'], 'paid')

    def test_poll_failure_respects_grace_window(self):
        pay = self._payment()
        with override_settings(MPESA_SIMULATE=False):
            with mock.patch.object(views, 'stk_query', return_value='1032'):
                self.client.get(f'/api/mpesa/status/{pay.id}/',
                                headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'})
        pay.refresh_from_db()
        self.assertEqual(pay.status, 'pending')  # inside 30s grace

        MpesaPayment.objects.filter(id=pay.id).update(
            created_at=timezone.now() - timedelta(seconds=views.STK_QUERY_FAILURE_GRACE_SECONDS + 5))
        with override_settings(MPESA_SIMULATE=False):
            with mock.patch.object(views, 'stk_query', return_value='1032'):
                self.client.get(f'/api/mpesa/status/{pay.id}/',
                                headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'})
        pay.refresh_from_db()
        self.assertEqual(pay.status, 'cancelled')

    def test_callback_bad_token_rejected_when_configured(self):
        pay = self._payment()
        with override_settings(MPESA_CALLBACK_TOKEN='sekrit'):
            res = self.client.post('/api/mpesa/callback/?token=wrong',
                                   content_type='application/json',
                                   data={'Body': {'stkCallback': {
                                       'CheckoutRequestID': pay.checkout_request_id,
                                       'ResultCode': '0'}}})
        self.assertEqual(res.status_code, 200)
        pay.refresh_from_db()
        self.assertEqual(pay.status, 'pending')


class ReceiptRedemptionTest(Base):
    def setUp(self):
        super().setUp()
        self.bill = Bill.objects.create(business=self.biz, code=views.gen_code(),
                                        customer_name='Njeri', staff=self.staffer,
                                        status='approved', total=2000)

    def test_plan_redemption_hashes_into_ledger_once(self):
        res = self.client.post('/api/mpesa/redeem-plan/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'receipt': 'QA99ZZ111', 'cycle': 'monthly'})
        self.assertEqual(res.status_code, 201, res.content)
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.subscription_info()['state'], 'paid')
        self.assertTrue(MpesaPayment.objects.filter(mpesa_receipt='QA99ZZ111').exists())

        res = self.client.post('/api/mpesa/redeem-plan/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'receipt': 'QA99ZZ111', 'cycle': 'monthly'})
        self.assertEqual(res.status_code, 409)

    def test_bill_redemption_marks_paid_once(self):
        res = self.client.post('/api/mpesa/redeem-bill/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'code': self.bill.code, 'receipt': 'RB22CC333'})
        self.assertEqual(res.status_code, 200, res.content)
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, 'paid')
        self.assertEqual(self.bill.payment_ref, 'RB22CC333')

        other = Bill.objects.create(business=self.biz, code=views.gen_code(),
                                    customer_name='Zawadi', staff=self.staffer,
                                    status='approved', total=100)
        res = self.client.post('/api/mpesa/redeem-bill/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'code': other.code, 'receipt': 'RB22CC333'})
        self.assertEqual(res.status_code, 409)
        other.refresh_from_db()
        self.assertEqual(other.status, 'approved')

    def test_receipt_shared_across_ledger_and_bills(self):
        res = self.client.post('/api/mpesa/redeem-bill/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'code': self.bill.code, 'receipt': 'SH44DD555'})
        self.assertEqual(res.status_code, 200)
        res = self.client.post('/api/mpesa/redeem-plan/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'receipt': 'SH44DD555', 'cycle': 'monthly'})
        self.assertEqual(res.status_code, 409)

    def test_redeem_bill_rejected_before_verification(self):
        pending = Bill.objects.create(business=self.biz, code=views.gen_code(),
                                      customer_name='M', staff=self.staffer,
                                      status='pending', total=100)
        res = self.client.post('/api/mpesa/redeem-bill/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'code': pending.code, 'receipt': 'NE55FF666'})
        self.assertEqual(res.status_code, 409)


class StaffInviteTest(Base):
    def test_invite_accept_creates_hashed_staff_pin_and_session(self):
        res = self.client.post('/api/invites/create/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'name': 'Naliaka', 'staff_pin': '4455'})
        self.assertEqual(res.status_code, 201, res.content)
        inv = StaffInvite.objects.get(code=res.data['code'])
        self.assertTrue(is_hashed(inv.staff_pin))

        res = self.client.post('/api/invites/accept/', content_type='application/json',
                               data={'code': inv.code, 'staff_pin': '4455'})
        self.assertEqual(res.status_code, 201, res.content)
        token = res.data['token']
        member = StaffMember.objects.get(business=self.biz, name='Naliaka')
        self.assertTrue(is_hashed(member.staff_pin))
        self.assertTrue(check_pin('4455', member.staff_pin))

        res = self.client.post('/api/bills/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski',
                                        'x-sp-staff-token': token},
                               data={'customer_name': 'C', 'staff_id': member.id,
                                     'items': [{'name': 'Wash', 'price': 200}]})
        self.assertEqual(res.status_code, 201)

    def test_wrong_invite_pin_rejected(self):
        res = self.client.post('/api/invites/create/', content_type='application/json',
                               headers={'x-sp-business': 'kempinski', 'x-sp-pin': '1234'},
                               data={'name': 'Otieno', 'staff_pin': '7788'})
        inv = StaffInvite.objects.get(code=res.data['code'])
        res = self.client.post('/api/invites/accept/', content_type='application/json',
                               data={'code': inv.code, 'staff_pin': '0000'})
        self.assertEqual(res.status_code, 401)


class PlatformAdminTest(Base):
    def test_requires_configured_key(self):
        with override_settings(ADMIN_KEY=''):
            res = self.client.get('/api/platform-admin/overview/',
                                  headers={'x-sp-admin-key': 'saloonos-master-2026'})
            self.assertEqual(res.status_code, 401)

    def test_wrong_key_rejected(self):
        res = self.client.get('/api/platform-admin/overview/', headers={'x-sp-admin-key': 'nope'})
        self.assertEqual(res.status_code, 401)

    def test_business_directory_has_no_pin_column(self):
        with override_settings(ADMIN_KEY='k', DEBUG=True):
            res = self.client.get('/api/platform-admin/businesses/', headers={'x-sp-admin-key': 'k'})
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('owner_pin', res.json()['businesses'][0])

    def test_pin_reset_stores_hash(self):
        with override_settings(ADMIN_KEY='k', DEBUG=True):
            res = self.client.post('/api/platform-admin/businesses/kempinski/',
                                   content_type='application/json', headers={'x-sp-admin-key': 'k'},
                                   data={'owner_pin': '9876'})
        self.assertEqual(res.status_code, 200, res.content)
        self.biz.refresh_from_db()
        self.assertTrue(is_hashed(self.biz.owner_pin))
        self.assertTrue(check_pin('9876', self.biz.owner_pin))

    def test_extend_paid_days(self):
        with override_settings(ADMIN_KEY='k', DEBUG=True):
            res = self.client.post('/api/platform-admin/businesses/kempinski/',
                                   content_type='application/json', headers={'x-sp-admin-key': 'k'},
                                   data={'paid_days_add': 30})
        self.assertEqual(res.status_code, 200, res.content)
        self.biz.refresh_from_db()
        self.assertEqual(self.biz.subscription_info()['state'], 'paid')


class CodeGenerationTest(TestCase):
    def test_codes_are_uppercase_alnum_six(self):
        for _ in range(50):
            code = views.gen_code()
            self.assertEqual(len(code), 6)
            self.assertRegex(code, r'^[A-Z0-9]+$')

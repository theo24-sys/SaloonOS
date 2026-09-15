import calendar
import hashlib
import logging
import random
import re
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Sum, Count, Q, F
from django.utils import timezone
from rest_framework import status as http
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from .models import (Plan, Business, StaffMember, Service, Bill, BillItem,
                     BillEdit, AuditEvent, MpesaPayment, StaffInvite, StaffSession)
from .mpesa import DarajaError, stk_push, stk_query, normalize_phone
from .storage import ImageStorageError, MAX_LOGO_DATA_URL_LENGTH, store_logo
from .serializers import (PlanSerializer, BusinessSerializer, BillSerializer,
                          ServiceSerializer, StaffSerializer, audit)

logger = logging.getLogger(__name__)


class Invalid(APIException):
    status_code = http.HTTP_400_BAD_REQUEST
    default_detail = 'Invalid request'


class Unauthorized(APIException):
    status_code = http.HTTP_401_UNAUTHORIZED
    default_detail = 'Unauthorized'


class Conflict(APIException):
    status_code = http.HTTP_409_CONFLICT
    default_detail = 'Conflict'


class PaymentRequired(APIException):
    status_code = http.HTTP_402_PAYMENT_REQUIRED
    default_detail = 'Plan limit reached'


def get_business(request):
    """Business context via X-SP-Business slug header."""
    slug = request.headers.get('X-SP-Business', '')
    if not slug:
        raise Invalid('Missing X-SP-Business header')
    try:
        return Business.objects.get(slug=slug)
    except Business.DoesNotExist:
        raise Invalid('Unknown business')


def require_owner_pin(request, business):
    pin = request.headers.get('X-SP-PIN', '')
    if pin != business.owner_pin:
        raise Unauthorized('Invalid owner PIN')


def require_operator(request, business):
    """Allow a verified owner or an active invited staff session."""
    if request.headers.get('X-SP-PIN', '') == business.owner_pin:
        require_active_subscription(business)
        return None
    token = request.headers.get('X-SP-Staff-Token', '')
    if token:
        session = StaffSession.objects.select_related('staff').filter(
            business=business,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            revoked_at__isnull=True,
        ).first()
        if session:
            require_active_subscription(business)
            return session.staff
    raise Unauthorized('Sign in with your staff invite or owner PIN')


def gen_code():
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(random.choices(alphabet, k=6))


# --- Public: plans & signup -------------------------------------------------

# Render and uptime monitors probe the service root. Keep this lightweight and
# unauthenticated; application traffic continues to use the /api/* routes.
@api_view(['GET', 'HEAD'])
@permission_classes([])
def health(request):
    return Response({'ok': True, 'service': 'saloonos-api'})


@api_view(['GET'])
@permission_classes([])
def plans(request):
    return Response(PlanSerializer(Plan.objects.all(), many=True).data)


@api_view(['POST'])
@permission_classes([])
def signup(request):
    name = (request.data.get('name') or '').strip()
    phone = (request.data.get('phone') or '').strip()
    plan_code = request.data.get('plan_code') or 'starter'
    owner_pin = str(request.data.get('owner_pin') or '').strip()
    if not name or not phone or len(owner_pin) < 4:
        return Response({'error': 'name, phone and a 4+ digit owner_pin are required'},
                        status=http.HTTP_400_BAD_REQUEST)
    plan = Plan.objects.filter(code=plan_code).first()
    if not plan:
        return Response({'error': 'Unknown plan'}, status=http.HTTP_400_BAD_REQUEST)

    base = ''.join(ch for ch in name.lower() if ch.isalnum())[:20] or 'salon'
    slug, n = base, 1
    while Business.objects.filter(slug=slug).exists():
        n += 1
        slug = f"{base}{n}"

    biz = Business.objects.create(name=name, slug=slug, plan=plan,
                                  owner_pin=owner_pin, phone=phone[:20])
    return Response(BusinessSerializer(biz).data, status=http.HTTP_201_CREATED)


def _login_phone_digits(value):
    digits = ''.join(ch for ch in str(value) if ch.isdigit())
    return '254' + digits[1:] if digits.startswith('0') and len(digits) == 10 else digits


@api_view(['POST'])
@permission_classes([])
def owner_login(request):
    """Resolve a business username or registered phone before PIN auth."""
    identifier = str(request.data.get('identifier') or '').strip()
    pin = str(request.data.get('pin') or '').strip()
    if not identifier or not pin:
        raise Unauthorized('Enter your business username or phone number and PIN')

    matches = list(Business.objects.filter(
        Q(slug__iexact=identifier) | Q(name__iexact=identifier)
    ))
    if not matches:
        digits = _login_phone_digits(identifier)
        if digits:
            matches = [
                biz for biz in Business.objects.exclude(phone='')
                if _login_phone_digits(biz.phone) == digits
            ]
    if len(matches) != 1 or matches[0].owner_pin != pin:
        raise Unauthorized('Invalid username or phone number and PIN')
    return Response({'slug': matches[0].slug, 'name': matches[0].name})


# --- Catalog -----------------------------------------------------------------

@api_view(['GET'])
@permission_classes([])
def catalog(request):
    biz = get_business(request)
    return Response({
        'business': BusinessSerializer(biz).data,
        'subscription': biz.subscription_info(),
        'services': ServiceSerializer(biz.services.all(), many=True).data,
        'staff': StaffSerializer(biz.staff.exclude(staff_pin=''), many=True).data,
    })


@api_view(['POST'])
@permission_classes([])
def branding(request):
    """Owner edits business branding. Trust elements are not editable here."""
    biz = get_business(request)
    require_owner_pin(request, biz)
    allowed = {'tagline': 120, 'phone': 20, 'location': 120,
               'accent': 10, 'thank_you': 150}
    for field, max_len in allowed.items():
        if field in request.data:
            val = str(request.data.get(field) or '').strip()[:max_len]
            if field == 'accent' and val not in ('blush', 'rose', 'luxe', 'plum', 'minimal'):
                return Response({'error': 'Unknown accent'}, status=http.HTTP_400_BAD_REQUEST)
            setattr(biz, field, val)
    if 'logo_data_url' in request.data:
        logo = str(request.data.get('logo_data_url') or '')
        if logo and logo == biz.logo_data_url:
            pass
        elif logo and (not logo.startswith('data:image/') or len(logo) > MAX_LOGO_DATA_URL_LENGTH):
            raise Invalid('Logo must be an image smaller than 5 MB')
        else:
            try:
                biz.logo_data_url = store_logo(logo, biz.slug)
            except ImageStorageError as exc:
                raise Invalid(str(exc))
    biz.save()
    return Response(BusinessSerializer(biz).data)


@api_view(['POST'])
@permission_classes([])
def add_staff(request):
    biz = get_business(request)
    require_owner_pin(request, biz)
    require_active_subscription(biz)
    name = (request.data.get('name') or '').strip()
    if not name:
        return Response({'error': 'name required'}, status=http.HTTP_400_BAD_REQUEST)
    staff_limit = max(2, biz.plan.max_staff)
    managed_staff_count = biz.staff.exclude(staff_pin='').count()
    if managed_staff_count >= staff_limit:
        return Response(
            {'error': f"Your {biz.plan.name} plan allows {staff_limit} staff. Upgrade to add more."},
            status=http.HTTP_402_PAYMENT_REQUIRED)
    member, created = StaffMember.objects.get_or_create(business=biz, name=name)
    return Response(StaffSerializer(member).data, status=http.HTTP_201_CREATED if created else http.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([])
def remove_staff(request, staff_id):
    """Revoke staff access while preserving historical bills."""
    biz = get_business(request)
    require_owner_pin(request, biz)
    member = biz.staff.filter(id=staff_id).first()
    if not member:
        raise Invalid('Staff member not found')
    member.staff_pin = ''
    member.save(update_fields=['staff_pin'])
    member.sessions.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
    biz.staff_invites.filter(name=member.name, used=False).update(
        used=True, used_at=timezone.now())
    return Response({'ok': True, 'name': member.name})


@api_view(['POST'])
@permission_classes([])
def add_service(request):
    biz = get_business(request)
    require_owner_pin(request, biz)
    require_active_subscription(biz)
    name = (request.data.get('name') or '').strip()
    price = request.data.get('price')
    if not name or price is None:
        return Response({'error': 'name and price required'}, status=http.HTTP_400_BAD_REQUEST)
    svc, _ = Service.objects.update_or_create(
        business=biz, name=name, defaults={'default_price': int(price)})
    return Response(ServiceSerializer(svc).data, status=http.HTTP_201_CREATED)


# --- Bills -------------------------------------------------------------------

def verified_count_this_month(biz):
    now = timezone.now()
    return Bill.objects.filter(
        business=biz,
        status__in=['approved', 'paid'],
        approved_at__year=now.year, approved_at__month=now.month,
    ).count()


@api_view(['POST'])
@permission_classes([])
@transaction.atomic
def create_bill(request):
    biz = get_business(request)
    operator = require_operator(request, biz)
    customer = (request.data.get('customer_name') or '').strip()
    customer_phone = (request.data.get('customer_phone') or '').strip()
    staff_id = request.data.get('staff_id')
    items = request.data.get('items') or []
    if not customer or not staff_id or not items:
        return Response({'error': 'customer_name, staff_id, items required'},
                        status=http.HTTP_400_BAD_REQUEST)

    staff = operator or biz.staff.filter(id=staff_id).first()
    if not staff:
        return Response({'error': 'Unknown staff member'}, status=http.HTTP_400_BAD_REQUEST)

    # Subscription must be active (trial or paid) to create bills
    require_active_subscription(biz)

    # Plan limit: verified bills per month (pending bills are free to create)
    if verified_count_this_month(biz) >= biz.plan.monthly_verified_bills:
        raise PaymentRequired(
            f"{biz.plan.name} plan allows {biz.plan.monthly_verified_bills} verified bills/month. Upgrade to continue.")

    bill = Bill.objects.create(
        business=biz, code=gen_code(), customer_name=customer,
        customer_phone=customer_phone,
        staff=staff, status='pending', total=0)
    total = 0
    for it in items:
        name = str(it.get('name') or '').strip()
        price = max(0, int(it.get('price') or 0))
        if not name:
            continue
        BillItem.objects.create(bill=bill, name=name, price=price)
        total += price
    if total == 0:
        bill.status = 'draft'
        bill.save()
    bill.total = total
    bill.save()
    audit(bill, 'created', f"KSh {total} — served by {staff.name}")
    return Response(BillSerializer(bill, context={'request': request}).data, status=http.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([])
@transaction.atomic
def edit_bill(request, code):
    """Edit a pending bill's item prices. Every change is logged with a reason.
    Approved+ bills are immutable — void & re-create instead."""
    biz = get_business(request)
    operator = require_operator(request, biz)
    bill = Bill.objects.select_related('business').filter(code=code, business=biz).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    if bill.status != 'pending':
        raise Conflict(f"Bill is {bill.status} — it can no longer be edited. Void it and create a new one.")

    staff = operator or biz.staff.filter(id=request.data.get('staff_id')).first()
    reason = str(request.data.get('reason') or '').strip()
    for change in request.data.get('changes') or []:
        item = bill.items.filter(id=change.get('item_id')).first()
        if not item:
            continue
        new_price = max(0, int(change.get('new_price') or 0))
        if new_price != item.price:
            BillEdit.objects.create(bill=bill, item_name=item.name, old_price=item.price,
                                    new_price=new_price, reason=reason, edited_by=staff)
            audit(bill, 'edited', f"{item.name}: KSh {item.price} → KSh {new_price}"
                                  + (f" ({reason})" if reason else ' (no reason given)'))
            item.price = new_price
            item.save()
    bill.total = bill.items.aggregate(s=Sum('price'))['s'] or 0
    bill.save()
    return Response(BillSerializer(bill, context={'request': request}).data)


@api_view(['GET'])
@permission_classes([])
def get_bill(request, code):
    """Public customer fetch. Marks that the QR was scanned (audit)."""
    slug = request.headers.get('X-SP-Business', '')
    qs = Bill.objects.select_related('business', 'staff')
    bill = qs.filter(code=code, business__slug=slug).first() if slug else \
        qs.filter(code=code).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    if bill.status == 'pending' and not request.headers.get('X-SP-NoScan'):
        audit(bill, 'scanned', 'Customer opened the bill')
    return Response(BillSerializer(bill, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([])
def verify_bill(request, code):
    bill = Bill.objects.filter(code=code).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    if bill.status != 'pending':
        raise Conflict(f"Bill is already {bill.status}")
    require_active_subscription(bill.business)
    if verified_count_this_month(bill.business) >= bill.business.plan.monthly_verified_bills:
        raise PaymentRequired(
            f"{bill.business.plan.name} plan allows {bill.business.plan.monthly_verified_bills} "
            "verified bills/month. The salon must upgrade to verify this bill.")
    note = str(request.data.get('note') or '').strip()
    if request.data.get('dispute'):
        bill.status = 'disputed'
        bill.dispute_note = note
        audit(bill, 'disputed', note or 'Customer reported a problem')
    else:
        bill.status = 'approved'
        bill.approved_at = timezone.now()
        audit(bill, 'verified', f"Customer {bill.customer_name} verified the bill")
    bill.save()
    return Response(BillSerializer(bill, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([])
def pay_bill(request, code):
    biz = get_business(request)
    require_operator(request, biz)
    bill = Bill.objects.filter(code=code, business=biz).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    if bill.status == 'pending':
        raise Conflict('Customer has not verified this bill yet')
    if bill.status == 'disputed':
        raise Conflict('Bill is disputed — resolve with the customer first')
    if bill.status != 'approved':
        raise Conflict(f"Bill is {bill.status}")
    method = request.data.get('method') or 'M-Pesa'
    bill.status = 'paid'
    bill.payment_method = method
    bill.paid_at = timezone.now()
    bill.save()
    audit(bill, 'paid', f"KSh {bill.total} recorded — {method}")
    return Response(BillSerializer(bill, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([])
def void_bill(request, code):
    biz = get_business(request)
    require_owner_pin(request, biz)
    bill = Bill.objects.filter(code=code, business=biz).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    if bill.status in ('paid', 'refunded'):
        raise Conflict(f"Paid bills must be refunded, not voided")
    bill.status = 'voided'
    bill.save()
    audit(bill, 'voided', str(request.data.get('reason') or 'Voided by owner'))
    return Response(BillSerializer(bill, context={'request': request}).data)


# --- Subscription gating ------------------------------------------------------

def require_active_subscription(biz):
    """Trial or paid period must be active to create/verify bills."""
    info = biz.subscription_info()
    if info['state'] == 'expired':
        raise PaymentRequired(
            "Your trial has ended. Pay your plan via M-Pesa to keep verifying bills "
            "(Owner dashboard → Billing).")


# --- Plan payments (M-Pesa STK push) -------------------------------------------

STK_QUERY_FAILURE_GRACE_SECONDS = 30

def _grant(biz, plan, cycle, until):
    """Extend a subscription to `until`, stacking past the current end."""
    biz.plan = plan
    biz.plan_paid_until = until
    biz.save(update_fields=['plan', 'plan_paid_until'])


def _add_months(dt, months):
    """Same-day-of-month arithmetic, clamped for short months (Jan 31 + 1mo)."""
    y, m = dt.year, dt.month + months
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    days_in = calendar.monthrange(y, m)[1]
    day = min(dt.day, days_in)
    return dt.replace(year=y, month=m, day=day)


def _settle_success(biz, pay):
    """Shared by callback + poll: mark success and extend the subscription,
    stacking past the current paid-until date."""
    plan, cycle = pay.plan, pay.cycle
    now = timezone.now()
    # Monthly payments buy 30 days; annual buys 365 (no calendar drift).
    base = max(now, biz.plan_paid_until or now)
    days = 365 if cycle == 'annual' else 30
    until = base + timedelta(days=days)

    pay.status = 'success'
    pay.extends_until = until
    pay.completed_at = now
    # mpesa_receipt is assigned by the caller (callback) before settling
    pay.save(update_fields=['status', 'extends_until', 'completed_at', 'mpesa_receipt'])
    _grant(biz, plan, cycle, until)
    return until


def _settle_failure(biz, pay, result_code, desc):
    pay.status = {'1032': 'cancelled', '1037': 'timeout'}.get(result_code, 'failed')
    description = desc or ''
    if result_code == '2029' and not description:
        description = 'Safaricom could not complete this Buy Goods payment. Confirm the till, phone, and merchant account settings.'
    pay.result_desc = description[:255]
    pay.completed_at = timezone.now()
    pay.save(update_fields=['status', 'result_desc', 'completed_at'])


@api_view(['POST'])
@permission_classes([])
def mpesa_stk(request):
    """Owner initiates a plan payment: STK push to their phone."""
    biz = get_business(request)
    require_owner_pin(request, biz)
    try:
        phone = normalize_phone(request.data.get('phone') or '')
    except DarajaError as e:
        raise Invalid(str(e))
    cycle = request.data.get('cycle') or 'monthly'
    plan_code = request.data.get('plan_code') or biz.plan.code
    if cycle not in ('monthly', 'annual'):
        raise Invalid('cycle must be monthly or annual')
    plan = Plan.objects.filter(code=plan_code).first()
    if not plan:
        raise Invalid('Unknown plan')

    amount = plan.price_annual if cycle == 'annual' else plan.price_monthly
    logger.info("mpesa_initiate business=%s plan=%s cycle=%s amount=%s phone_suffix=%s environment=%s simulated=%s transaction_type=%s callback_configured=%s",
                biz.slug, plan.code, cycle, amount, phone[-4:], settings.MPESA_ENVIRONMENT,
                settings.MPESA_SIMULATE, settings.MPESA_TRANSACTION_TYPE, bool(settings.MPESA_CALLBACK_URL))
    if not settings.MPESA_CALLBACK_URL and not settings.MPESA_SIMULATE:
        raise Invalid('MPESA_CALLBACK_URL is not configured on the server')

    pay = MpesaPayment.objects.create(
        business=biz, plan=plan, cycle=cycle, amount=amount, phone=phone)
    try:
        checkout_id, merchant_id = stk_push(
            phone, amount, biz.slug,
            f'SaloonOS {plan.name} {cycle}',
            settings.MPESA_CALLBACK_URL)
    except DarajaError as e:
        logger.error("mpesa_initiate_failed business=%s error=%s", biz.slug, e)
        pay.status = 'failed'
        pay.result_desc = str(e)[:255]
        pay.save(update_fields=['status', 'result_desc'])
        return Response({'error': str(e)}, status=http.HTTP_502_BAD_GATEWAY)

    pay.checkout_request_id = checkout_id
    pay.merchant_request_id = merchant_id or ''
    pay.save(update_fields=['checkout_request_id', 'merchant_request_id'])
    logger.info("mpesa_payment_created payment_id=%s business=%s checkout_suffix=%s",
                pay.id, biz.slug, checkout_id[-10:])
    return Response({
        'payment_id': pay.id,
        'checkout_request_id': checkout_id,
        'status': pay.status,
        'amount': amount,
        'phone': phone,
        'message': f'STK push sent to {phone}. Enter your M-Pesa PIN to approve.'
                   if not settings.MPESA_SIMULATE else
                   f'[SIMULATED] STK push for KSh {amount} to {phone}.',
    }, status=http.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([])
def mpesa_status(request, payment_id):
    """Poll a payment. Settles via Daraja STK query; callback remains authoritative."""
    biz = get_business(request)
    require_owner_pin(request, biz)
    pay = biz.mpesa_payments.filter(id=payment_id).first()
    if not pay:
        return Response({'error': 'Payment not found'}, status=http.HTTP_404_NOT_FOUND)

    if pay.status == 'pending' and not settings.MPESA_SIMULATE:
        try:
            rc = stk_query(pay.checkout_request_id)
        except DarajaError as e:
            logger.warning("mpesa_status_query_failed payment_id=%s checkout_suffix=%s error=%s",
                           pay.id, pay.checkout_request_id[-10:], e)
            rc = None
        logger.info("mpesa_status_observed payment_id=%s stored_status=%s query_result=%s",
                    pay.id, pay.status, rc)
        if rc == '0':
            _settle_success(biz, pay)
        elif rc not in (None, 'PENDING'):
            age = (timezone.now() - pay.created_at).total_seconds()
            if age >= STK_QUERY_FAILURE_GRACE_SECONDS:
                _settle_failure(biz, pay, rc, 'Failed (query)')

    pay.refresh_from_db()
    return Response({
        'payment_id': pay.id, 'status': pay.status,
        'mpesa_receipt': pay.mpesa_receipt, 'result_desc': pay.result_desc,
        'amount': pay.amount, 'cycle': pay.cycle,
        'subscription': biz.subscription_info(),
    })


@api_view(['POST', 'GET'])
@permission_classes([])
def mpesa_callback(request):
    """Daraja calls this when the customer enters their PIN (or it fails).
    3rd-party result payloads carry Base64-encoded encrypted credentials in the
    query string; since we only ever initiate for our own shortcode, matching by
    CheckoutRequestID is sufficient and avoids the decryption dependency."""
    from urllib.parse import parse_qs
    qs = parse_qs(request.META.get('QUERY_STRING', ''))
    token = (qs.get('token') or [''])[0]

    body = request.data if isinstance(request.data, dict) else {}
    stk = body.get('Body', {}).get('stkCallback', {}) or {}
    checkout_id = stk.get('CheckoutRequestID', '')
    result_code = str(stk.get('ResultCode', ''))
    result_desc = str(stk.get('ResultDesc', ''))
    items = {i.get('Name'): i.get('Value') for i in stk.get('CallbackMetadata', {}).get('Item', [])}
    receipt = str(items.get('MpesaReceiptNumber', ''))
    amount = int(items.get('Amount', 0) or 0)
    logger.info("mpesa_callback_received method=%s checkout_suffix=%s result_code=%s description=%s amount=%s keys=%s",
                request.method, str(checkout_id)[-10:] if checkout_id else "none",
                result_code or "missing", result_desc[:120], amount, sorted(stk.keys()))

    if not checkout_id:
        logger.warning("mpesa_callback_ignored reason=missing_checkout_id")
        return Response({'ResultCode': 0, 'ResultDesc': 'Ignored: no CheckoutRequestID'})

    pay = MpesaPayment.objects.filter(checkout_request_id=checkout_id).select_related('business').first()
    if not pay:
        logger.warning("mpesa_callback_ignored reason=unknown_checkout checkout_suffix=%s",
                       checkout_id[-10:])
        return Response({'ResultCode': 0, 'ResultDesc': 'Unknown checkout — ignored'})

    # Optional shared-secret gate (set MPESA_CALLBACK_TOKEN to enable).
    expected = getattr(settings, 'MPESA_CALLBACK_TOKEN', '')
    if expected and token != expected:
        logger.warning("mpesa_callback_rejected payment_id=%s reason=bad_token", pay.id)
        return Response({'ResultCode': 0, 'ResultDesc': 'Rejected: bad token'})

    if pay.status == 'pending':
        if result_code == '0':
            if amount and pay.amount and amount != pay.amount:
                pay.result_desc = f'Amount mismatch: expected {pay.amount}, got {amount}'[:255]
                pay.status = 'failed'
                pay.completed_at = timezone.now()
                pay.save(update_fields=['result_desc', 'status', 'completed_at'])
                logger.error("mpesa_callback_amount_mismatch payment_id=%s expected=%s received=%s",
                             pay.id, pay.amount, amount)
            else:
                pay.mpesa_receipt = receipt
                _settle_success(pay.business, pay)
                logger.info("mpesa_callback_success payment_id=%s receipt_present=%s",
                            pay.id, bool(receipt))
        else:
            _settle_failure(pay.business, pay, result_code, result_desc)
            logger.warning("mpesa_callback_failure payment_id=%s result_code=%s description=%s",
                           pay.id, result_code, result_desc[:160])

    return Response({'ResultCode': 0, 'ResultDesc': 'Accepted'})


@api_view(['GET'])
@permission_classes([])
def mpesa_history(request):
    biz = get_business(request)
    require_owner_pin(request, biz)
    rows = biz.mpesa_payments.all()[:20]
    return Response({
        'payments': [{
            'id': p.id, 'plan': p.plan.name, 'cycle': p.cycle, 'amount': p.amount,
            'phone': p.phone, 'status': p.status, 'mpesa_receipt': p.mpesa_receipt,
            'created_at': p.created_at, 'extends_until': p.extends_until,
        } for p in rows],
        'subscription': biz.subscription_info(),
    })


# --- Scan-payment redemption (Paybill payments that bypass STK) ---------------

SCAN_CODE_RE = re.compile(r'^[A-Z0-9]{8,15}$')


def _receipt_taken(code):
    """A receipt code can only ever be redeemed once across the whole platform,
    whatever kind of payment it settles (plan or customer bill)."""
    if MpesaPayment.objects.filter(mpesa_receipt=code).exists():
        return True
    return Bill.objects.filter(payment_ref=code).exists()


def _mpesa_month_add(info, months):
    """Slide `months` forward over the subscription end, 30-day cycle."""
    base = max(timezone.now(), info['end'] or timezone.now())
    return base + timedelta(days=30 * months)


@api_view(['POST'])
@permission_classes([])
def redeem_scan_plan(request):
    """Owner redeems a Paybill-sticker payment: receipt code + cycle extends the plan.
    Processed synchronously — no human work, no waiting for a statement."""
    biz = get_business(request)
    require_owner_pin(request, biz)
    receipt = str(request.data.get('receipt') or '').strip().upper()
    cycle = request.data.get('cycle') or 'monthly'
    if not SCAN_CODE_RE.match(receipt):
        raise Invalid('Enter the M-Pesa receipt code (e.g. SJ84K2ABCD)')
    if cycle not in ('monthly', 'annual'):
        raise Invalid('cycle must be monthly or annual')
    if _receipt_taken(receipt):
        raise Conflict('That M-Pesa receipt has already been used.')

    plan = biz.plan
    amount = plan.price_annual if cycle == 'annual' else plan.price_monthly
    pay = MpesaPayment.objects.create(
        business=biz, plan=plan, cycle=cycle, amount=amount,
        phone='scanned', status='pending', checkout_request_id=f"SCAN-{receipt}")
    pay.mpesa_receipt = receipt
    until = _settle_success(biz, pay)
    return Response({
        'ok': True, 'plan': plan.name, 'amount': amount, 'mpesa_receipt': receipt,
        'subscription': biz.subscription_info(), 'paid_until': until,
    }, status=http.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([])
def redeem_scan_bill(request):
    """Staff confirms a customer's scan-to-pay on a verified bill: the receipt
    code marks the bill paid (same once-only guarantee)."""
    biz = get_business(request)
    bill = Bill.objects.filter(code=request.data.get('code') or '', business=biz).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    if bill.status == 'pending':
        raise Conflict('Customer has not verified this bill yet')
    if bill.status != 'approved':
        raise Conflict(f"Bill is {bill.status}")
    receipt = str(request.data.get('receipt') or '').strip().upper()
    if not SCAN_CODE_RE.match(receipt):
        raise Invalid('Enter the M-Pesa receipt code from the confirmation SMS')
    if _receipt_taken(receipt):
        raise Conflict('That M-Pesa receipt has already been used.')

    bill.status = 'paid'
    bill.payment_method = 'M-Pesa scan'
    bill.payment_ref = receipt
    bill.paid_at = timezone.now()
    bill.save(update_fields=['status', 'payment_method', 'payment_ref', 'paid_at'])
    audit(bill, 'paid', f"KSh {bill.total} paid via scan-to-pay — receipt {receipt}")
    return Response(BillSerializer(bill, context={'request': request}).data)


# --- Owner analytics -----------------------------------------------------------

@api_view(['GET'])
@permission_classes([])
def analytics(request):
    """Dashboard graphs: 14-day revenue trend, this-month vs last-month,
    staff leaderboard, top services, verification funnel, status donut."""
    biz = get_business(request)
    require_owner_pin(request, biz)

    today = timezone.localdate()
    month_start = today.replace(day=1)
    last_month_start = (month_start - timedelta(days=1)).replace(day=1)

    def revenue_since(d):
        return biz.bills.filter(status='paid', paid_at__date__gte=d) \
            .aggregate(s=Sum('total'))['s'] or 0

    # 14-day revenue trend (paid revenue by day)
    days, labels, series = 14, [], []
    per_day = dict(biz.bills.filter(status='paid', paid_at__date__gte=today - timedelta(days=13))
                   .values_list('paid_at__date')
                   .annotate(s=Sum('total')).values_list('paid_at__date', 's'))
    # values_list+annotate combo returns rows; rebuild safely:
    per_day = {
        row['d']: row['s']
        for row in biz.bills.filter(status='paid', paid_at__date__gte=today - timedelta(days=13))
        .values(d=F('paid_at__date')).annotate(s=Sum('total'))
    }
    for i in range(days):
        d = today - timedelta(days=13 - i)
        labels.append(d.strftime('%-d %b'))
        series.append(per_day.get(d) or 0)

    this_month = revenue_since(month_start)
    last_month = biz.bills.filter(status='paid',
                                  paid_at__date__gte=last_month_start,
                                  paid_at__date__lt=month_start) \
        .aggregate(s=Sum('total'))['s'] or 0
    mom_pct = round((this_month - last_month) * 100.0 / last_month, 1) if last_month else None

    # Staff leaderboard (this month, by collected revenue)
    staff_stats = list(biz.bills.filter(created_at__date__gte=month_start)
                       .values(staff_name=F('staff__name'))
                       .annotate(
                           bills=Count('id'),
                           collected=Sum('total', filter=Q(status='paid')),
                           verified=Count('id', filter=Q(status__in=['approved', 'paid'])),
                       ).order_by('-collected'))
    for s in staff_stats:
        s['collected'] = s['collected'] or 0
        s['verify_rate'] = round((s['verified'] or 0) * 100.0 / s['bills']) if s['bills'] else 0

    # Top services (this month, by revenue share of paid bills)
    top_services = list(BillItem.objects.filter(bill__business=biz, bill__status='paid',
                                                bill__paid_at__date__gte=month_start)
                        .values('name')
                        .annotate(revenue=Sum('price'), count=Count('id'))
                        .order_by('-revenue')[:6])

    # Verification funnel (this month): created → verified → paid
    month_qs = biz.bills.filter(created_at__date__gte=month_start)
    funnel = {
        'created': month_qs.count(),
        'verified': month_qs.filter(status__in=['approved', 'paid', 'disputed']).count(),
        'paid': month_qs.filter(status='paid').count(),
    }
    status_counts = dict(month_qs.values_list('status')
                         .annotate(c=Count('id')).values_list('status', 'c'))

    return Response({
        'trend': {'labels': labels, 'series': series},
        'month': {'this': this_month, 'last': last_month, 'mom_pct': mom_pct},
        'staff': staff_stats,
        'top_services': top_services,
        'funnel': funnel,
        'status_counts': status_counts,
        'subscription': biz.subscription_info(),
    })


# --- Staff invites ---------------------------------------------------------------

@api_view(['POST'])
@permission_classes([])
def invite_create(request):
    """Owner creates a staff invite; returns the secret link code."""
    biz = get_business(request)
    require_owner_pin(request, biz)
    require_active_subscription(biz)
    name = (request.data.get('name') or '').strip()
    staff_pin = str(request.data.get('staff_pin') or '').strip()
    if not name:
        raise Invalid('name required')
    if not staff_pin.isdigit() or not 4 <= len(staff_pin) <= 8:
        raise Invalid('staff_pin must be 4 to 8 digits')
    staff_limit = max(2, biz.plan.max_staff)
    managed_staff_count = biz.staff.exclude(staff_pin='').count()
    pending_invite_count = biz.staff_invites.filter(used=False).count()
    if managed_staff_count + pending_invite_count >= staff_limit:
        raise PaymentRequired(
            f"Your {biz.plan.name} plan allows {staff_limit} staff. Upgrade to add more.")
    inv = StaffInvite.objects.create(
        business=biz, name=name, staff_pin=staff_pin,
        code=gen_code() + gen_code(), created_by_pin=biz.owner_pin)
    return Response({
        'code': inv.code,
        'url': f"{settings.PUBLIC_BASE_URL.rstrip('/')}/app?invite={inv.code}",
        'name': inv.name,
    }, status=http.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([])
def invite_accept(request):
    """Staff member accepts an invite: creates the staff record.
    The business slug comes from the invite itself — no headers needed."""
    code = (request.data.get('code') or '').strip()
    staff_pin = str(request.data.get('staff_pin') or '').strip()
    inv = StaffInvite.objects.select_related('business').filter(code=code, used=False).first()
    if not inv:
        return Response({'error': 'This invite link is invalid or already used.'},
                        status=http.HTTP_400_BAD_REQUEST)
    if staff_pin != inv.staff_pin:
        return Response({'error': 'Incorrect staff PIN.'}, status=http.HTTP_401_UNAUTHORIZED)
    staff_limit = max(2, inv.business.plan.max_staff)
    managed_staff_count = inv.business.staff.exclude(staff_pin='').count()
    if not inv.business.staff.filter(name=inv.name).exclude(staff_pin='').exists() and managed_staff_count >= staff_limit:
        raise PaymentRequired(
            f"Your {inv.business.plan.name} plan allows {staff_limit} staff. Upgrade to add more.")
    member, created = StaffMember.objects.get_or_create(
        business=inv.business, name=inv.name,
        defaults={'staff_pin': inv.staff_pin},
    )
    if member.staff_pin != inv.staff_pin:
        member.staff_pin = inv.staff_pin
        member.save(update_fields=['staff_pin'])
    raw_token = secrets.token_urlsafe(32)
    StaffSession.objects.create(
        business=inv.business,
        staff=member,
        token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
    )
    inv.used = True
    inv.used_at = timezone.now()
    inv.save(update_fields=['used', 'used_at'])
    return Response({
        'business': {'name': inv.business.name, 'slug': inv.business.slug},
        'staff': {'id': member.id, 'name': member.name},
        'token': raw_token,
    }, status=http.HTTP_201_CREATED)


# --- Owner dashboard -----------------------------------------------------------

@api_view(['GET'])
@permission_classes([])
def dashboard(request):
    biz = get_business(request)
    require_owner_pin(request, biz)

    today = timezone.localdate()
    yesterday = today - timedelta(days=1)
    qs = biz.bills.filter(created_at__date=today).exclude(status='draft')
    agg = qs.aggregate(
        recorded=Count('id'),
        verified=Count('id', filter=Q(status__in=['approved', 'paid', 'disputed'])),
        expected=Sum('total'),
        collected=Sum('total', filter=Q(status='paid')),
        unverified=Sum('total', filter=Q(status='pending')),
        disputed=Sum('total', filter=Q(status='disputed')),
    )
    y_today = biz.bills.filter(created_at__date=yesterday, status='paid') \
        .aggregate(s=Sum('total'))['s'] or 0
    expected = agg['expected'] or 0
    collected = agg['collected'] or 0
    usage = verified_count_this_month(biz)
    month_cap = biz.plan.monthly_verified_bills

    recent = AuditEvent.objects.filter(bill__business=biz).select_related('bill') \
        .order_by('-at')[:25]
    audit_feed = [{
        'code': e.bill.code, 'type': e.type, 'detail': e.detail, 'at': e.at,
        'staff': e.bill.staff.name,
    } for e in recent]

    bills = [{
        'code': b.code, 'customer_name': b.customer_name, 'staff_name': b.staff.name,
        'status': b.status, 'total': b.total,
        'items': list(b.items.values('name', 'price')),
        'edits': list(b.edits.values('item_name', 'old_price', 'new_price', 'reason')),
        'was_edited': b.edits.exists(),
    } for b in qs.select_related('staff').prefetch_related('items', 'edits')]

    return Response({
        'day': str(today),
        'business': BusinessSerializer(biz).data,
        **agg,
        'expected': expected, 'collected': collected,
        'variance': expected - collected,
        'yesterday_collected': y_today,
        'plan_usage': {'verified_bills': usage, 'cap': month_cap,
                       'remaining': max(0, month_cap - usage)},
        'subscription': biz.subscription_info(),
        'audit_feed': audit_feed,
        'bills': bills,
    })


@api_view(['GET'])
@permission_classes([])
def bill_audit(request, code):
    """Full audit timeline for one bill (owner)."""
    biz = get_business(request)
    require_owner_pin(request, biz)
    bill = Bill.objects.filter(code=code, business=biz).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    return Response(BillSerializer(bill, context={'request': request}).data)


# --- Platform Admin (Master Management & Monitoring) -------------------------

def require_admin_key(request):
    key = request.headers.get('X-SP-Admin-Key', '').strip()
    expected = getattr(settings, 'ADMIN_KEY', 'saloonos-master-2026').strip()
    if not key or key != expected:
        raise Unauthorized('Invalid or missing platform admin key')


@api_view(['GET'])
@permission_classes([])
def platform_admin_overview(request):
    """Platform-wide summary metrics for operators."""
    require_admin_key(request)
    now = timezone.now()
    businesses = Business.objects.select_related('plan').all()
    total_biz = businesses.count()

    paid_cnt = 0
    trial_cnt = 0
    expired_cnt = 0
    mrr = 0

    for b in businesses:
        sub = b.subscription_info()
        st = sub['state']
        if st == 'paid':
            paid_cnt += 1
            mrr += b.plan.price_monthly
        elif st == 'trial':
            trial_cnt += 1
        else:
            expired_cnt += 1

    total_bills = Bill.objects.count()
    total_verified = Bill.objects.filter(status__in=['approved', 'paid']).count()
    total_paid_bills = Bill.objects.filter(status='paid').count()
    total_disputed = Bill.objects.filter(status='disputed').count()
    total_voided = Bill.objects.filter(status='voided').count()
    total_gmv = Bill.objects.filter(status='paid').aggregate(s=Sum('total'))['s'] or 0

    verification_rate = round((total_verified / total_bills * 100), 1) if total_bills else 100.0

    recent_events_qs = AuditEvent.objects.select_related('bill__business', 'bill__staff').order_by('-at')[:30]
    recent_events = [{
        'id': e.id,
        'business_name': e.bill.business.name,
        'business_slug': e.bill.business.slug,
        'bill_code': e.bill.code,
        'type': e.type,
        'detail': e.detail,
        'staff_name': e.bill.staff.name if e.bill.staff else None,
        'at': e.at,
    } for e in recent_events_qs]

    return Response({
        'total_businesses': total_biz,
        'subscriptions': {
            'paid': paid_cnt,
            'trial': trial_cnt,
            'expired': expired_cnt,
            'mrr': mrr,
        },
        'bills_summary': {
            'total': total_bills,
            'verified': total_verified,
            'paid': total_paid_bills,
            'disputed': total_disputed,
            'voided': total_voided,
            'verification_rate': verification_rate,
            'total_gmv': total_gmv,
        },
        'recent_events': recent_events,
    })


@api_view(['GET'])
@permission_classes([])
def platform_admin_businesses(request):
    """Full tenant directory with plan & billing details."""
    require_admin_key(request)
    businesses = Business.objects.select_related('plan').prefetch_related('staff', 'bills').order_by('-created_at')
    
    data = []
    for b in businesses:
        bills_qs = b.bills.all()
        total_bills = bills_qs.count()
        verified_bills = bills_qs.filter(status__in=['approved', 'paid']).count()
        revenue = bills_qs.filter(status='paid').aggregate(s=Sum('total'))['s'] or 0
        disputed = bills_qs.filter(status='disputed').count()
        
        data.append({
            'id': b.id,
            'name': b.name,
            'slug': b.slug,
            'owner_pin': b.owner_pin,
            'created_at': b.created_at,
            'trial_ends_at': b.trial_ends_at,
            'plan_paid_until': b.plan_paid_until,
            'subscription': b.subscription_info(),
            'plan': {
                'code': b.plan.code,
                'name': b.plan.name,
                'max_staff': b.plan.max_staff,
                'monthly_verified_bills': b.plan.monthly_verified_bills,
                'price_monthly': b.plan.price_monthly,
            },
            'staff_count': b.staff.count(),
            'total_bills': total_bills,
            'verified_bills': verified_bills,
            'disputed_bills': disputed,
            'total_revenue': revenue,
            'tagline': b.tagline,
            'phone': b.phone,
            'location': b.location,
        })

    return Response({'businesses': data})


@api_view(['POST'])
@permission_classes([])
def platform_admin_update_business(request, slug):
    """Perform management action on tenant: extend trial, update plan, reset PIN."""
    require_admin_key(request)
    try:
        biz = Business.objects.get(slug=slug)
    except Business.DoesNotExist:
        return Response({'error': 'Business not found'}, status=http.HTTP_404_NOT_FOUND)

    payload = request.data
    now = timezone.now()

    # Extend trial by N days
    if 'trial_days_add' in payload:
        days = int(payload['trial_days_add'])
        base_dt = biz.trial_ends_at if (biz.trial_ends_at and biz.trial_ends_at > now) else now
        biz.trial_ends_at = base_dt + timedelta(days=days)

    # Extend paid subscription by N days
    if 'paid_days_add' in payload:
        days = int(payload['paid_days_add'])
        base_dt = biz.plan_paid_until if (biz.plan_paid_until and biz.plan_paid_until > now) else now
        biz.plan_paid_until = base_dt + timedelta(days=days)

    # Change plan tier
    if 'plan_code' in payload:
        try:
            new_plan = Plan.objects.get(code=payload['plan_code'])
            biz.plan = new_plan
        except Plan.DoesNotExist:
            return Response({'error': 'Unknown plan'}, status=http.HTTP_400_BAD_REQUEST)

    # Reset owner PIN
    if 'owner_pin' in payload:
        pin = str(payload['owner_pin']).strip()
        if len(pin) >= 4:
            biz.owner_pin = pin

    if 'name' in payload and str(payload['name']).strip():
        biz.name = str(payload['name']).strip()

    biz.save()
    return Response({
        'ok': True,
        'business': {
            'slug': biz.slug,
            'name': biz.name,
            'owner_pin': biz.owner_pin,
            'plan': biz.plan.code,
            'subscription': biz.subscription_info(),
        }
    })


@api_view(['GET'])
@permission_classes([])
def platform_admin_payments(request):
    """Global M-Pesa payments ledger across all salons."""
    require_admin_key(request)
    payments = MpesaPayment.objects.select_related('business', 'plan').order_by('-created_at')[:100]
    data = [{
        'id': p.id,
        'business_name': p.business.name,
        'business_slug': p.business.slug,
        'plan_name': p.plan.name,
        'cycle': p.cycle,
        'amount': p.amount,
        'phone': p.phone,
        'status': p.status,
        'mpesa_receipt': p.mpesa_receipt,
        'result_desc': p.result_desc,
        'created_at': p.created_at,
        'completed_at': p.completed_at,
    } for p in payments]
    return Response({'payments': data})

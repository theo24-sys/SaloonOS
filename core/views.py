import calendar
import random
import re
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
                     BillEdit, AuditEvent, MpesaPayment, StaffInvite)
from .mpesa import DarajaError, stk_push, stk_query, normalize_phone
from .serializers import (PlanSerializer, BusinessSerializer, BillSerializer,
                          ServiceSerializer, StaffSerializer, audit)


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


def gen_code():
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(random.choices(alphabet, k=6))


# --- Public: plans & signup -------------------------------------------------

@api_view(['GET'])
@permission_classes([])
def plans(request):
    return Response(PlanSerializer(Plan.objects.all(), many=True).data)


@api_view(['POST'])
@permission_classes([])
def signup(request):
    name = (request.data.get('name') or '').strip()
    plan_code = request.data.get('plan_code') or 'starter'
    owner_pin = str(request.data.get('owner_pin') or '').strip()
    if not name or len(owner_pin) < 4:
        return Response({'error': 'name and a 4+ digit owner_pin are required'},
                        status=http.HTTP_400_BAD_REQUEST)
    plan = Plan.objects.filter(code=plan_code).first()
    if not plan:
        return Response({'error': 'Unknown plan'}, status=http.HTTP_400_BAD_REQUEST)

    base = ''.join(ch for ch in name.lower() if ch.isalnum())[:20] or 'salon'
    slug, n = base, 1
    while Business.objects.filter(slug=slug).exists():
        n += 1
        slug = f"{base}{n}"

    biz = Business.objects.create(name=name, slug=slug, plan=plan, owner_pin=owner_pin)
    for sname in ['Jane', 'Alice']:
        StaffMember.objects.create(business=biz, name=sname)
    return Response(BusinessSerializer(biz).data, status=http.HTTP_201_CREATED)


# --- Catalog -----------------------------------------------------------------

@api_view(['GET'])
@permission_classes([])
def catalog(request):
    biz = get_business(request)
    return Response({
        'business': BusinessSerializer(biz).data,
        'services': ServiceSerializer(biz.services.all(), many=True).data,
        'staff': StaffSerializer(biz.staff.all(), many=True).data,
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
    biz.save()
    return Response(BusinessSerializer(biz).data)


@api_view(['POST'])
@permission_classes([])
def add_staff(request):
    biz = get_business(request)
    require_owner_pin(request, biz)
    name = (request.data.get('name') or '').strip()
    if not name:
        return Response({'error': 'name required'}, status=http.HTTP_400_BAD_REQUEST)
    if biz.staff.count() >= biz.plan.max_staff:
        return Response(
            {'error': f"Your {biz.plan.name} plan allows {biz.plan.max_staff} staff. Upgrade to add more."},
            status=http.HTTP_402_PAYMENT_REQUIRED)
    member, created = StaffMember.objects.get_or_create(business=biz, name=name)
    return Response(StaffSerializer(member).data, status=http.HTTP_201_CREATED if created else http.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([])
def add_service(request):
    biz = get_business(request)
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
    customer = (request.data.get('customer_name') or '').strip()
    staff_id = request.data.get('staff_id')
    items = request.data.get('items') or []
    if not customer or not staff_id or not items:
        return Response({'error': 'customer_name, staff_id, items required'},
                        status=http.HTTP_400_BAD_REQUEST)

    staff = biz.staff.filter(id=staff_id).first()
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
    return Response(BillSerializer(bill).data, status=http.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([])
@transaction.atomic
def edit_bill(request, code):
    """Edit a pending bill's item prices. Every change is logged with a reason.
    Approved+ bills are immutable — void & re-create instead."""
    biz = get_business(request)
    bill = Bill.objects.select_related('business').filter(code=code, business=biz).first()
    if not bill:
        return Response({'error': 'Bill not found'}, status=http.HTTP_404_NOT_FOUND)
    if bill.status != 'pending':
        raise Conflict(f"Bill is {bill.status} — it can no longer be edited. Void it and create a new one.")

    staff = biz.staff.filter(id=request.data.get('staff_id')).first()
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
    return Response(BillSerializer(bill).data)


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
    return Response(BillSerializer(bill).data)


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
    return Response(BillSerializer(bill).data)


@api_view(['POST'])
@permission_classes([])
def pay_bill(request, code):
    bill = Bill.objects.filter(code=code).first()
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
    return Response(BillSerializer(bill).data)


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
    return Response(BillSerializer(bill).data)


# --- Subscription gating ------------------------------------------------------

def require_active_subscription(biz):
    """Trial or paid period must be active to create/verify bills."""
    info = biz.subscription_info()
    if info['state'] == 'expired':
        raise PaymentRequired(
            "Your trial has ended. Pay your plan via M-Pesa to keep verifying bills "
            "(Owner dashboard → Billing).")


# --- Plan payments (M-Pesa STK push) -------------------------------------------

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
    pay.result_desc = (desc or '')[:255]
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
        pay.status = 'failed'
        pay.result_desc = str(e)[:255]
        pay.save(update_fields=['status', 'result_desc'])
        return Response({'error': str(e)}, status=http.HTTP_502_BAD_GATEWAY)

    pay.checkout_request_id = checkout_id
    pay.merchant_request_id = merchant_id or ''
    pay.save(update_fields=['checkout_request_id', 'merchant_request_id'])
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
        except DarajaError:
            rc = None
        if rc == '0':
            _settle_success(biz, pay)
        elif rc not in (None, 'PENDING'):
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

    if not checkout_id:
        return Response({'ResultCode': 0, 'ResultDesc': 'Ignored: no CheckoutRequestID'})

    pay = MpesaPayment.objects.filter(checkout_request_id=checkout_id).select_related('business').first()
    if not pay:
        return Response({'ResultCode': 0, 'ResultDesc': 'Unknown checkout — ignored'})

    # Optional shared-secret gate (set MPESA_CALLBACK_TOKEN to enable).
    expected = getattr(settings, 'MPESA_CALLBACK_TOKEN', '')
    if expected and token != expected:
        return Response({'ResultCode': 0, 'ResultDesc': 'Rejected: bad token'})

    if pay.status == 'pending':
        if result_code == '0':
            if amount and pay.amount and amount != pay.amount:
                pay.result_desc = f'Amount mismatch: expected {pay.amount}, got {amount}'[:255]
                pay.status = 'failed'
                pay.completed_at = timezone.now()
                pay.save(update_fields=['result_desc', 'status', 'completed_at'])
            else:
                pay.mpesa_receipt = receipt
                _settle_success(pay.business, pay)
        else:
            _settle_failure(pay.business, pay, result_code, result_desc)

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
    return Response(BillSerializer(bill).data)


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
    name = (request.data.get('name') or '').strip()
    if not name:
        raise Invalid('name required')
    if biz.staff.count() >= biz.plan.max_staff:
        raise PaymentRequired(
            f"Your {biz.plan.name} plan allows {biz.plan.max_staff} staff. Upgrade to add more.")
    inv = StaffInvite.objects.create(
        business=biz, name=name, code=gen_code() + gen_code(), created_by_pin=biz.owner_pin)
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
    inv = StaffInvite.objects.select_related('business').filter(code=code, used=False).first()
    if not inv:
        return Response({'error': 'This invite link is invalid or already used.'},
                        status=http.HTTP_400_BAD_REQUEST)
    member, created = StaffMember.objects.get_or_create(business=inv.business, name=inv.name)
    inv.used = True
    inv.used_at = timezone.now()
    inv.save(update_fields=['used', 'used_at'])
    return Response({
        'business': {'name': inv.business.name, 'slug': inv.business.slug},
        'staff': {'id': member.id, 'name': member.name},
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
    return Response(BillSerializer(bill).data)

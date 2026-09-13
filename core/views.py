import random
import string
from datetime import timedelta

from django.db import transaction
from django.db.models import Sum, Count, Q, F
from django.utils import timezone
from rest_framework import status as http
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from .models import Plan, Business, StaffMember, Service, Bill, BillItem, BillEdit, AuditEvent
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

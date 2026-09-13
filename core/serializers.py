import io
import base64

import qrcode
from django.utils import timezone
from rest_framework import serializers

from .models import Plan, Business, StaffMember, Service, Bill, BillItem, AuditEvent, BillEdit


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = ['code', 'name', 'price_monthly', 'price_annual', 'monthly_verified_bills',
                  'max_staff', 'tagline', 'is_target', 'features']


class BusinessSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)

    class Meta:
        model = Business
        fields = ['id', 'name', 'slug', 'plan', 'tagline', 'phone', 'location',
                  'accent', 'thank_you']


def audit(bill, type_, detail=''):
    AuditEvent.objects.create(bill=bill, type=type_, detail=detail)


def make_qr_data_url(business_slug, code):
    url = f"{settings_public_base_url()}/v/{code}?b={business_slug}"
    img = qrcode.make(url, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(), url


def settings_public_base_url():
    from django.conf import settings
    return getattr(settings, 'PUBLIC_BASE_URL', 'http://localhost:3000')


class BillBrandingSerializer(serializers.ModelSerializer):
    """Customer-facing business identity for receipts."""

    class Meta:
        model = Business
        fields = ['name', 'tagline', 'phone', 'location', 'accent', 'thank_you']


class BillSerializer(serializers.ModelSerializer):
    business = BillBrandingSerializer(read_only=True)
    items = serializers.SerializerMethodField()
    staff_name = serializers.CharField(source='staff.name', read_only=True)
    edits = serializers.SerializerMethodField()
    events = serializers.SerializerMethodField()
    qr_data_url = serializers.SerializerMethodField()
    verify_url = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = ['id', 'code', 'customer_name', 'status', 'total', 'staff', 'staff_name',
                  'payment_method', 'payment_ref', 'dispute_note', 'approved_at', 'paid_at',
                  'created_at', 'items', 'edits', 'events', 'qr_data_url', 'verify_url', 'business']

    def get_items(self, obj):
        return list(obj.items.values('id', 'name', 'price'))

    def get_edits(self, obj):
        return list(obj.edits.values('item_name', 'old_price', 'new_price', 'reason', 'at'))

    def get_events(self, obj):
        return list(obj.events.values('type', 'detail', 'at'))

    def get_qr_data_url(self, obj):
        data_url, _ = make_qr_data_url(obj.business.slug, obj.code)
        return data_url

    def get_verify_url(self, obj):
        _, url = make_qr_data_url(obj.business.slug, obj.code)
        return url


class ServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Service
        fields = ['id', 'name', 'default_price']


class StaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffMember
        fields = ['id', 'name', 'role']

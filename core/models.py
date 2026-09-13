from django.db import models
from django.utils import timezone


class Plan(models.Model):
    """The 4 pricing tiers from the spec."""
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=50)
    price_monthly = models.IntegerField()          # KSh
    price_annual = models.IntegerField()           # KSh (~2 months free)
    monthly_verified_bills = models.IntegerField() # verified-bill cap
    max_staff = models.IntegerField()
    tagline = models.CharField(max_length=120, blank=True)
    is_target = models.BooleanField(default=False)  # the ⭐ recommended plan
    features = models.JSONField(default=list)

    def __str__(self):
        return f"{self.name} (KSh {self.price_monthly}/mo)"


class Business(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(unique=True)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT)
    owner_pin = models.CharField(max_length=8)      # dashboard access
    created_at = models.DateTimeField(auto_now_add=True)

    # --- Branding (owner-editable; trust elements stay platform-controlled) ---
    tagline = models.CharField(max_length=120, blank=True)   # e.g. "Beauty · Braids · Nails"
    phone = models.CharField(max_length=20, blank=True)
    location = models.CharField(max_length=120, blank=True)
    accent = models.CharField(max_length=10, default='blush')  # blush|rose|luxe|plum|minimal
    thank_you = models.CharField(max_length=150, default='Thank you for choosing us ♡')

    def __str__(self):
        return self.name


class StaffMember(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name='staff')
    name = models.CharField(max_length=80)
    role = models.CharField(max_length=20, default='staff')  # staff | manager

    class Meta:
        unique_together = ('business', 'name')

    def __str__(self):
        return f"{self.name} @ {self.business.name}"


class Service(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name='services')
    name = models.CharField(max_length=80)
    default_price = models.IntegerField()           # KSh

    class Meta:
        unique_together = ('business', 'name')

    def __str__(self):
        return f"{self.name} — KSh {self.default_price}"


class Bill(models.Model):
    """A service bill. Records are never deleted — only moved through statuses."""
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('pending', 'Pending verification'),
        ('approved', 'Verified'),
        ('paid', 'Paid'),
        ('disputed', 'Disputed'),
        ('voided', 'Voided'),
        ('refunded', 'Refunded'),
    ]

    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name='bills')
    code = models.CharField(max_length=12, unique=True)   # customer-facing reference
    customer_name = models.CharField(max_length=80)
    staff = models.ForeignKey(StaffMember, on_delete=models.PROTECT)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='draft')
    total = models.IntegerField(default=0)
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    payment_method = models.CharField(max_length=20, blank=True)
    dispute_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"#{self.code} {self.customer_name} — {self.status}"


class BillItem(models.Model):
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name='items')
    name = models.CharField(max_length=80)
    price = models.IntegerField()

    def __str__(self):
        return f"{self.name} KSh {self.price}"


class BillEdit(models.Model):
    """Price/line edits on a pending bill, with reason — owner-visible."""
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name='edits')
    item_name = models.CharField(max_length=80)
    old_price = models.IntegerField()
    new_price = models.IntegerField()
    reason = models.CharField(max_length=200, blank=True)
    edited_by = models.ForeignKey(StaffMember, null=True, on_delete=models.SET_NULL)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['at']

    def __str__(self):
        return f"#{self.bill.code} {self.item_name}: {self.old_price} → {self.new_price}"


class AuditEvent(models.Model):
    """Append-only audit trail. The doc: 'That's where your accountability actually lives.'"""
    TYPE_CHOICES = [
        ('created', 'Bill created'),
        ('edited', 'Bill edited'),
        ('scanned', 'Customer scanned QR'),
        ('verified', 'Customer verified bill'),
        ('disputed', 'Customer disputed bill'),
        ('paid', 'Payment recorded'),
        ('voided', 'Bill voided'),
        ('refunded', 'Bill refunded'),
    ]
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name='events')
    type = models.CharField(max_length=12, choices=TYPE_CHOICES)
    detail = models.CharField(max_length=255, blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['at']

    def __str__(self):
        return f"#{self.bill.code} {self.type} — {self.detail}"

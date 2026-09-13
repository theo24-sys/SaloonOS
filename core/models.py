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
    # --- Subscription state (M-Pesa plan payments) ---
    trial_ends_at = models.DateTimeField(null=True, blank=True)  # 7-day trial from signup
    plan_paid_until = models.DateTimeField(null=True, blank=True)  # set by successful STK payment

    # --- Branding (owner-editable; trust elements stay platform-controlled) ---
    tagline = models.CharField(max_length=120, blank=True)   # e.g. "Beauty · Braids · Nails"
    phone = models.CharField(max_length=20, blank=True)
    location = models.CharField(max_length=120, blank=True)
    accent = models.CharField(max_length=10, default='blush')  # blush|rose|luxe|plum|minimal
    thank_you = models.CharField(max_length=150, default='Thank you for choosing us ♡')
    logo_data_url = models.TextField(blank=True, default='')

    TRIAL_DAYS = 7

    def save(self, *args, **kwargs):
        # New businesses start a free trial automatically.
        if self._state.adding and self.trial_ends_at is None:
            self.trial_ends_at = timezone.now() + timezone.timedelta(days=self.TRIAL_DAYS)
        super().save(*args, **kwargs)

    def subscription_info(self):
        """Single source of truth for subscription state (API + dashboard).
        `reminder` is True inside the 5-day window before expiry."""
        now = timezone.now()
        paid = bool(self.plan_paid_until and self.plan_paid_until > now)
        trial = bool(self.trial_ends_at and self.trial_ends_at > now)
        if paid:
            state, end = 'paid', self.plan_paid_until
        elif trial:
            state, end = 'trial', self.trial_ends_at
        else:
            state, end = 'expired', None
        days_left = max(0, (end - now).days) if end else 0
        return {'state': state, 'end': end, 'days_left': days_left,
                'reminder': state != 'expired' and days_left <= 5}

    def subscription_active(self):
        return self.subscription_info()['state'] != 'expired'

    def __str__(self):
        return self.name


class StaffMember(models.Model):
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name='staff')
    name = models.CharField(max_length=80)
    role = models.CharField(max_length=20, default='staff')  # staff | manager
    staff_pin = models.CharField(max_length=8, blank=True, default='')

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
    payment_ref = models.CharField(max_length=20, blank=True)  # M-Pesa receipt code (scan payments)
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


class StaffInvite(models.Model):
    """A signup link for one staff member, issued by the owner.
    The code is the secret in the URL (/app?invite=...); it becomes invalid
    once used or revoked."""
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name='staff_invites')
    name = models.CharField(max_length=80)
    staff_pin = models.CharField(max_length=8)
    code = models.CharField(max_length=12, unique=True)
    created_by_pin = models.CharField(max_length=8)   # owner PIN at issuance (audit context)
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"invite:{self.code} {self.name}@{self.business.slug} used={self.used}"


class StaffSession(models.Model):
    """Revocable device session created when a staff invite is accepted."""
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name='staff_sessions')
    staff = models.ForeignKey(StaffMember, on_delete=models.CASCADE, related_name='sessions')
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)


class MpesaPayment(models.Model):
    """Append-only ledger of plan-payment STK pushes and their outcomes.
    Never deleted; failed/expired attempts stay for reconciliation."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
        ('timeout', 'Timeout'),
    ]
    CYCLE_CHOICES = [('monthly', 'Monthly'), ('annual', 'Annual')]

    business = models.ForeignKey(Business, on_delete=models.PROTECT, related_name='mpesa_payments')
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT)
    cycle = models.CharField(max_length=10, choices=CYCLE_CHOICES, default='monthly')
    amount = models.IntegerField()                      # KSh actually charged
    phone = models.CharField(max_length=15)             # 2547XXXXXXXX
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    checkout_request_id = models.CharField(max_length=64, unique=True)
    merchant_request_id = models.CharField(max_length=64, blank=True)
    mpesa_receipt = models.CharField(max_length=20, blank=True)  # e.g. SJ84K2ABCD
    result_desc = models.CharField(max_length=255, blank=True)
    extends_until = models.DateTimeField(null=True, blank=True)  # subscription end this payment grants
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.business.slug} {self.plan.code} KSh {self.amount} — {self.status}"


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

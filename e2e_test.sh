#!/usr/bin/env bash
# ServiceProof end-to-end API test (through the Next.js proxy on :3000)
set -u
cd "$(dirname "$0")"
B=http://localhost:3000/api
fail=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; fail=1; }
check() { # check <desc> <expected-substr> <actual>
  if echo "$3" | grep -q "$2"; then ok "$1"; else bad "$1 — wanted '$2' got: $(echo "$3" | head -c 200)"; fi
}

# Clean up businesses left by earlier runs (financial FKs are PROTECT, so clear dependents first)
.venv/bin/python - <<'EOF'
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); django.setup()
from core.models import Business, Plan, Bill, StaffMember, Service, AuditEvent, BillEdit
def purge(slug_prefix):
    for b in Business.objects.filter(slug__startswith=slug_prefix):
        AuditEvent.objects.filter(bill__business=b).delete()
        BillEdit.objects.filter(bill__business=b).delete()
        Bill.objects.filter(business=b).delete()
        StaffMember.objects.filter(business=b).delete()
        Service.objects.filter(business=b).delete()
        b.delete()
purge('e2esalon')
Plan.objects.filter(code='cap-test').delete()
EOF

echo "== signup =="
S=$(curl -s -X POST $B/signup -H 'Content-Type: application/json' \
  -d '{"name":"E2E Salon","plan_code":"starter","owner_pin":"4321"}')
check "signup 201" '"slug"' "$S"
SLUG=$(echo "$S" | python3 -c "import sys,json;print(json.load(sys.stdin)['slug'])")
echo "  slug=$SLUG"

echo "== catalog =="
C=$(curl -s $B/catalog -H "X-SP-Business: $SLUG")
check "services seeded" 'Jane' "$C"
STAFF_ID=$(echo "$C" | python3 -c "import sys,json;print(json.load(sys.stdin)['staff'][0]['id'])")

echo "== staff cap (starter = 4) =="
curl -s -X POST $B/staff/add -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' -H 'X-SP-PIN: 4321' -d '{"name":"Zawadi"}' >/dev/null
curl -s -X POST $B/staff/add -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' -H 'X-SP-PIN: 4321' -d '{"name":"Mercy"}' >/dev/null
A5=$(curl -s -X POST $B/staff/add -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' -H 'X-SP-PIN: 4321' -d '{"name":"Fatuma"}')
check "5th staff blocked with 402" 'Upgrade' "$A5"

echo "== create bill =="
BILL=$(curl -s -X POST $B/bills -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' \
  -d "{\"customer_name\":\"Alice\",\"staff_id\":$STAFF_ID,\"items\":[{\"name\":\"Braids\",\"price\":2500},{\"name\":\"Wash\",\"price\":300}]}")
check "bill pending" '"status":"pending"' "$BILL"
CODE=$(echo "$BILL" | python3 -c "import sys,json;print(json.load(sys.stdin)['code'])")
echo "  code=$CODE"

echo "== guard: pay before verify =="
G=$(curl -s -X POST $B/bills/$CODE/pay -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' -d '{"method":"M-Pesa"}')
check "pay blocked" 'not verified' "$G"

echo "== edit while pending (audit) =="
ITEM_ID=$(echo "$BILL" | python3 -c "import sys,json;print(json.load(sys.stdin)['items'][0]['id'])")
E=$(curl -s -X POST $B/bills/$CODE/edit -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' \
  -d "{\"staff_id\":$STAFF_ID,\"reason\":\"Customer discount\",\"changes\":[{\"item_id\":$ITEM_ID,\"new_price\":2000}]}")
check "edit logged" 'Customer discount' "$E"
check "total updated" '"total":2300' "$E"

echo "== guard: edit after approval =="
curl -s -X POST $B/bills/$CODE/verify -H 'Content-Type: application/json' -d '{"dispute":false,"note":""}' >/dev/null
E2=$(curl -s -X POST $B/bills/$CODE/edit -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' \
  -d "{\"staff_id\":$STAFF_ID,\"reason\":\"x\",\"changes\":[{\"item_id\":$ITEM_ID,\"new_price\":1}]}")
check "edit blocked once approved" 'no longer be edited' "$E2"

echo "== pay after approval =="
PAY=$(curl -s -X POST $B/bills/$CODE/pay -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' -d '{"method":"M-Pesa"}')
check "paid" '"status":"paid"' "$PAY"

echo "== guard: double pay =="
P2=$(curl -s -X POST $B/bills/$CODE/pay -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' -d '{}')
check "double pay blocked" 'Bill is paid' "$P2"

echo "== guard: void paid bill =="
V=$(curl -s -X POST $B/bills/$CODE/void -H "X-SP-Business: $SLUG" -H 'X-SP-PIN: 4321' -H 'Content-Type: application/json' -d '{"reason":"x"}')
check "void paid blocked" 'refunded' "$V"

echo "== guard: wrong PIN =="
D=$(curl -s $B/dashboard -H "X-SP-Business: $SLUG" -H 'X-SP-PIN: 9999')
check "wrong pin rejected" 'Invalid owner PIN' "$D"

echo "== dashboard =="
DASH=$(curl -s $B/dashboard -H "X-SP-Business: $SLUG" -H 'X-SP-PIN: 4321')
check "variance 0 (fully paid)" '"variance":0' "$DASH"
check "audit feed has created" '"type":"created"' "$DASH"
check "audit feed has edited" '"type":"edited"' "$DASH"

echo "== verified-bill cap =="
# create a 2nd bill while still on Starter…
B2=$(curl -s -X POST $B/bills -H "X-SP-Business: $SLUG" -H 'Content-Type: application/json' \
  -d "{\"customer_name\":\"Bob\",\"staff_id\":$STAFF_ID,\"items\":[{\"name\":\"Cut\",\"price\":500}]}")
C2=$(echo "$B2" | python3 -c "import sys,json;print(json.load(sys.stdin)['code'])")
echo "  code=$C2"
# …then shrink the cap to 1 (Alice's bill already verified) and try to verify it
.venv/bin/python - <<EOF
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); django.setup()
from core.models import Plan, Business
p,_ = Plan.objects.get_or_create(code='cap-test', defaults=dict(
    name='CapTest', price_monthly=0, price_annual=0, monthly_verified_bills=1,
    max_staff=2, tagline='t', is_target=False, features=[]))
Business.objects.filter(slug='$SLUG').update(plan=p)
EOF
V2=$(curl -s -X POST $B/bills/$C2/verify -H 'Content-Type: application/json' -d '{"dispute":false,"note":""}')
check "2nd verify blocked (cap=1)" 'verified bills/month' "$V2"

echo "== QR / verify_url points at frontend =="
QR=$(curl -s "$B/bills/$C2" -H "X-SP-Business: $SLUG" -H 'X-SP-NoScan: 1')
check "qr data url" 'data:image/png;base64' "$QR"
check "verify url uses /v/" "/v/$C2" "$QR"

if [ $fail -eq 0 ]; then echo "ALL E2E TESTS PASSED"; else echo "FAILURES ^"; exit 1; fi

# Remove this run's test business so the demo data stays pristine
.venv/bin/python - <<'EOF'
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); django.setup()
from core.models import Business, Plan, Bill, StaffMember, Service, AuditEvent, BillEdit
def purge(slug_prefix):
    for b in Business.objects.filter(slug__startswith=slug_prefix):
        AuditEvent.objects.filter(bill__business=b).delete()
        BillEdit.objects.filter(bill__business=b).delete()
        Bill.objects.filter(business=b).delete()
        StaffMember.objects.filter(business=b).delete()
        Service.objects.filter(business=b).delete()
        b.delete()
purge('e2esalon')
Plan.objects.filter(code='cap-test').delete()
print('cleanup done')
EOF

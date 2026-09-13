from django.urls import re_path
from core import views

# Optional trailing slashes: the Next.js rewrite drops them, and we don't want
# APPEND_SLASH 301s (browsers rewrite redirected POSTs to GET).
urlpatterns = [
    re_path(r'^api/plans/?$', views.plans),
    re_path(r'^api/signup/?$', views.signup),
    re_path(r'^api/catalog/?$', views.catalog),
    re_path(r'^api/staff/add/?$', views.add_staff),
    re_path(r'^api/branding/?$', views.branding),
    re_path(r'^api/services/add/?$', views.add_service),
    re_path(r'^api/bills/?$', views.create_bill),
    re_path(r'^api/bills/(?P<code>[^/]+)/edit/?$', views.edit_bill),
    re_path(r'^api/bills/(?P<code>[^/]+)/?$', views.get_bill),
    re_path(r'^api/bills/(?P<code>[^/]+)/verify/?$', views.verify_bill),
    re_path(r'^api/bills/(?P<code>[^/]+)/pay/?$', views.pay_bill),
    re_path(r'^api/bills/(?P<code>[^/]+)/void/?$', views.void_bill),
    re_path(r'^api/bills/(?P<code>[^/]+)/audit/?$', views.bill_audit),
    re_path(r'^api/dashboard/?$', views.dashboard),
    re_path(r'^api/mpesa/stk/?$', views.mpesa_stk),
    re_path(r'^api/mpesa/status/(?P<payment_id>\d+)/?$', views.mpesa_status),
    re_path(r'^api/mpesa/callback/?$', views.mpesa_callback),
    re_path(r'^api/mpesa/history/?$', views.mpesa_history),
]

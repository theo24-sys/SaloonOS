export const money = (n: number) => `KSh ${Number(n).toLocaleString("en-KE")}`;

export type Plan = {
  code: string;
  name: string;
  price_monthly: number;
  price_annual: number;
  monthly_verified_bills: number;
  max_staff: number;
  tagline: string;
  is_target: boolean;
  features: string[];
};

export type BillItem = { id?: number; name: string; price: number };
export type BillEdit = { item_name: string; old_price: number; new_price: number; reason: string; at?: string };
export type AuditEv = { code?: string; type: string; detail: string; at: string; staff?: string };
export type Branding = {
  name: string; tagline: string; phone: string; location: string;
  accent: "blush" | "rose" | "luxe" | "plum" | "minimal"; thank_you: string; logo_data_url?: string;
};

export type Bill = {
  id: number;
  code: string;
  customer_name: string;
  customer_phone: string;
  status: "draft" | "pending" | "approved" | "paid" | "disputed" | "voided" | "refunded";
  total: number;
  staff_name: string;
  payment_method: string;
  payment_ref: string;
  dispute_note: string;
  created_at: string;
  approved_at: string | null;
  items: BillItem[];
  edits: BillEdit[];
  events: AuditEv[];
  business: Branding;
  qr_data_url?: string;
  verify_url?: string;
};

export type Catalog = {
  business: { name: string; slug: string; plan: Plan; logo_data_url?: string };
  services: { id: number; name: string; default_price: number }[];
  staff: { id: number; name: string; role: string }[];
};

export type Dashboard = {
  day: string;
  business: { name: string; slug: string; plan: Plan };
  recorded: number;
  verified: number;
  expected: number;
  collected: number;
  variance: number;
  yesterday_collected: number;
  unverified: number | null;
  disputed: number | null;
  plan_usage: { verified_bills: number; cap: number; remaining: number };
  subscription: Subscription;
  audit_feed: AuditEv[];
  bills: (Bill & { staff_name: string; was_edited: boolean })[];
};

export type Subscription = {
  state: "trial" | "paid" | "expired";
  end: string | null;
  days_left: number;
  reminder: boolean;
};

export type Analytics = {
  trend: { labels: string[]; series: number[] };
  month: { this: number; last: number; mom_pct: number | null };
  staff: { staff_name: string; bills: number; collected: number; verified: number; verify_rate: number }[];
  top_services: { name: string; revenue: number; count: number }[];
  funnel: { created: number; verified: number; paid: number };
  status_counts: Record<string, number>;
  subscription: Subscription;
};

export type MpesaPaymentRow = {
  id: number;
  plan: string;
  cycle: "monthly" | "annual";
  amount: number;
  phone: string;
  status: "pending" | "success" | "failed" | "cancelled" | "timeout";
  mpesa_receipt: string;
  created_at: string;
  extends_until: string | null;
};

export type StkInitiated = {
  payment_id: number;
  checkout_request_id: string;
  status: string;
  amount: number;
  phone: string;
  message: string;
};

export type StkStatus = {
  payment_id: number;
  status: MpesaPaymentRow["status"];
  mpesa_receipt: string;
  result_desc: string;
  amount: number;
  cycle: string;
  subscription: Subscription;
};

export type PlatformOverview = {
  total_businesses: number;
  subscriptions: {
    paid: number;
    trial: number;
    expired: number;
    mrr: number;
  };
  bills_summary: {
    total: number;
    verified: number;
    paid: number;
    disputed: number;
    voided: number;
    verification_rate: number;
    total_gmv: number;
  };
  recent_events: {
    id: number;
    business_name: string;
    business_slug: string;
    bill_code: string;
    type: string;
    detail: string;
    staff_name: string | null;
    at: string;
  }[];
};

export type PlatformBusiness = {
  id: number;
  name: string;
  slug: string;
  owner_pin: string;
  created_at: string;
  trial_ends_at: string | null;
  plan_paid_until: string | null;
  subscription: Subscription;
  plan: {
    code: string;
    name: string;
    max_staff: number;
    monthly_verified_bills: number;
    price_monthly: number;
  };
  staff_count: number;
  total_bills: number;
  verified_bills: number;
  disputed_bills: number;
  total_revenue: number;
  tagline: string;
  phone: string;
  location: string;
};

export type PlatformPayment = {
  id: number;
  business_name: string;
  business_slug: string;
  plan_name: string;
  cycle: "monthly" | "annual";
  amount: number;
  phone: string;
  status: "pending" | "success" | "failed" | "cancelled" | "timeout";
  mpesa_receipt: string;
  result_desc: string;
  created_at: string;
  completed_at: string | null;
};

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(typeof window !== "undefined" ? { "X-SP-Public-Origin": window.location.origin } : {}),
    ...(opts.headers as Record<string, string> | undefined),
  };
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    res = await fetch(path, { ...opts, headers, cache: "no-store" });
    if (![502, 503, 504].includes(res.status) || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!res) throw new Error("The service is temporarily unavailable. Please try again.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if ([502, 503, 504].includes(res.status)) {
      throw new Error("The service is waking up. Please try again in a few seconds.");
    }
    const detail =
      (data as { error?: string; detail?: string }).error ||
      (data as { detail?: string }).detail ||
      `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return data as T;
}

export const api = {
  plans: () => req<Plan[]>("/api/plans/"),
  signup: (body: { name: string; plan_code: string; owner_pin: string }) =>
    req<{ name: string; slug: string }>("/api/signup/", { method: "POST", body: JSON.stringify(body) }),
  catalog: (slug: string) => req<Catalog>("/api/catalog/", { headers: { "X-SP-Business": slug } }),
  createBill: (slug: string, body: { customer_name: string; customer_phone: string; staff_id: number; items: BillItem[] }) =>
    req<Bill>("/api/bills/", { method: "POST", headers: operatorHeaders(slug), body: JSON.stringify(body) }),
  editBill: (
    slug: string,
    code: string,
    body: { staff_id: number; reason: string; changes: { item_id: number; new_price: number }[] }
  ) =>
    req<Bill>(`/api/bills/${code}/edit/`, {
      method: "POST",
      headers: operatorHeaders(slug),
      body: JSON.stringify(body),
    }),
  getBill: (code: string, slug?: string, noScan?: boolean) =>
    req<Bill>(`/api/bills/${code}/`, {
      headers: {
        ...(slug ? { "X-SP-Business": slug } : {}),
        ...(noScan ? { "X-SP-NoScan": "1" } : {}),
      },
    }),
  verify: (code: string, dispute: boolean, note: string) =>
    req<Bill>(`/api/bills/${code}/verify/`, {
      method: "POST",
      body: JSON.stringify({ dispute, note }),
    }),
  pay: (slug: string, code: string, method: string) =>
    req<Bill>(`/api/bills/${code}/pay/`, {
      method: "POST",
      headers: operatorHeaders(slug),
      body: JSON.stringify({ method }),
    }),
  dashboard: (slug: string, pin: string) =>
    req<Dashboard>("/api/dashboard/", { headers: { "X-SP-Business": slug, "X-SP-PIN": pin } }),
  void: (slug: string, pin: string, code: string, reason: string) =>
    req<Bill>(`/api/bills/${code}/void/`, {
      method: "POST",
      headers: { "X-SP-Business": slug, "X-SP-PIN": pin },
      body: JSON.stringify({ reason }),
    }),
  branding: (slug: string, pin: string, body: Partial<{ tagline: string; phone: string; location: string; accent: string; thank_you: string; logo_data_url: string }>) =>
    req<Branding>("/api/branding/", {
      method: "POST",
      headers: { "X-SP-Business": slug, "X-SP-PIN": pin },
      body: JSON.stringify(body),
    }),
  stkInitiate: (slug: string, pin: string, body: { phone: string; cycle: "monthly" | "annual"; plan_code?: string }) =>
    req<StkInitiated>("/api/mpesa/stk/", {
      method: "POST",
      headers: { "X-SP-Business": slug, "X-SP-PIN": pin },
      body: JSON.stringify(body),
    }),
  stkStatus: (slug: string, pin: string, paymentId: number) =>
    req<StkStatus>(`/api/mpesa/status/${paymentId}/`, {
      headers: { "X-SP-Business": slug, "X-SP-PIN": pin },
    }),
  mpesaHistory: (slug: string, pin: string) =>
    req<{ payments: MpesaPaymentRow[]; subscription: Subscription }>("/api/mpesa/history/", {
      headers: { "X-SP-Business": slug, "X-SP-PIN": pin },
    }),
  analytics: (slug: string, pin: string) =>
    req<Analytics>("/api/analytics/", { headers: { "X-SP-Business": slug, "X-SP-PIN": pin } }),
  inviteCreate: (slug: string, pin: string, name: string, staffPin: string) =>
    req<{ code: string; url: string; name: string }>("/api/invites/create/", {
      method: "POST",
      headers: { "X-SP-Business": slug, "X-SP-PIN": pin },
      body: JSON.stringify({ name, staff_pin: staffPin }),
    }),
  inviteAccept: (code: string, staffPin: string) =>
    req<{ business: { name: string; slug: string }; staff: { id: number; name: string }; token: string }>("/api/invites/accept/", {
      method: "POST",
      body: JSON.stringify({ code, staff_pin: staffPin }),
    }),
  redeemScanPlan: (slug: string, pin: string, receipt: string, cycle: "monthly" | "annual" = "monthly") =>
    req<{ ok: boolean; plan: string; amount: number; mpesa_receipt: string; subscription: Subscription; paid_until: string }>("/api/mpesa/redeem-plan/", {
      method: "POST",
      headers: { "X-SP-Business": slug, "X-SP-PIN": pin },
      body: JSON.stringify({ receipt, cycle }),
    }),
  redeemScanBill: (slug: string, code: string, receipt: string) =>
    req<Bill>(`/api/mpesa/redeem-bill/`, {
      method: "POST",
      headers: operatorHeaders(slug),
      body: JSON.stringify({ code, receipt }),
    }),
  platformOverview: (adminKey: string) =>
    req<PlatformOverview>("/api/platform-admin/overview/", {
      headers: { "X-SP-Admin-Key": adminKey },
    }),
  platformBusinesses: (adminKey: string) =>
    req<{ businesses: PlatformBusiness[] }>("/api/platform-admin/businesses/", {
      headers: { "X-SP-Admin-Key": adminKey },
    }),
  platformUpdateBusiness: (
    adminKey: string,
    slug: string,
    body: Partial<{ trial_days_add: number; paid_days_add: number; plan_code: string; owner_pin: string; name: string }>
  ) =>
    req<{ ok: boolean; business: Record<string, unknown> }>(`/api/platform-admin/businesses/${slug}/`, {
      method: "POST",
      headers: { "X-SP-Admin-Key": adminKey },
      body: JSON.stringify(body),
    }),
  platformPayments: (adminKey: string) =>
    req<{ payments: PlatformPayment[] }>("/api/platform-admin/payments/", {
      headers: { "X-SP-Admin-Key": adminKey },
    }),
};

const safeGet = (k: string) =>
  typeof window === "undefined" ? "" : localStorage.getItem(k) || "";

export const store = {
  get slug() {
    return safeGet("sp_slug");
  },
  set slug(v: string) {
    localStorage.setItem("sp_slug", v);
  },
  get pin() {
    return safeGet("sp_pin");
  },
  set pin(v: string) {
    localStorage.setItem("sp_pin", v);
  },
  get staffToken() {
    return safeGet("sp_staff_token");
  },
  set staffToken(v: string) {
    if (v) localStorage.setItem("sp_staff_token", v);
    else localStorage.removeItem("sp_staff_token");
  },
};

function operatorHeaders(slug: string): Record<string, string> {
  return {
    "X-SP-Business": slug,
    ...(store.staffToken ? { "X-SP-Staff-Token": store.staffToken } : {}),
    ...(!store.staffToken && store.pin ? { "X-SP-PIN": store.pin } : {}),
  };
}

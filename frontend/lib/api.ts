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
  accent: "blush" | "rose" | "luxe" | "plum" | "minimal"; thank_you: string;
};

export type Bill = {
  id: number;
  code: string;
  customer_name: string;
  status: "draft" | "pending" | "approved" | "paid" | "disputed" | "voided" | "refunded";
  total: number;
  staff_name: string;
  payment_method: string;
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
  business: { name: string; slug: string; plan: Plan };
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

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, { ...opts, headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
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
  createBill: (slug: string, body: { customer_name: string; staff_id: number; items: BillItem[] }) =>
    req<Bill>("/api/bills/", { method: "POST", headers: { "X-SP-Business": slug }, body: JSON.stringify(body) }),
  editBill: (
    slug: string,
    code: string,
    body: { staff_id: number; reason: string; changes: { item_id: number; new_price: number }[] }
  ) =>
    req<Bill>(`/api/bills/${code}/edit/`, {
      method: "POST",
      headers: { "X-SP-Business": slug },
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
      headers: { "X-SP-Business": slug },
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
  branding: (slug: string, pin: string, body: Partial<{ tagline: string; phone: string; location: string; accent: string; thank_you: string }>) =>
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
};

const safeGet = (k: string) =>
  typeof window === "undefined" ? "" : localStorage.getItem(k) || "";

export const store = {
  get slug() {
    return safeGet("sp_slug") || "xyz-salon";
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
};

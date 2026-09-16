"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/api";
import { BrandLoader } from "@/app/loading-state";

const steps = [
  ["01", "Service is complete", "Your team finishes the appointment."],
  ["02", "Bill is created", "Items, prices and discounts are recorded."],
  ["03", "Customer verifies", "A quick QR scan confirms the amount."],
  ["04", "You see the truth", "Payments and exceptions stay visible."],
];

function CheckIcon() {
  return <span className="check-icon" aria-hidden>✓</span>;
}

export default function Home() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (store.pin) router.replace("/owner");
    else setCheckingSession(false);
  }, [router]);

  if (checkingSession) {
    return <BrandLoader label="Opening SaloonOS…" />;
  }

  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="home-brand-lockup">
            <Image src="/logo-full.png" alt="SaloonOS — Manage, Verify, Grow" width={420} height={174} priority className="home-full-logo" />
          </div>
          <div className="eyebrow"><span className="eyebrow-dot" /> Built for salons that want clean books</div>
          <h1>Know what happened at <em>every</em> chair.</h1>
          <p className="hero-lede">SaloonOS turns each service into a customer-verified bill, so owners can grow with confidence instead of chasing missing payments.</p>
          <div className="hero-actions">
            <Link href="/signup" className="button button-primary">Start your free trial <span aria-hidden>↗</span></Link>
            <Link href="/pricing" className="button button-quiet">Compare plans</Link>
          </div>
          <div className="hero-proof"><CheckIcon /> 7 days free <span>·</span> No card required <span>·</span> Setup in 2 minutes</div>
        </div>

        <div className="dashboard-preview" aria-label="SaloonOS dashboard preview">
          <div className="preview-glow" />
          <div className="preview-window">
            <div className="preview-topbar"><div className="window-dots"><i /><i /><i /></div><span>Owner dashboard</span><div className="preview-avatar">M</div></div>
            <div className="preview-body">
              <div className="preview-sidebar"><div className="mini-mark">S</div><div className="side-active">▦</div><div>◷</div><div>♧</div><div className="side-bottom">⚙</div></div>
              <div className="preview-main">
                <div className="preview-heading"><div><small>Tuesday, 24 September</small><h3>Good morning, Mary</h3></div><span className="live-pill"><b /> Live</span></div>
                <div className="metric-grid"><div><small>Collected today</small><strong>KSh 18,450</strong><span className="up">↗ 12.8%</span></div><div><small>Verified bills</small><strong>24</strong><span className="muted">of 30 monthly</span></div><div><small>Needs attention</small><strong className="attention">02</strong><span className="muted">unpaid / disputed</span></div></div>
                <div className="preview-lower"><div className="activity-card"><div className="card-title"><strong>Live activity</strong><span>View all</span></div><div className="activity-row"><b className="activity-avatar rose">A</b><div><strong>Agnes verified a bill</strong><small>Braiding · 2 min ago</small></div><em>KSh 2,000</em></div><div className="activity-row"><b className="activity-avatar gold">J</b><div><strong>Jane created a bill</strong><small>Gel manicure · 8 min ago</small></div><em>KSh 1,500</em></div><div className="activity-row"><b className="activity-avatar plum">M</b><div><strong>Mary recorded payment</strong><small>Cut &amp; colour · 14 min ago</small></div><em>KSh 3,200</em></div></div><div className="verification-card"><div className="ring">94<span>%</span></div><strong>Verification rate</strong><small>Customers are confirming what they received.</small><div className="tiny-bar"><i /></div></div></div>
              </div>
            </div>
          </div>
          <div className="floating-proof"><span className="floating-check">✓</span><div><strong>Bill verified</strong><small>Customer approved · just now</small></div></div>
        </div>
      </section>

      <section className="trust-strip"><span>Designed for the daily rhythm of</span><strong>salons</strong><strong>barbershops</strong><strong>beauty studios</strong><strong>spa teams</strong></section>

      <section className="section-block">
        <div className="section-intro"><div className="eyebrow">A calmer way to run the floor</div><h2>Small moments of proof add up to <em>big</em> visibility.</h2><p>Make the right thing the easy thing for your staff and your customers.</p></div>
        <div className="feature-grid"><article className="feature-card feature-dark"><div className="feature-number">01</div><div className="feature-icon">⌁</div><h3>Customer-verified billing</h3><p>Customers see the service, price and total on their own phone before they pay.</p><Link href="/signup">See how it works <span>↗</span></Link></article><article className="feature-card"><div className="feature-number">02</div><div className="feature-icon icon-blush">▤</div><h3>Receipts people trust</h3><p>Every approved bill becomes a clear digital receipt with a reference they can keep.</p><Link href="/signup">Explore receipts <span>↗</span></Link></article><article className="feature-card"><div className="feature-number">03</div><div className="feature-icon icon-gold">!</div><h3>Exceptions, surfaced</h3><p>Verified but unpaid? Disputed? Your dashboard brings the important things forward.</p><Link href="/signup">View the dashboard <span>↗</span></Link></article></div>
      </section>

      <section className="process-section"><div className="section-intro"><div className="eyebrow">The whole loop</div><h2>From service to <em>certainty.</em></h2></div><div className="process-grid">{steps.map(([number, title, text]) => <div className="process-step" key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div></section>
      <section className="cta-section"><div><div className="eyebrow">Ready when you are</div><h2>Run a tighter, more trusted salon.</h2><p>Start with the full SaloonOS experience. Your first 7 days are on us.</p></div><Link href="/signup" className="button button-light">Start 7-day free trial <span>↗</span></Link></section>
    </main>
  );
}

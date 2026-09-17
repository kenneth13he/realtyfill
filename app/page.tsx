// app/page.tsx
// Logged-out landing page. A signed-in visit redirects straight to
// /dashboard — this page is only ever the pitch + sign-in/sign-up entry point.
//
// Visual direction: bold flat brand flood (vivid indigo), very large geometric
// display type, a lime accent, and hard colour inversions between sections
// (brand → white → deep ink) rather than one continuous pale page. The product
// mockup is rendered tonally in-brand instead of as a white screenshot.
//
// The hero is a scroll-driven stage (components/landing/ScrollStage.tsx): a 3D
// apartment tower pinned in view, lighting floor by floor as you scroll while
// the copy beside it advances. It carries the headline and CTAs, so this page
// has no separate hero block of its own.
//
// Copy rule for this page: every section makes one argument nobody else makes.
// An earlier pass had the hero's scroll panels restating How-it-works and the
// form list almost word for word, so a visitor read the same three sentences
// three times on the way down. The division now is — hero: what it does and
// why one source of truth beats five typed copies; mockup: what the screen
// looks like; statement: the stake; How it works: the three steps; Forms: what
// each of the five documents is actually *for*; Trust: the boundaries; CTA:
// the ask. If a new line here could move to another section without loss, it
// belongs in that section, not both.
//
// Footer links to /terms and /privacy, which landed alongside this redesign
// (REMAINING_WORK.md item 5). They were held back while those pages didn't
// exist — a dead footer link reads worse than a shorter footer.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Wordmark from "@/components/Wordmark";
import LandingNav from "@/components/landing/LandingNav";
import ScrollStage from "@/components/landing/ScrollStage";
import Marquee from "@/components/landing/Marquee";
import FadeIn from "@/components/landing/FadeIn";

const STEPS: [string, string, string][] = [
  ["01", "Drop the listing in", "Upload the listing PDF, or paste the text. Property, rent and term come back already filled."],
  ["02", "Correct what we read", "Every field is yours to change. Where the listing was genuinely ambiguous, we leave it empty and say why rather than guess."],
  ["03", "Take the whole set", "Read each filled PDF in the browser, fix anything still wrong, then download them together as one zip."],
];

// Code, form name, and what the form is actually for. The third line is the
// point of this section: the hero already checks the same five codes off as
// the tower tops out, so repeating just codes and names here would say
// nothing new. Descriptions are drawn from the fields the intake schema
// actually collects for each form — see forms/schemas/intake_form_schema.json.
const FORMS: [string, string, string][] = [
  [
    "2229E",
    "Residential Tenancy Agreement (Standard Lease)",
    "Ontario's mandatory standard lease. The document the tenancy itself runs on.",
  ],
  [
    "Form 400",
    "Agreement to Lease (Residential)",
    "The offer: rent, term, deposit, and the date it stays irrevocable until.",
  ],
  [
    "Form 410",
    "Rental Application (Residential)",
    "Who the applicants are: occupation, current address, current landlord, pets.",
  ],
  [
    "Form 324",
    "Confirmation of Co-operation and Representation",
    "Who represents whom, and which brokerage pays which commission.",
  ],
  [
    "Form 372",
    "Tenant Designated Representation Agreement",
    "Your authority to act for the tenant: dates, area, and services included.",
  ],
];

const TRUST: [string, string][] = [
  [
    "Only you can read your deals",
    "Access is enforced by the database itself, row by row. Not by the screen in front of you but by the layer underneath it, which cannot be talked around.",
  ],
  [
    "We never fill a signature",
    "Not a name in a signature box, not the date beside one. Those stay blank on every form we generate, with no setting to change it.",
  ],
  [
    "Nothing is generated unseen",
    "You read every field, and change any of them, before the first PDF is written. There is no step where the software decides on its own.",
  ],
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="bg-[var(--brand)]">
      <LandingNav />

      {/* ---------------- HERO: scroll-driven tower ----------------
          Owns the headline, the CTAs and the product story. The tower stays
          pinned while this section scrolls past and lights floor by floor.
          Collapses to a plain stacked hero below `lg` — see ScrollStage. */}
      <ScrollStage />

      {/* The tonal product mockup used to sit here. It showed the same five
          codes with the same tick chips as the hero's checklist, one screen
          apart, so a visitor read the set twice before reaching the section
          that actually says what each form is for. Removed rather than
          reworded — the duplication was the picture, not the caption.
          components/landing/VisualProof.tsx went with it; recoverable from
          git if a screenshot-style proof block is wanted again. */}

      {/* ---------------- STATEMENT + TICKER ---------------- */}
      <section className="px-6 py-28 text-center">
        <FadeIn>
          <h2 className="mx-auto max-w-5xl text-[2.75rem] font-semibold leading-[0.98] tracking-tight text-white sm:text-6xl xl:text-7xl">
            The paperwork is the last hour of a deal. It shouldn&apos;t be{" "}
            <span className="text-[var(--lime)]">the worst one.</span>
          </h2>
          {/* The ticker names the fields you'd otherwise copy across five PDFs,
              ending on the punchline. Decorative and aria-hidden — see Marquee. */}
          <div className="mt-12 flex justify-center">
            <Marquee
              className="max-w-md border border-white/25 text-white/70"
              items={["Unit number", "Start date", "Monthly rent", "Deposit", "Brokerage", "Again"]}
            />
          </div>
        </FadeIn>
      </section>

      {/* ---------------- HOW IT WORKS (white) ---------------- */}
      <section className="bg-white py-28">
        <div className="mx-auto max-w-7xl px-6">
          <FadeIn>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand)]">How it works</p>
            <h2 className="mt-5 max-w-3xl text-[2.5rem] font-semibold leading-[1] tracking-tight text-[var(--brand-deep)] sm:text-6xl">
              Three steps, and you sign off on every one.
            </h2>
          </FadeIn>

          <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-slate-200 md:grid-cols-3">
            {STEPS.map(([n, title, body], i) => (
              <FadeIn key={n} delayMs={i * 120} className="bg-white">
                <div className="h-full bg-white p-8">
                  <span className="text-5xl font-semibold tracking-tight text-[var(--brand)]/25">{n}</span>
                  <h3 className="mt-6 text-2xl font-semibold text-[var(--brand-deep)]">{title}</h3>
                  <p className="mt-3 leading-relaxed text-slate-600">{body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- FORMS (deep ink) ---------------- */}
      <section className="bg-[var(--brand-deep)] py-28">
        <div className="mx-auto max-w-7xl px-6">
          <FadeIn>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--lime)]">What&apos;s in the zip</p>
            <h2 className="mt-5 max-w-3xl text-[2.5rem] font-semibold leading-[1] tracking-tight text-white sm:text-6xl">
              An Ontario residential lease, start to finish.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/60">
              Five forms, and each one needs the deal spelled out again from the top. That&apos;s the part we take.
            </p>
          </FadeIn>

          <div className="mt-14 divide-y divide-white/10 border-y border-white/10">
            {FORMS.map(([code, name, purpose], i) => (
              <FadeIn key={code} delayMs={i * 70}>
                <div className="group flex flex-col gap-2 py-7 transition-colors sm:flex-row sm:items-baseline sm:gap-8">
                  <span className="w-32 shrink-0 text-2xl font-semibold text-[var(--lime)]">{code}</span>
                  <div className="min-w-0">
                    <span className="block text-lg text-white/70 transition-colors group-hover:text-white">{name}</span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-white/40">{purpose}</span>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- TRUST (white) ---------------- */}
      <section className="bg-white py-28">
        <div className="mx-auto max-w-7xl px-6">
          {/* These three cards previously floated with no heading over them,
              which read as filler. Named, they're the section that answers the
              question a realtor actually has about handing us a client's file. */}
          <FadeIn>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Where we stop</p>
            <h2 className="mt-5 mb-16 max-w-3xl text-[2.5rem] font-semibold leading-[1] tracking-tight text-[var(--brand-deep)] sm:text-6xl">
              Three lines we don&apos;t cross.
            </h2>
          </FadeIn>

          <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
            {TRUST.map(([title, body], i) => (
              <FadeIn key={title} delayMs={i * 120}>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--lime)] text-lg font-bold text-[var(--brand-deep)]" aria-hidden>
                  ✓
                </span>
                <h3 className="mt-6 text-xl font-semibold text-[var(--brand-deep)]">{title}</h3>
                <p className="mt-3 leading-relaxed text-slate-600">{body}</p>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- CLOSING CTA ---------------- */}
      <section className="bg-[var(--brand)] py-32">
        <FadeIn className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-[2.75rem] font-semibold leading-[0.98] tracking-tight text-white sm:text-7xl">
            Give it one listing. <span className="text-[var(--lime)]">Get the hour back.</span>
          </h2>
          <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-white/70">
            Signing up takes an email and a password. Bring one listing and see what comes back.
          </p>
          <Link
            href="/login?mode=signup"
            className="group mt-12 inline-flex items-center gap-2 rounded-full bg-[var(--lime)] px-10 py-5 text-lg font-semibold text-[var(--brand-deep)] transition-transform hover:-translate-y-0.5"
          >
            Get started free
            <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
          </Link>
        </FadeIn>
      </section>

      <footer className="bg-[var(--brand-deep)] py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm text-white/45 sm:flex-row">
          <Wordmark tone="dark" className="text-base" />
          <div className="flex items-center gap-4">
            <Link href="/terms" className="transition-colors hover:text-white">
              Terms of Service
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-white">
              Privacy Policy
            </Link>
            <span>© {new Date().getFullYear()} RealtyFill</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

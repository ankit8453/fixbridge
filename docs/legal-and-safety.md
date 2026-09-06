# FixBridge — Legal Protection and Safety Plan

**A living document.** Started 6 September 2026. Add to it whenever a lawyer, a CA, a partner or a customer teaches us something new. Every section ends with **"What we do"** so it stays a plan, not just a worry list.

Written in plain language on purpose. Where a law is named, the bracket after it says what it means in normal words.

---

## 1. The one idea behind everything

We think of FixBridge as a **marketplace** — we connect a customer to a technician, and the technician does the work. That is true, and every contract we sign should say so.

But here is the uncomfortable fact from the research: **Indian courts do not always agree.**

- A consumer court in 2022 held **Uber** responsible when a driver's mistake made a passenger miss her flight. The reason: she booked through Uber's app and **paid Uber**, so the driver was acting for Uber.
- The **Karnataka High Court** told Ola that "we are only a platform between drivers and passengers" **does not stand** as a defence.
- The **Supreme Court** is examining whether Ola and Uber can be held liable for crimes by their drivers.

So the pattern is: *the more the platform controls — booking, price, payment — the more the court treats it as the service provider.* We control all three. That is what makes FixBridge better than a phone-number directory, and it is also what puts us on the hook.

We cannot remove that risk. We can make sure that when something goes wrong, **four things are already in place**:

| Wall | What it means |
|---|---|
| **Paper** | Contracts that say who is responsible for what, signed before the first job |
| **Proof** | Records the app creates automatically, so it is never one person's word against another's |
| **Cover** | Insurance that pays, so a bad day does not become a bankruptcy |
| **Process** | Checking people before they join, and a fixed way of responding when something happens |

Everything below is one of those four walls.

---

## 2. Before anything else: the company itself

**FixBridge must be a Private Limited company, not a proprietorship, before launch.**

Why this comes first: in a proprietorship, a claim against the business is a claim against **your family's house and savings**. In a Private Limited company, the claim stops at the company. This is the single cheapest protection available, and every other item on this list — buying insurance, signing partner agreements, registering on the government gig-worker portal — needs a company to do it.

**What we do:**
- Incorporate FixBridge as a Private Limited company (CA to handle; roughly 2–3 weeks).
- Get a company PAN, bank account, and GST registration under the company.
- Every contract, every insurance policy, every registration below is in the company's name — never a personal name.

---

## 3. Scenario: a partner gets hurt

*He falls off a ladder. He gets an electric shock. His bike is hit on the way to a job.*

### What the law says

Technicians on FixBridge are **not our employees**. They choose their own hours, set their own prices, and can refuse any job. That matters legally, but it does **not** mean we owe nothing:

- The **Code on Social Security, 2020** (India's new labour law, in force since 21 November 2025) formally recognises "gig workers" and "platform workers" and expects platforms to help provide for them.
- If a partner dies on a job, the family **will** come to us — regardless of what the contract says. When a Zomato delivery worker was stabbed in **Indore** in 2022, the union demanded ₹50 lakh from Zomato. When a Swiggy worker died in Hyderabad, Swiggy paid ₹10 lakh from insurance. When another Swiggy worker died and the company refused (he was using his brother's ID), it became a national news story.

The lesson from those cases: **the companies that had insurance in place paid out and moved on. The ones that argued became headlines.**

### What the big platforms do

| Platform | Accident cover for partners |
|---|---|
| Zomato | Up to ₹10 lakh accident, ₹1 lakh medical, ₹50,000 loss-of-pay |
| Swiggy | Up to ₹2 lakh accident, from the first order |
| Urban Company | "Basic insurance" and health check-ups |

This is not expensive. **Acko** covers nearly a million gig workers through platform deals. Individual accident policies exist at **around ₹50 a year for ₹5 lakh cover**. Group policies for a platform's partners run **₹300–500 per worker per month** for richer cover.

### What we do

1. **Buy a group personal accident policy for every active partner** — target ₹5 lakh on death or permanent disability, plus hospitalisation. Get quotes from Acko, Go Digit, Plum, BimaKavach. At Jabalpur pilot size this is a few thousand rupees a month, and it is the difference between a tragedy and a tragedy plus a lawsuit.
2. **Register every partner on the government's e-Shram portal** (we must anyway — see Section 8). Registration gives them **₹5 lakh health cover (PM-JAY)** and **₹2 lakh accident cover** from the government, at no cost to us or them. Tell partners this when they join — it is a real benefit no phone-number directory offers.
3. **Safety gear is in the Partner Agreement.** Insulated tools for electricians, proper ladders, footwear. We cannot stand over them, but the agreement must say it, and the app should show a **per-trade safety checklist** when they accept a job (not built yet).
4. **Write it plainly in the agreement:** what the insurance covers, what it does not, and that FixBridge is not the employer. No surprises later.

---

## 4. Scenario: a partner steals, breaks something, or behaves badly

*The customer says the technician took a phone. Or cracked the marble while fitting a tap. Or was rude and left the job half done.*

### What the law says

- The **crime** (theft, assault) is the partner's, under the Bharatiya Nyaya Sanhita (the new IPC). The police case is against him, not us.
- But the **money claim** comes to us. Under the Consumer Protection Act, 2019, a customer who booked and paid through us can file for "deficiency in service" against FixBridge in the district consumer court in Jabalpur — cheap to file, no lawyer needed, and the forums lean towards the consumer.
- The IT Act's "safe harbour" (Section 79 — the rule that protects platforms from liability for what users post) helps with **content**, not with a broken tap. Do not rely on it for service complaints.

### What Urban Company does

Urban Company runs an **Insurance Protection Programme** for damage during a service — **capped at ₹10,000**. And **theft is explicitly excluded** from their cover. That is the market leader, after ten years. It tells you where the sensible line is: cover accidental damage up to a fixed amount; treat theft as a police matter, not a refund.

### What we do

**Before a partner is ever listed:**
- Identity document, photo, current address, and a **police verification certificate** (available from the local thana; many platforms require it). This is already part of our verification flow.
- Use a third-party verification service (**AuthBridge, IDfy, OnGrid**) for criminal-record and address checks, with the partner's **written consent** — required under the data law (Section 7).
- **Never store Aadhaar numbers.** Already built — the API refuses any 8+ digit run. Keep it that way.

**During every job — this is where FixBridge is genuinely ahead:**
- The customer's **start code** proves *this* person arrived at *this* home at *this* time, and the customer confirmed it.
- The **approved quote** proves the price was agreed in writing before work began.
- The **end code** proves the customer accepted the work as finished.
- **Cash is confirmed by both sides separately.**

A phone-number directory has none of this. When a dispute comes, we are not guessing.

**A damage policy of our own, written simply and shown publicly:**
- Accidental damage caused during a booked service: covered **up to ₹10,000**, reported **within 24 hours** with photos.
- **Theft: not a refund.** We help the customer file an FIR, we suspend the partner immediately, and we share the booking record with the police. Money is not handed over on an accusation — see Section 5 for why.
- Anything outside a FixBridge booking is outside the policy. This is the incentive to book through the app.

**After an incident:**
- Immediate suspension (already built — ops can suspend and it takes effect at once).
- A permanent block after a confirmed case. Keep a record so he cannot rejoin with a new phone number.

---

## 5. Scenario: a customer makes a false claim

*"He stole my watch" — but nothing was stolen. "He never came" — but he did. "I already paid him cash" — but he was paid nothing.*

This is the scenario your father raised, and it deserves its own section because it is real: on every platform, a share of complaints are attempts to get a free service or to hurt a technician.

### What protects us

**Evidence the app creates automatically.** Every one of these already exists in FixBridge:

| The claim | What we can show |
|---|---|
| "He never turned up" | The start code was entered on the customer's own phone, at 11:42 |
| "He charged more than agreed" | The quote, approved by the customer in writing, with the amount |
| "The work wasn't done" | The end code was entered — the customer's sign-off |
| "I paid cash / I didn't pay cash" | Two-sided confirmation, with a "not received" report the technician can file |
| "That's not the technician I booked" | The photo shown at acceptance, and the start code handshake |

**These records must be usable in court.** Under the Bharatiya Sakshya Adhiniyam, 2023 (the new Evidence Act), electronic records like app logs are admissible **with a certificate** from the person in charge of the system (Section 63 — the successor to the old Section 65B). We must be able to produce that certificate. Practically: keep logs for at least three years, and know who signs the certificate.

### What we do

1. **Never pay out on an accusation alone.** Every claim goes through the complaints process against a real booking, with the app's records checked first. A refund without a booking record is how a platform becomes a free-service scheme.
2. **Optional before/after photos by the partner** (not built yet). One tap when starting and finishing. It protects the technician more than anyone, and partners will use it once they see why.
3. **A written complaints process with timelines** — see Section 8. Acknowledge within 48 hours, decide within 30 days. That is the law, and it also stops "you ignored me" becoming part of the story.
4. **Customer blacklisting.** A customer with two false claims loses the app. We owe a duty to our partners too.
5. **Log retention: three years minimum.** Consumer complaints can be filed up to two years after the event.

---

## 6. Scenario: a customer harms a partner

*Non-payment. Abuse. Harassment of a woman technician. A man booking as a woman to get a female worker alone.*

### What the research found

This is the least-protected area in the whole industry. The Print reported women workers on Urban Company and Snabbit being molested by clients in Delhi and Bengaluru. Because they are not employees, **the POSH Act (the workplace sexual harassment law) does not cover them.** Complaints included dysfunctional helplines answered by bots, no identity checks on customers, and men impersonating women to book.

Urban Company's response, which is the current best practice:
- Women partners are assigned **only to women customers**.
- **No bookings after 7 pm** for women partners.
- An **SOS button** in the partner app, a **24-hour helpline**, and a **women-only safety line**.
- The app asks customers to offer water and washroom access.

### What we do

1. **"Not paid" report** — already built. The technician can say the cash never came, the customer is told, and the record exists.
2. **Customer identity is real.** Every customer is a verified phone number with a name. Not anonymous.
3. **SOS in the partner app** (not built): one tap sends live location to our helpline and a chosen family number. Cheap to build; do it before the first woman partner joins.
4. **A helpline number that a human answers**, from day one — even if it is your own phone during the pilot. A bot answering a frightened person is worse than no line.
5. **Women partners → women customers, daytime only**, as a default they can change. Same rule Urban Company arrived at after incidents.
6. **Customer blacklist**, shared across all partners. A customer who abuses one technician is not offered another.
7. Write it into the Customer Terms: abuse, non-payment or harassment ends the account.

---

## 7. Scenario: our data leaks

*KYC documents. Phone numbers. Home addresses. Photos of technicians.*

### What the law says

The **Digital Personal Data Protection Act, 2023** and its **Rules of 2025** (India's data privacy law, fully in force by May 2027 in phases) make FixBridge a "data fiduciary" — the party responsible for the data, even when a vendor handles it. Key duties:

- A **privacy notice in plain language** at sign-up: what we collect, why, how to complain.
- **Consent** for anything beyond running the service — specifically for background checks.
- If data leaks, **tell the Data Protection Board, and tell affected people within 72 hours**.
- **Penalties up to ₹250 crore** for weak security, ₹200 crore for failing to report a breach. These are for large companies, but the duties apply to everyone.

### What we do

Already in place:
- KYC documents in a **private bucket** with links that expire in minutes. Nothing is publicly readable.
- **Aadhaar numbers are never stored.**
- Phone numbers are **masked until a booking is accepted**.
- Bank details and PAN are **redacted from logs** and masked even to their owner.
- A **delete-user script** exists for a full erasure request.

Still to do:
- **Privacy notice, Hindi and English**, shown at signup and linked in the app.
- **Consent checkbox for background verification**, worded plainly.
- **A named person** for data complaints (can be the same as the grievance officer).
- **A breach plan**: who checks, who writes the 72-hour notice, who signs it. One page, decided in advance.

---

## 8. Rules we must follow — the registration checklist

| Requirement | What it is, plainly | Status |
|---|---|---|
| **Private Limited company** | Limits claims to the company, not the family | ☐ To do — first |
| **GST registration** | We are the "deemed supplier" for these services (Section 9(5)); **5% on the gross bill** | ☐ CA to confirm inclusive vs exclusive pricing |
| **e-Shram aggregator registration** | **Mandatory since 21 June 2026.** Every platform must register on e-Shram / Shram Suvidha and upload its workers within 45 days. Penalties under Section 133 of the Social Security Code. We are launching after the deadline, so this must be done at launch | ☐ **Urgent** |
| **Social Security Fund contribution** | 1–2% of turnover into the gig workers' fund, capped at 5% of what we pay partners, when notified | ☐ Budget for it |
| **Grievance Officer** (Consumer Protection E-Commerce Rules, 2020) | A named person and contact shown on the website; **acknowledge complaints in 48 hours, resolve in 30 days**; give the partner's details to a customer on written request | ☐ Name one, put it on the site |
| **IT Rules 2021 due diligence** | Terms of use, a grievance officer, take down unlawful content on notice | ☐ Same officer, covered by the Terms |
| **DPDP privacy notice and consent** | See Section 7 | ☐ To do |
| **Shops & Establishments registration (MP)** | Standard local business registration | ☐ CA |
| **Professional tax (MP)** | Standard | ☐ CA |
| **RBI — no holding customer money** | Below ₹40 lakh turnover we cannot run an escrow/split-settlement. Manual payouts only — already how it is designed | ✅ Designed in |
| **Madhya Pradesh gig-worker law** | None yet. Karnataka, Telangana, Jharkhand, Rajasthan and Bihar have passed or drafted one. **Watch for MP** — it will come, and will likely require registration and a welfare fee | 👁 Watch |

---

## 9. Documents we need before launch

Each of these needs a lawyer to draft or review. This list is what to ask for, so the lawyer's time is spent well.

1. **Partner Agreement** — independent contractor, not employee; code of conduct; safety gear; the insurance we provide and its limits; our right to suspend; no cash unless the customer chose it; consent to background checks; what happens on a confirmed complaint.
2. **Customer Terms of Service** — FixBridge is a marketplace; the price freezes at approval; the visit fee and when it applies; cancellation; **the damage policy and its ₹10,000 cap; theft is a police matter**; how to complain; disputes go to Jabalpur courts.
3. **Privacy Policy** — DPDP-compliant, Hindi and English.
4. **Damage Protection Policy** — one page, public, simple, matching the Terms.
5. **Grievance Officer notice** — name, email, phone, on the website.
6. **Incident Playbook** — one page: *in the first hour after a serious incident, who calls whom.* Partner injured → helpline, hospital, insurer, family. Theft alleged → suspend, FIR guidance, preserve records. Data breach → contain, 72-hour notice.

---

## 10. Insurance shopping list

| Policy | Protects against | Who sells it | Priority |
|---|---|---|---|
| **Group Personal Accident** for partners | Partner death or injury on the job | Acko, Go Digit, Plum | **Before launch** |
| **Commercial General Liability** for the company | Third-party injury or property damage claims against FixBridge | Bajaj Allianz, Go Digit, BimaKavach | Before launch if affordable; else within 3 months |
| **Professional Indemnity** | "The service was done wrong" claims — CGL excludes these | Go Digit | Year one |
| **Cyber / data breach** | Costs of a leak and the notices | Various | When data volume grows |

Get three quotes for each. Tell the insurer honestly that partners are independent contractors on a marketplace — a policy bought on the wrong description does not pay.

---

## 11. What the app already does, and what is missing

Honest status, so nobody assumes something exists that does not.

| Protection | Status |
|---|---|
| Start and end codes on the customer's phone | ✅ Built |
| Price frozen at approval; extras need a written reason | ✅ Built |
| Two-sided cash confirmation, with "not received" report | ✅ Built |
| Phone numbers masked until acceptance | ✅ Built |
| Aadhaar never stored; KYC in a private bucket | ✅ Built |
| Ops suspension, effective immediately | ✅ Built |
| Complaints module with categories | ✅ Built |
| Full user erasure on request | ✅ Built (script) |
| Bank details masked and redacted | ✅ Built |
| Per-trade safety checklist on job accept | ☐ Not built |
| Before/after photos by the partner | ☐ Not built |
| SOS button and live-location share in partner app | ☐ Not built |
| Women partners → women customers, daytime default | ☐ Not built |
| Customer blacklist across partners | ☐ Not built |
| Privacy notice and BGV consent screen | ☐ Not built |
| e-Shram registration flow for partners | ☐ Not built |
| Evidence-certificate export for a booking (Section 63) | ☐ Not built |

---

## 12. Questions to take to the lawyer and the CA

**Lawyer:**
1. Review the Partner Agreement and Customer Terms against the Consumer Protection Act, 2019 and the E-Commerce Rules, 2020.
2. Is a ₹10,000 damage cap with theft excluded defensible in the Jabalpur consumer forum, given Urban Company uses the same?
3. What is the exact e-Shram aggregator registration procedure for a new platform launching after the June 2026 deadline, and is there any small-platform threshold?
4. Who should sign the Section 63 electronic-evidence certificate, and in what form?
5. Does anything in MP law today require a welfare board registration or fee for gig platforms?

**CA:**
1. Is our quoted price GST-inclusive or exclusive? (This decides whether 5% comes out of our commission or the customer's bill.)
2. Company incorporation, GST, Shops & Establishments, professional tax — timeline and cost.
3. How to account for the 1–2% Social Security Fund contribution.
4. TDS on partner payouts once we hold PAN.

---

## 13. How money moves, and the three decisions that follow

Added 6 September 2026, after working through it properly.

### The rule

**Only a licensed payment company may hold other people's money.** That licence needs ₹15–25 crore of net worth, which we will not have. So FixBridge must never have customer money sitting in its bank account waiting to be paid onward.

### Cash — how it works today, and it is legal

```
Customer  ──── ₹500 in hand ────►  Technician
```

The money never touches us. When he taps "I have the cash", we record that **he owes us ₹50 commission** — a number in a ledger, not money we hold. Like a shop's khata. We bill him for the dues weekly.

Nothing to license, nothing to hold, no exposure. **For the pilot this is not a limitation, it is the safe choice.**

### Online — the only shape that is allowed

Not "customer pays us, we pay him later." That is the shape the RBI rule exists to stop. The allowed shape is **split settlement** (Razorpay calls it Route, Cashfree calls it Easy Split):

```
Customer pays ₹500
        │
        ▼
Gateway's own escrow  ← they hold the licence, not us
        │
        ├──► ₹450 straight to the technician's bank or UPI
        └──► ₹50 to us
```

We never hold it, so we never need the licence.

**The friction:** the gateway must register each technician as a sub-merchant — his PAN, bank account and KYC, with them. That is real paperwork for a Jabalpur electrician. The payout details we already collect are exactly what a gateway needs, so the data side is done; the onboarding experience is the unknown.

**What to ask Paytm — not "what is your rate":**
> *Do you support split settlement, and exactly what must a technician provide to be registered as a sub-merchant?*

If that onboarding is heavy, cash stays the main path for longer, and that is an acceptable answer.

### Decision 1 — a joining fee, not only a commission

**The problem it solves:** once commission starts, a technician can say *"cancel the booking and pay me directly."* That is the biggest structural risk in any marketplace and it cannot be stopped completely.

Three things already make it expensive for him:

- **He has to bribe the customer.** His only offer is "pay me directly and it is cheaper" — which cuts his own ₹450 to save our ₹50. He loses more than he saves.
- **The pattern is visible.** Arriving and then cancelling is recorded with timestamps. One is normal; ten in a month is a signal.
- **He loses his ratings.** Off-platform work builds no reviews, no trust score, no earnings history. He keeps ₹50 once and loses what brings next month's bookings.

**A joining fee is stronger than all three**, because it is money already paid. Dodging ₹50 does not get it back. It converts a per-job temptation into a sunk cost — and it funds the insurance that gives the *customer* a reason to insist on booking through the app.

**The risk:** charging before he has earned anything is the hardest possible sale. Two ways round it:
- Make it **refundable against his first 10 jobs**, or
- Charge it only **after** he has bookings.

### Decision 2 — insure the damage cover, do not self-fund it

If FixBridge pays damage claims from its own pocket, every fake claim is our money and we are the investigator. If an **insurance company** covers it, they have claims investigators, they have seen every trick, and fraud becomes their problem.

**This is the single strongest answer to the collusion worry** — a customer and technician who know each other staging a fake claim. It is worth paying a premium for.

### Decision 3 — six defences against a staged claim

In rough order of strength:

1. **Insure it, do not self-fund** — see above.
2. **An excess of ₹500.** We cover damage above that. Nobody stages a fake ₹2,000 claim to split ₹1,500 two ways. This alone kills most small fraud.
3. **Photos from inside the app only** — taken with the camera at that moment, never picked from the gallery. Pre-existing damage cannot be uploaded.
4. **Only on a completed booking** — start code entered, end code entered, price agreed. Which means the customer already confirmed twice that everything was fine.
5. **Watch for repeats** — the same customer claiming often, the same technician involved often, and above all **the same pair appearing twice**. That last one is the giveaway for collusion and it is a simple database query.
6. **A waiting period** — no claims from a technician in his first 30 days. Somebody joining to run a scam must wait a month and do real work first.

### The shape that comes out of all this

| Piece | What it does |
|---|---|
| **Joining fee** | Funds the insurance, and is the strongest anti-dodge mechanism |
| **Insurance** | Covers damage, and the insurer bears the fraud risk |
| **Damage cover** | The reason a customer insists on booking in the app |
| **Low commission** | So dodging it is not worth the trouble |

This is coherent, and it is meaningfully different from Urban Company — who charge 28% commission, no joining fee, cap damage at ₹10,000 and exclude theft.

**Still to decide:** the joining fee amount, and whether it is refundable against early jobs. Both need a conversation with two or three real technicians before being set.

---

## 14. Update log

| Date | What was added | By |
|---|---|---|
| 6 Sep 2026 | First version, from research into Urban Company, Zomato, Swiggy, Ola/Uber case law, the Social Security Code, DPDP, and the E-Commerce Rules | Ankit / Claude |

---

## Sources

- [Women's safety and app-based cab services — Bar and Bench](https://www.barandbench.com/columns/womens-safety-and-app-based-cab-services-a-case-of-elusive-accountability)
- [Liability of cab aggregators vis-à-vis consumers — NLIU CBCL](https://cbcl.nliu.ac.in/contract-law/the-liability-of-cab-aggregators-in-india-vis-a-vis-their-consumers/)
- [SC to examine if Uber, Ola liable for drivers' crimes — Tribune](https://www.tribuneindia.com/news/archive/nation/sc-to-examine-if-uber-ola-can-be-held-liable-for-crime-committed-by-drivers-481216)
- [Consumer Protection (E-Commerce) Rules, 2020 — overview](https://www.indialaw.in/blog/civil/consumer-protection-e-commerce-rules/)
- [Safe harbour for e-commerce platforms — Cyril Amarchand](https://corporate.cyrilamarchandblogs.com/2021/07/safe-harbour-protection-for-e-commerce-platforms/)
- [Urban Company extended warranty terms — ₹10,000 cap, theft excluded](https://www.urbancompany.com/extended-warranty/tnc)
- [Urban Company sues protesting workers — The Wire](https://m.thewire.in/article/rights/urban-company-sues-workers-for-protesting-against-unfair-labour-practices-protest-called-off)
- [Molested by clients: women gig workers — The Print](https://theprint.in/ground-reports/snabbit-urban-company-women-gig-workers-molested-delhi-bengaluru/2877171/)
- [Urban Company and women's gig work — Rest of World](https://restofworld.org/2023/urban-company-gig-work-women-india/)
- [Zomato & Swiggy should compensate for deaths — Medianama](https://www.medianama.com/2022/08/223-ifat-zomato-swiggy-workers-death/)
- [Hyderabad delivery agent's death, family refused — The News Minute](https://www.thenewsminute.com/telangana/hyderabad-delivery-agent-s-death-swiggy-refused-provide-compensation-say-kin-172077)
- [Insurance for gig workers: Zomato vs Swiggy plans](https://www.oneassure.in/insurance/health-insurance-guides/insurance-for-gig-workers-zomato-swiggy-plans)
- [Acko covers nearly a million gig workers — TechCrunch](https://techcrunch.com/2021/10/27/amazon-backed-insurtech-acko-joins-unicorn-club-with-255-million-funding)
- [eShram deadline for all aggregators, 21 June 2026 — SCC Online](https://www.scconline.com/blog/post/2026/06/02/eshram-deadline-aggregators-june-21-gig-workers/)
- [India mandates aggregator onboarding to eShram — DLA Piper](https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/india-mandates-aggregator-onboarding-to-eshram-portal-to-expand-social-security-coverage)
- [Karnataka Platform-Based Gig Workers Act, 2025 — PRS](https://prsindia.org/bills/states/the-karnataka-platform-based-gig-workers-social-security-and-welfare-bill-2025)
- [DPDP Act 2023 and Rules 2025 compliance guide — EY](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023)
- [DPDP penalties — Tsaaro](https://tsaaro.com/blogs/enforcement-and-penalties-under-the-dpdpa-2023-and-draft-dpdp-rules-2025)
- [Background verification for gig workers — SalaryBox](https://salarybox.in/blog/background-verification-for-gig-workers-in-india-why-platforms-and-businesses-must-verify-delivery-partners-drivers-and-field-workers/)
- [AuthBridge gig worker verification](https://authbridge.com/solutions/gig-worker-verification/)
- [Commercial General Liability insurance in India — BimaKavach](https://www.bimakavach.com/blog/what-is-commercial-general-liability-insurance-in-india/)

# Operations guide

This is the manual for the people who run the marketplace day to day. It assumes
you have never seen the code and never will.

Everything you do in the console is **recorded with your name on it**. That is not
surveillance — it is protection. When a technician calls in six months asking why
their account was closed, the answer is in the audit log with the reason you
typed, and nobody has to rely on anyone's memory.

---

## Who you are

There are four kinds of account:

| Role           | Who                       |
| -------------- | ------------------------- |
| **customer**   | somebody booking a job    |
| **technician** | a partner doing the work  |
| **ops**        | you — the operations team |
| **admin**      | the owner                 |

`ops` and `admin` see the same console. The difference is intent: `admin` is the
business owner, `ops` is staff. Roles are set up for you; there is no screen for
granting them yet.

**A customer or technician who signs into the console is refused**, with a message
saying so. That is deliberate.

---

## Signing in

1. Open the console.
2. Type your phone number, tap **Send code**.
3. Type the 6-digit code you receive, tap **Sign in**.

There is no password and there never will be — the same OTP login the apps use.
If you are signed out unexpectedly, sign in again; nothing is lost.

> **On a development machine** the console shows a hint: numbers starting
> `+9199999` accept the code `000000`. The dev ops account is `+919999900002` and
> the dev admin is `+919999900001`. This never appears on the real site.

---

## The Overview screen

The first thing you see every morning. Each card is a count of **people waiting**,
and every card is clickable.

| Card                                  | What it means                                                | Where it goes      |
| ------------------------------------- | ------------------------------------------------------------ | ------------------ |
| Verification pending                  | Technicians who submitted documents and have not been judged | Verification queue |
| Open complaints                       | Somebody said something went wrong                           | Complaints         |
| Review reports                        | Somebody flagged a review as unfair                          | Reviews            |
| OTP-locked bookings                   | A job stuck because the door code failed five times          | Bookings           |
| Parked deliveries / outbox / webhooks | Something the system tried and gave up on                    | Queues             |
| Pending payout batch                  | Money waiting to be sent to technicians                      | Money              |
| Suspended technicians                 | Currently barred from getting work                           | Providers          |

Below them: today's bookings by status, and the money tiles — what came in, what
we earned, what we owe technicians, what they owe us.

**Work top to bottom.** The cards are ordered by how long somebody has been
waiting on you.

---

## Job 1 — Verifying a technician

A technician cannot appear in search until they are verified. This is the queue
that decides it.

1. Open **Verification**. The list is **oldest first** — the person at the top has
   been waiting longest. Do not skip down it.
2. Click a case. You will see what they submitted, their documents, and every
   step of their case so far.
3. Click **Take up** before you start. This marks the case as being looked at, so
   two of you do not judge the same one.
4. Look at the documents. Photos open in the page. Anything that is not a photo
   is a download link — click it only if you need to.
5. Check the name on the document against the name on the profile, and that the
   photo is legible and not expired.
6. Decide:
   - **Pass** — everything matches. They move up the ladder.
   - **Request info** — something is missing or unreadable. **Say exactly what**
     in the note: "the Aadhaar photo is cut off on the right — please send it
     again". They get your note.
   - **Fail** — the document does not support the claim, or it is somebody
     else's. A failed case is closed for good; they would have to start a new one.
7. The note is required. Write it for the technician, not for us.

> **Never pass a case you are unsure about.** Requesting more information costs a
> day. Passing a technician who is not who they say they are costs a customer
> their safety, and us the business.

---

## Job 2 — Resolving a complaint

1. Open **Complaints**. Oldest first again.
2. Click one. The booking's whole history is embedded below it: what happened,
   what was quoted, what was paid, and what each side was told and when.
3. Click **Take up**.
4. Read the timeline before you phone anybody. Most "I was overcharged"
   complaints are answered by the quote the customer approved.
5. Call both sides if the timeline does not settle it.
6. Decide:
   - **Resolve** — the complaint was justified. You must pick a **severity**:
     - **Minor** — annoying, not harmful. Late, untidy, brusque.
     - **Major** — the customer lost money or the job had to be redone.
     - **Severe** — safety, theft, or deliberate dishonesty.
   - **Dismiss** — nothing was wrong. This counts against **nobody**; being
     accused is not a record.
7. The note is required either way.

> **Severity is not a feeling — it has consequences.** A `severe` resolution
> **suspends the technician immediately**. Do not reach for it to express
> annoyance; reach for it when somebody should not be in a stranger's home
> tomorrow.

---

## Job 3 — Unlocking a booking

A technician types a 4-digit code at the customer's door to start a job. After
**five wrong attempts the booking locks**, and neither side can proceed. This is
on purpose: the code proves a specific person is at a specific door, so the system
will not quietly hand out a new one.

Unlocking it is your job, and it means you have checked who you are talking to.

1. Find the booking. **Bookings** → paste the booking id, or type either party's
   phone number.
2. If it is locked you will see a red **Handshake locked** banner.
3. **Phone the customer on the number on their account.** Not a number anyone gave
   you on a call — the one on file.
4. Confirm the technician is actually at their door.
5. Click **Unlock**, and in the note write what you did: _"Called the customer on
   the number on file, confirmed the technician was outside."_
6. Read the start code out to the customer. The code has not changed — only the
   attempt counter was cleared.

> **The note is the whole control.** Without it, an unlock is indistinguishable
> from somebody clicking a button because a queue looked untidy.

---

## Job 4 — Running a payout batch

Technicians are paid by hand, in batches. Money never moves without a human.

1. Open **Money → Payout batches**.
2. Click **Create batch**. This gathers everybody currently owed more than the
   minimum. Nothing has been sent yet.
3. Read the list. Each line is one technician and one amount.
4. For each line, make the transfer **in your bank's own app**. The console does
   not move money.
5. Come back and click **Mark paid** on that line, and type the **UTR** your bank
   gave you.
6. If a transfer bounced, click **Mark failed** and say why. That technician's
   money rolls into the next batch — it is not lost.
7. When every line is paid or failed, click **Close batch**.

> **The UTR matters more than it looks.** When a technician says the money never
> arrived, the UTR is the number they take to their own bank. A batch closed with
> a made-up reference is a technician who cannot chase their own wages.

A batch with any line still pending **cannot be closed**. That guard exists so a
run cannot be signed off with somebody unpaid inside it.

---

## Job 5 — Recording a dues settlement

When a customer pays a technician **in cash**, the technician keeps the whole
amount and then owes us our commission. When they pay that back:

1. Open **Money → Dues settlement**.
2. Find the technician. Their outstanding dues are shown.
3. Enter the amount they actually paid and a memo with the reference —
   _"UPI, ref 4471, 16 Aug"_.
4. Submit.

Their dues drop by that amount immediately. If the number afterwards is not what
you expected, **stop and ask** rather than adjusting it again — every settlement
is a permanent entry in the books.

---

## The other screens

**Providers** — the screen where most phone calls get answered. Search a name or
phone. The top of the page tells you, separately, whether they are: listed,
active, verified, not suspended, and approved. A technician saying "I get no
work" is almost always one of those five reading red. It also shows their trust
score broken into its parts, their wallet, and their recent jobs.

**Bookings** — search, then the full history. This is the dispute screen.

**Reviews** — reviews somebody has flagged. Hiding one removes it from the
technician's rating immediately. Hide reviews that are abusive or not about the
work; leave the ones that are simply unflattering.

**Queues** — things the system tried and gave up on.

- **Retry** when you know what was wrong and it is now fixed.
- **Discard** when the thing can never succeed. It is kept, marked, with your
  reason — nothing is deleted.

**Audit log** — everything anybody did, filterable by person, action and date.
Read-only. This is where you look when a decision needs explaining.

---

## Rules that are not negotiable

1. **Always write a real reason.** "As discussed" and "per policy" are not
   reasons. In six months, your note is the only thing that will exist.
2. **Never suspend or block to make a queue shorter.** Both cut off somebody's
   income the moment you click.
3. **Oldest first.** Every queue is ordered that way for a reason — a queue
   worked newest-first is one where the oldest item is never reached.
4. **If money looks wrong, stop.** Do not settle, refund or adjust to make a
   number look right. Ask.
5. **Verify identity by calling the number on the account**, never a number
   somebody read out to you on a call they made.

---

## Running the console locally

From the repository root:

```bash
docker compose up -d          # Postgres, Redis, MinIO
npm install
npm run migrate:deploy
npm run seed
npm run start:dev             # the API, on :3000
npm run dev:admin             # the console, on :5173
```

Sign in with `+919999900002` (ops) or `+919999900001` (admin) and the code
`000000`.

# WhatsApp messages — setup guide

ZOLA STYLISH MANAGEMENT SYSTEM can message customers on WhatsApp automatically:

| When | Message (you can change the wording in *Settings → Notifications*) |
| --- | --- |
| An appointment is booked (not walk-ins) | Booking details, and *"Please reply YES to confirm. If you will be late, reply LATE and the minutes, e.g. LATE 15."* |
| Before the appointment (24 hours by default) | A reminder that asks the same question. A booking made less than 24 hours ahead gets only the booking message, not a second one. |
| An appointment is cancelled | A short cancellation notice. |
| The customer pays | *"Thank you for choosing … It was a pleasure serving you, and we look forward to welcoming you again soon."* A customer who pays later is thanked with their first payment. |

When the customer **replies**, the system acts on it:

| Customer replies | What happens |
| --- | --- |
| YES, OK, SAWA, NDIYO, 👍, "Confirm" button | The appointment is marked **confirmed** (👍 on the calendar), and the customer gets a short thank-you. |
| LATE 15, "20 min late", NITACHELEWA DAKIKA 20, "Running late" button | The appointment shows **Running 15 min late** (⏱ +15m on the calendar). The front desk and the stylist get a notification. The customer gets an answer. |
| CANCEL, NO, SITAKUJA, "can't make it" | The front desk gets a notification to **call the customer**; nothing is cancelled automatically. |
| STOP, ACHA | That customer receives no more automatic messages or promotions. |
| Anything else | Passed to the front desk as a notification with the customer's words. |

Every message sent and received is listed in **Notifications → Customer messages**.

> Until WhatsApp is connected (steps below), the system only writes messages to its log ("log only"): nothing reaches customers.

---

## What you need

- A **phone number for the salon's WhatsApp Business account** that can receive an SMS or call once for verification. A number already used in the WhatsApp or WhatsApp Business app can be moved, or connected in "coexistence" mode where Meta offers it; otherwise use a new number.
- A **Meta Business account** (free): <https://business.facebook.com>.
- For customer replies: the system must be reachable from the internet at an **https** address (see step 5). Sending works without this; replies do not.

Meta charges for messages the business starts (booking confirmations, reminders, thank-you notes) at its published rates per country. Answers within 24 hours of a customer's message are free.

## 1. Create the Meta app and phone number

1. Go to <https://developers.facebook.com> → **My Apps** → **Create app**. Choose the **Business** type and connect it to your Meta Business account.
2. In the app, add the **WhatsApp** product.
3. Under **WhatsApp → API Setup**, add the salon's phone number and verify it with the code Meta sends. Meta also reviews the display name (the salon name customers see).
4. Copy the **Phone number ID** shown under the number.

## 2. Create a permanent access token

The token on the API Setup page expires after 24 hours; use a permanent one:

1. <https://business.facebook.com> → **Business settings** → **Users → System users** → **Add** (role *Admin*).
2. **Assign assets**: the app (full control) and the WhatsApp account (full control).
3. **Generate new token** for the app, with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Copy it; Meta shows it only once.

## 3. Enter the details in the system

*Settings → Integrations → WhatsApp Business*:

- **Provider**: *Meta WhatsApp Cloud API*
- **Phone number ID** and **Access token** from steps 1–2.
- **Save changes.**

## 4. Get the message templates approved

WhatsApp only delivers messages the salon starts when they use a **template approved by Meta** (answers to a customer's message within 24 hours need none). For each message in *Settings → Integrations → Approved message templates*:

1. Click **Show the text to submit** and **Copy text**. It is your message with `{{1}}`, `{{2}}`, … in place of the customer's name, date and so on, in the order the system fills them.
2. In **WhatsApp Manager → Message templates → Create template**, choose category **Utility**, give it a name (lower-case letters, numbers and `_`, e.g. `booking_confirmation`) and the language (e.g. English `en`).
3. Paste the text into the body. Meta asks for a sample value for each `{{n}}`; any realistic example will do.
4. Optional but recommended for the booking and reminder templates: add **quick reply buttons** "Confirm" and "Running late". The system understands both.
5. Submit. Approval usually takes minutes, sometimes up to a day.
6. Back in the system, type the **template name** and **language** next to the message, and save.

If you later change a message's wording in *Settings → Notifications*, submit the new text as a new template too; customers receive the wording Meta approved.

## 5. Receive customer replies (webhook)

WhatsApp delivers replies by calling the system's **callback URL**, so the system needs an https internet address:

- **Hosted on a server** with a domain and certificate ([DEPLOYMENT.md](DEPLOYMENT.md)): use that address.
- **On the salon computer**: publish it securely with a tunnel service such as Cloudflare Tunnel, which gives it an https address without opening ports on the router. Ask your technician to set it up; the system itself needs no changes.

Then:

1. *Settings → Integrations → Customer replies*: enter the **internet address of this system** (e.g. `https://salon.example.com`) if you do not already open it there, click **Generate one** next to **Verify token**, and paste the **App secret** (Meta app → **App settings → Basic → App secret → Show**). Save.
2. In the Meta app → **WhatsApp → Configuration → Webhook → Edit**: paste the **Callback URL** (copy it from the settings page) and the same **Verify token**, then **Verify and save**.
3. Under **Webhook fields**, **Subscribe** to `messages`.

Every reply is checked with the app secret; requests without a valid signature are refused, so nobody else can fake replies.

## 6. Test it

1. From your own phone, send "Hi" to the salon's WhatsApp number (this opens the 24-hour window), then use **Send test** on the settings page: the test message should arrive.
2. Add yourself as a customer, book an appointment for tomorrow: the booking message arrives (this uses the approved template).
3. Reply **YES**: the appointment shows *Customer confirmed* and you receive the thank-you answer. Try **LATE 10** on another booking and check the notification bell.
4. Take a payment for yourself at the point of sale: the thank-you message arrives.

## Using Twilio instead

Choose *Twilio WhatsApp* as the provider and fill in the Twilio account SID, auth token and the WhatsApp-enabled sender number (SMS section). Create the templates in Twilio's **Content Template Builder** and enter each template's **Content SID** (`HX…`). For replies, set the sender's **"A message comes in"** webhook to the callback URL (HTTP POST); replies are checked with the Twilio auth token.

## Troubleshooting

Look in **Notifications → Customer messages**: a failed message shows the reason under *Failed*, and **Retry** sends it again.

| Reason shown | Meaning and fix |
| --- | --- |
| *Re-engagement message (131047)* or "outside the 24-hour window" | No approved template is set for this message. Complete step 4. |
| *Template name does not exist (132001)* | The template name or language in Settings differs from WhatsApp Manager, or it is not approved yet. |
| *Number of parameters does not match (132000)* | The message wording was changed after the template was approved. Submit the new text (step 4). |
| *Message undeliverable (131026)* | Usually the customer's number has no WhatsApp. Call or SMS them instead. |
| *Error validating access token* | The token expired or was revoked. Create a permanent token (step 2). |
| Stays *Queued* | The system could not reach WhatsApp (no internet); it retries automatically. |

Replies not arriving? Check that the callback URL starts with `https://` and opens from outside the salon, that the app secret is saved, and that `messages` is subscribed. The server log records "WhatsApp webhook refused" when a signature or verify token does not match.

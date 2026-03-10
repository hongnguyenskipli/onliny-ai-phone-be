# Onliny AI Phone — Backend (Node.js / Express)

REST API server for Onliny AI Phone, handling authentication, Twilio voice, and Firebase.

---

## Prerequisites

- **Node.js** >= 20
- **ngrok** — required so Twilio can reach this server via webhooks ([download](https://ngrok.com/download))

---

## 1. Install Dependencies

```bash
npm install
cp .env.example .env
```

---

## 2. Environment Variables

Fill in `.env` with the following:

### Firebase
1. Go to [Firebase Console](https://console.firebase.google.com) → your project → **Project Settings** → **Service Accounts**
2. Click **Generate new private key** → download the JSON file
3. Copy values from that JSON into the corresponding `FIREBASE_*` variables in `.env`

### AWS SES (Email)
1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam) → create a user with `AmazonSESFullAccess`
2. Generate **Access Key ID** and **Secret Access Key** → set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
3. Verify a sender email in [AWS SES](https://console.aws.amazon.com/ses) → set as `AWS_VERIFIED_EMAIL`

### Twilio
1. Go to [Twilio Console](https://console.twilio.com)
2. **Account SID** & **Auth Token** → from the main dashboard → set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
3. **Phone Number** → **Phone Numbers → Manage → Active Numbers** → set `TWILIO_PHONE_NUMBER`
4. **API Key & Secret** → [API Keys](https://console.twilio.com/us1/account/keys-credentials/api-keys) → Create new key → set `TWILIO_API_KEY` and `TWILIO_API_SECRET`
5. **TwiML App SID** → see **Section 4** below → set `TWILIO_APP_SID`

---

## 3. ngrok Setup (Required for Twilio Webhooks)

Twilio needs a **public HTTPS URL** to send webhook events to this server. Expose it via ngrok:

```bash
ngrok http 8080
```

You will get output like:

```
Forwarding   https://xxxx-xx-xx-xxx-xxx.ngrok-free.app -> http://localhost:8080
```

Copy that `https://xxxx-....ngrok-free.app` URL — you'll need it in the next step.

> **Note:** The ngrok URL changes every time you restart ngrok (free plan). You must update Twilio webhook URLs each time.

---

## 4. Twilio Configuration

### TwiML App (handles outgoing calls)

1. Go to [Twilio Console → TwiML Apps](https://console.twilio.com/us1/develop/voice/manage/twiml-apps)
2. Click **Create new TwiML App** (or edit an existing one)
3. Set:

| Field | Value |
|---|---|
| **Voice → Request URL** | `https://<ngrok-url>/api/voice/outgoing` |
| **Voice → Request Method** | `HTTP POST` |

4. Save and copy the **SID** → set as `TWILIO_APP_SID` in `.env`

### Phone Number Webhook (handles incoming calls)

1. Go to [Twilio Console → Active Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/active)
2. Click on your phone number
3. Under **Voice Configuration → A call comes in**:
   - Set to **Webhook** → `https://<ngrok-url>/api/voice/incoming`
   - Method: `HTTP POST`
4. Save

---

## 5. Run the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:8080`.

---

## Summary Checklist

- [ ] `.env` filled with Firebase, AWS SES, and Twilio credentials
- [ ] `ngrok http 8080` running and ngrok URL copied
- [ ] Twilio TwiML App **Voice Request URL** set to `https://<ngrok-url>/api/voice/outgoing`
- [ ] Twilio Phone Number **incoming webhook** set to `https://<ngrok-url>/api/voice/incoming`
- [ ] `npm run dev` to start the server

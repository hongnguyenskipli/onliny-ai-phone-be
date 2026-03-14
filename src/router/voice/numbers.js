import { Router } from "express";
import { verifyToken } from "../../middleware/verifyToken.js";
import { defaultDB } from "../../server/db.js";
import { USER_NUMBERS_COLLECTION, CALL_FORWARDING_COLLECTION, VOICE_BINDINGS_COLLECTION } from "../../constants/index.js";
import { getTwilioClient } from "./shared.js";

const router = Router();

router.get("/available-numbers", verifyToken, async (req, res) => {
  const { type = "Local", areaCode, country = "US", limit = 20 } = req.query;

  try {
    const client = getTwilioClient();
    const numberType = type === "TollFree" ? "tollFree" : "local";
    const params = { limit: parseInt(limit) };
    if (numberType === "local" && areaCode) params.areaCode = areaCode;

    const [numbers, pricing] = await Promise.all([
      client.availablePhoneNumbers(country)[numberType].list(params),
      client.pricing.v1.phoneNumbers.countries(country).fetch().catch((err) => {
        console.error("[pricing] fetch error:", err?.message);
        return null;
      }),
    ]);

    let price = null;
    const phonePrices = pricing?.phoneNumberPrices;
    if (Array.isArray(phonePrices) && phonePrices.length) {
      const twilioType = type === "TollFree" ? "toll free" : "local";
      const priceEntry = phonePrices.find((p) => (p.number_type || "").toLowerCase() === twilioType);
      if (priceEntry) {
        price = {
          amount: priceEntry.current_price ?? priceEntry.base_price,
          currency: pricing.priceUnit ?? "USD",
        };
      }
    }

    return res.json({
      success: true,
      data: numbers.map((n) => ({
        phone_number: n.phoneNumber,
        friendly_name: n.friendlyName,
        region: n.region || "",
        locality: n.locality || "",
        iso_country: n.isoCountry,
        price,
      })),
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch available numbers." });
  }
});

router.get("/my-number", verifyToken, async (req, res) => {
  const { uuid } = req.user;
  try {
    const doc = await defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).get();
    if (doc.exists) {
      return res.json({ success: true, data: doc.data() });
    }
    return res.json({ success: true, data: null });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch phone number." });
  }
});

router.post("/purchase-number", verifyToken, async (req, res) => {
  const { TWILIO_APP_SID } = process.env;
  const { phoneNumber } = req.body;
  const { uuid, email } = req.user;

  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required." });
  }

  try {
    const client = getTwilioClient();
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
      voiceApplicationSid: TWILIO_APP_SID,
    });

    const numberData = {
      uuid,
      userEmail: email,
      phone_number: purchased.phoneNumber,
      friendly_name: purchased.friendlyName,
      sid: purchased.sid,
      region: purchased.region || "",
      locality: purchased.locality || "",
      purchasedAt: new Date().toISOString(),
    };

    const forwardingDefaults = {
      uuid,
      userEmail: email,
      enabled: false,
      forwardingNumber: "",
      forwardOnBusy: true,
      forwardOnNoAnswer: true,
      forwardOnUnreachable: false,
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      defaultDB.collection(USER_NUMBERS_COLLECTION).doc(uuid).set(numberData),
      defaultDB.collection(VOICE_BINDINGS_COLLECTION).doc(purchased.phoneNumber).set({
        phoneNumber: purchased.phoneNumber,
        identity: email,
        uuid,
        updatedAt: new Date().toISOString(),
      }),
      defaultDB.collection(CALL_FORWARDING_COLLECTION).doc(uuid).set(forwardingDefaults, { merge: true }),
    ]);

    return res.json({ success: true, data: numberData });
  } catch (err) {
    return res.status(500).json({ message: "Failed to purchase phone number." });
  }
});

export default router;

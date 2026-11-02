/**
 * UI strings in English and Hindi. Keys are grouped by screen. The `hi` object must
 * have exactly the same shape as `en` (enforced by the type below).
 */
export const en = {
  app: {
    name: "VyapaarFlow",
    tagline: "Order stock in a minute",
    signOut: "Sign out",
    language: "हिंदी",
    languageLabel: "Switch to Hindi",
    demoBanner: "Demo build — SMS, WhatsApp and Tally are simulated.",
  },
  login: {
    title: "Sign in",
    subtitle: "Use the mobile number registered with your distributor.",
    phoneLabel: "Mobile number",
    phonePlaceholder: "98XXX XXXXX",
    sendOtp: "Send OTP",
    sending: "Sending…",
    otpLabel: "6-digit OTP",
    otpSentTo: "We sent an OTP to",
    verify: "Verify and continue",
    verifying: "Checking…",
    changeNumber: "Change number",
    resend: "Resend OTP",
    resendIn: "Resend in {s}s",
    errors: {
      phoneInvalid: "Enter a valid 10-digit Indian mobile number.",
      otpInvalid: "That OTP is not correct. Check the SMS and try again.",
      otpExpired: "This OTP has expired. Ask for a new one.",
      tooManyAttempts: "Too many wrong attempts. Ask for a new OTP.",
      rateLimited: "Please wait {s} seconds before asking for another OTP.",
      roleNotEnabled: "This account type cannot sign in to this app yet.",
      generic: "Something went wrong. Please try again.",
    },
    demoTitle: "Demo accounts",
    demoHint: "OTP is shown on screen in demo mode — no real SMS is sent.",
    demoOtp: "Demo OTP (simulated SMS):",
    demoRetailer: "Retailer",
    demoDesk: "Order desk",
  },
  shop: {
    nav: { home: "Home" },
    welcome: "Namaste, {name}",
    creditTitle: "Credit",
    creditLimit: "Credit limit",
    outstanding: "Outstanding",
    available: "Available to order",
    comingNext: "Catalogue, cart and orders are being built in the next phase.",
  },
  desk: {
    nav: { overview: "Overview" },
    title: "Order desk",
    newMessages: "New messages",
    retailers: "Retailers",
    skus: "Active SKUs",
    outOfStock: "Out of stock",
    comingNext: "Order queue, AI capture review and Tally export are being built in the next phase.",
  },
  common: {
    exclGst: "excl. GST",
    inclGst: "incl. GST",
    loading: "Loading…",
    retry: "Try again",
    errorTitle: "Something went wrong",
    errorBody: "We could not load this page. Your data is safe.",
    notFoundTitle: "Page not found",
    notFoundBody: "The page you opened does not exist or has moved.",
    goHome: "Go to home",
  },
};

type DeepStringShape<T> = { [K in keyof T]: T[K] extends string ? string : DeepStringShape<T[K]> };
export type Messages = DeepStringShape<typeof en>;

export const hi: Messages = {
  app: {
    name: "VyapaarFlow",
    tagline: "एक मिनट में माल मँगाइए",
    signOut: "लॉग आउट",
    language: "English",
    languageLabel: "अंग्रेज़ी में देखें",
    demoBanner: "डेमो — SMS, WhatsApp और Tally नकली (सिम्युलेटेड) हैं।",
  },
  login: {
    title: "लॉग इन करें",
    subtitle: "अपने डिस्ट्रीब्यूटर के पास दर्ज मोबाइल नंबर डालें।",
    phoneLabel: "मोबाइल नंबर",
    phonePlaceholder: "98XXX XXXXX",
    sendOtp: "OTP भेजें",
    sending: "भेज रहे हैं…",
    otpLabel: "6 अंकों का OTP",
    otpSentTo: "OTP भेजा गया:",
    verify: "जाँचें और आगे बढ़ें",
    verifying: "जाँच रहे हैं…",
    changeNumber: "नंबर बदलें",
    resend: "OTP दोबारा भेजें",
    resendIn: "{s} सेकंड में दोबारा भेजें",
    errors: {
      phoneInvalid: "सही 10 अंकों का मोबाइल नंबर डालें।",
      otpInvalid: "OTP सही नहीं है। SMS देखकर फिर से डालें।",
      otpExpired: "OTP की समय सीमा खत्म हो गई। नया OTP मँगाएँ।",
      tooManyAttempts: "बहुत बार गलत OTP डाला गया। नया OTP मँगाएँ।",
      rateLimited: "नया OTP मँगाने से पहले {s} सेकंड रुकें।",
      roleNotEnabled: "यह खाता अभी इस ऐप में लॉग इन नहीं कर सकता।",
      generic: "कुछ गड़बड़ हुई। फिर से कोशिश करें।",
    },
    demoTitle: "डेमो खाते",
    demoHint: "डेमो में OTP स्क्रीन पर दिखता है — असली SMS नहीं जाता।",
    demoOtp: "डेमो OTP (नकली SMS):",
    demoRetailer: "दुकानदार",
    demoDesk: "ऑर्डर डेस्क",
  },
  shop: {
    nav: { home: "होम" },
    welcome: "नमस्ते, {name}",
    creditTitle: "उधार",
    creditLimit: "उधार सीमा",
    outstanding: "बकाया",
    available: "ऑर्डर के लिए उपलब्ध",
    comingNext: "कैटलॉग, कार्ट और ऑर्डर अगले चरण में बन रहे हैं।",
  },
  desk: {
    nav: { overview: "सारांश" },
    title: "ऑर्डर डेस्क",
    newMessages: "नए संदेश",
    retailers: "दुकानदार",
    skus: "चालू SKU",
    outOfStock: "स्टॉक खत्म",
    comingNext: "ऑर्डर कतार, AI कैप्चर जाँच और Tally एक्सपोर्ट अगले चरण में बन रहे हैं।",
  },
  common: {
    exclGst: "GST अलग",
    inclGst: "GST सहित",
    loading: "लोड हो रहा है…",
    retry: "फिर से कोशिश करें",
    errorTitle: "कुछ गड़बड़ हुई",
    errorBody: "यह पेज लोड नहीं हो सका। आपका डेटा सुरक्षित है।",
    notFoundTitle: "पेज नहीं मिला",
    notFoundBody: "यह पेज मौजूद नहीं है या हटा दिया गया है।",
    goHome: "होम पर जाएँ",
  },
};

export type Lang = "en" | "hi";
export const MESSAGES: Record<Lang, Messages> = { en, hi };

/** "Resend in {s}s" + { s: 12 } → "Resend in 12s" */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

import { describe, expect, it } from "vitest";
import { chromeIntentUrl, detectInAppBrowser, GENERIC_IN_APP_NAME } from "../inAppBrowser";

const UA = {
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/447.0.0.37.106;]",
  messengerAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.178 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/444.0.0.31.108;]",
  messengerIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/443.0.0.39.118;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.2;FBLC/vi_VN]",
  zaloAndroid:
    "Mozilla/5.0 (Linux; Android 12; Redmi Note 11 Build/SKQ1.211103.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 ZaloTheme/light ZaloLanguage/vn",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.24.106 (iPhone14,5; iOS 17_1; vi_VN; vi; scale=3.00; 1170x2532)",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
};

describe("detectInAppBrowser", () => {
  it("nhận ra trình duyệt nhúng của các app chat/mạng xã hội", () => {
    expect(detectInAppBrowser(UA.facebookAndroid)).toEqual({ inApp: true, name: "Facebook", platform: "android" });
    expect(detectInAppBrowser(UA.messengerAndroid)).toEqual({ inApp: true, name: "Messenger", platform: "android" });
    expect(detectInAppBrowser(UA.messengerIos)).toEqual({ inApp: true, name: "Messenger", platform: "ios" });
    expect(detectInAppBrowser(UA.zaloAndroid)).toEqual({ inApp: true, name: "Zalo", platform: "android" });
    expect(detectInAppBrowser(UA.instagramIos)).toEqual({ inApp: true, name: "Instagram", platform: "ios" });
  });

  it("nhận ra WebView nhúng cả khi UA không có tên app (vd. Messenger đổi UA)", () => {
    const androidWebView =
      "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.178 Mobile Safari/537.36";
    const iosWebView =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(detectInAppBrowser(androidWebView)).toEqual({ inApp: true, name: GENERIC_IN_APP_NAME, platform: "android" });
    expect(detectInAppBrowser(iosWebView)).toEqual({ inApp: true, name: GENERIC_IN_APP_NAME, platform: "ios" });
  });

  it("không coi Chrome/Safari thật là trình duyệt nhúng (giữ tải thẳng)", () => {
    const chromeIos =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/121.0.6167.138 Mobile/15E148 Safari/604.1";
    expect(detectInAppBrowser(chromeIos)).toEqual({ inApp: false, name: null, platform: "ios" });
    expect(detectInAppBrowser(UA.chromeAndroid)).toEqual({ inApp: false, name: null, platform: "android" });
    expect(detectInAppBrowser(UA.safariIphone)).toEqual({ inApp: false, name: null, platform: "ios" });
    expect(detectInAppBrowser(UA.chromeDesktop)).toEqual({ inApp: false, name: null, platform: "other" });
    expect(detectInAppBrowser("")).toEqual({ inApp: false, name: null, platform: "other" });
  });
});

describe("chromeIntentUrl", () => {
  it("mở đúng trang hiện tại bằng Chrome, có link dự phòng", () => {
    expect(chromeIntentUrl("https://template-studenzettell.vercel.app/?tab=pdf")).toBe(
      "intent://template-studenzettell.vercel.app/?tab=pdf#Intent;scheme=https;package=com.android.chrome;" +
        "S.browser_fallback_url=https%3A%2F%2Ftemplate-studenzettell.vercel.app%2F%3Ftab%3Dpdf;end",
    );
  });

  it("trả null với link không phải http(s)", () => {
    expect(chromeIntentUrl("not a url")).toBeNull();
    expect(chromeIntentUrl("file:///C:/app/index.html")).toBeNull();
  });
});

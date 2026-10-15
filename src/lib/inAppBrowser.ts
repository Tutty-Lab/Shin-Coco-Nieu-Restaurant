// ============================================================================
// Trình duyệt nhúng trong app (Messenger, Facebook, Zalo, Instagram …).
//
// Link app thường được gửi qua Zalo/Messenger. Mở từ đó là WebView của app chat:
// nó KHÔNG lưu được file tải qua blob-URL – bấm "Xuất PDF" chỉ mở sang một màn
// hình PDF không có nút lưu. Vì vậy phải nhận ra WebView này để đổi cách giao
// file (bảng Chia sẻ của hệ thống) hoặc hướng dẫn mở bằng trình duyệt thật.
// ============================================================================

export type InAppBrowserInfo = {
  inApp: boolean;
  /** Tên app để hiện cho người dùng, ví dụ "Zalo". */
  name: string | null;
  platform: "android" | "ios" | "other";
};

// Messenger trước Facebook: UA của Messenger cũng chứa FBAV.
const IN_APP_BROWSERS: readonly [RegExp, string][] = [
  [/FBAN\/Messenger|Orca-Android|MessengerForiOS|FB_IAB\/MESSENGER/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/Zalo/i, "Zalo"],
  [/\bLine\//i, "LINE"],
  [/MicroMessenger/i, "WeChat"],
  [/TikTok|musical_ly|BytedanceWebview/i, "TikTok"],
];

/** Tên hiển thị khi biết là WebView nhúng nhưng không biết của app nào. */
export const GENERIC_IN_APP_NAME = "trình duyệt của app";

export function detectInAppBrowser(userAgent: string): InAppBrowserInfo {
  const platform = /Android/i.test(userAgent)
    ? "android"
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? "ios"
      : "other";
  const hit = IN_APP_BROWSERS.find(([pattern]) => pattern.test(userAgent));
  if (hit) return { inApp: true, name: hit[1], platform };
  // Không có tên app trong UA (vd. Messenger đổi UA) – vẫn nhận ra WebView:
  // Android WebView có "; wv)", WKWebView trên iOS thiếu "Safari/" (Safari,
  // Chrome/Firefox iOS và SFSafariViewController đều có). Nhận nhầm thì không
  // sao: người dùng chỉ bấm thêm một nút Lưu / Chia sẻ, còn bỏ sót thì trình
  // duyệt mở file PDF ra thành một màn hình toàn ký tự lạ.
  const genericWebView =
    (platform === "android" && /;\s*wv\)/.test(userAgent)) ||
    (platform === "ios" && !/Safari\//.test(userAgent));
  return { inApp: genericWebView, name: genericWebView ? GENERIC_IN_APP_NAME : null, platform };
}

/**
 * Android: intent-URL mở ĐÚNG trang hiện tại bằng Chrome. Không có Chrome thì
 * hệ thống dùng browser_fallback_url. iOS không có cách tương đương – ở đó chỉ
 * hướng dẫn "⋯ → Mở trong Safari".
 */
export function chromeIntentUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const scheme = url.protocol.slice(0, -1);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

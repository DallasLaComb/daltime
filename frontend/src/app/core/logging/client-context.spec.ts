import {
  detectBrowser,
  detectDeviceType,
  detectOs,
  detectPlatform,
  getBreakpoint,
  getOrientation,
  getViewport,
} from './client-context';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadOs13Plus:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  capacitorWebViewNoUaMarker: 'DalTimeMysteryWebView/1.0',
};

function stubUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

describe('client-context (web platform, Capacitor.getPlatform() === "web")', () => {
  const originalUa = navigator.userAgent;
  afterEach(() => stubUserAgent(originalUa));

  it('detectPlatform is web outside a native shell', () => {
    expect(detectPlatform()).toBe('web');
  });

  describe('detectDeviceType', () => {
    it('iPhone → mobile', () => {
      stubUserAgent(UA.iphoneSafari);
      expect(detectDeviceType()).toBe('mobile');
    });
    it('Android phone → mobile', () => {
      stubUserAgent(UA.androidPhone);
      expect(detectDeviceType()).toBe('mobile');
    });
    it('iPad → tablet', () => {
      stubUserAgent(UA.ipadSafari);
      expect(detectDeviceType()).toBe('tablet');
    });
    it('Android tablet (no Mobile token) → tablet', () => {
      stubUserAgent(UA.androidTablet);
      expect(detectDeviceType()).toBe('tablet');
    });
    it('Windows Chrome → desktop', () => {
      stubUserAgent(UA.windowsChrome);
      expect(detectDeviceType()).toBe('desktop');
    });
    it('iPadOS 13+ (Macintosh UA) with touch points → tablet', () => {
      expect(detectDeviceType(UA.ipadOs13Plus, 1, { w: 1024, h: 1366 })).toBe('tablet');
    });
    it('a real Mac (Macintosh UA, no touch points) → desktop', () => {
      expect(detectDeviceType(UA.macSafari, 0, { w: 1512, h: 982 })).toBe('desktop');
    });
    it('no recognisable OS token, touch + large screen → tablet', () => {
      expect(detectDeviceType(UA.capacitorWebViewNoUaMarker, 1, { w: 800, h: 1280 })).toBe('tablet');
    });
    it('no recognisable OS token, touch + small screen → mobile', () => {
      expect(detectDeviceType(UA.capacitorWebViewNoUaMarker, 1, { w: 390, h: 844 })).toBe('mobile');
    });
    it('no recognisable OS token, no touch → desktop', () => {
      expect(detectDeviceType(UA.capacitorWebViewNoUaMarker, 0, { w: 1920, h: 1080 })).toBe('desktop');
    });
  });

  describe('detectOs', () => {
    it('iPhone → ios', () => {
      stubUserAgent(UA.iphoneSafari);
      expect(detectOs()).toBe('ios');
    });
    it('Android → android', () => {
      stubUserAgent(UA.androidPhone);
      expect(detectOs()).toBe('android');
    });
    it('Windows → windows', () => {
      stubUserAgent(UA.windowsChrome);
      expect(detectOs()).toBe('windows');
    });
    it('macOS → macos', () => {
      stubUserAgent(UA.macSafari);
      expect(detectOs()).toBe('macos');
    });
    it('Linux → linux', () => {
      stubUserAgent(UA.linuxFirefox);
      expect(detectOs()).toBe('linux');
    });
    it('unrecognised UA → other', () => {
      stubUserAgent('DalTimeBot/1.0');
      expect(detectOs()).toBe('other');
    });
  });

  describe('detectBrowser', () => {
    it('Edge identified before Chrome', () => {
      stubUserAgent(UA.windowsEdge);
      expect(detectBrowser()).toBe('edge');
    });
    it('Chrome on Windows', () => {
      stubUserAgent(UA.windowsChrome);
      expect(detectBrowser()).toBe('chrome');
    });
    it('Firefox on Linux', () => {
      stubUserAgent(UA.linuxFirefox);
      expect(detectBrowser()).toBe('firefox');
    });
    it('Safari on macOS', () => {
      stubUserAgent(UA.macSafari);
      expect(detectBrowser()).toBe('safari');
    });
    it('unknown UA → other', () => {
      stubUserAgent('DalTimeBot/1.0');
      expect(detectBrowser()).toBe('other');
    });
  });

  describe('getBreakpoint (mirrors tailwind.config.js default screens)', () => {
    it.each([
      [0, 'base'],
      [639, 'base'],
      [640, 'sm'],
      [767, 'sm'],
      [768, 'md'],
      [1023, 'md'],
      [1024, 'lg'],
      [1279, 'lg'],
      [1280, 'xl'],
      [1535, 'xl'],
      [1536, '2xl'],
      [3000, '2xl'],
    ] as const)('%ipx → %s', (width, expected) => {
      expect(getBreakpoint(width)).toBe(expected);
    });
  });

  describe('getOrientation', () => {
    it('wider than tall → landscape', () => {
      expect(getOrientation(1024, 768)).toBe('landscape');
    });
    it('taller than wide → portrait', () => {
      expect(getOrientation(390, 844)).toBe('portrait');
    });
    it('square → landscape (width >= height)', () => {
      expect(getOrientation(500, 500)).toBe('landscape');
    });
  });

  describe('getViewport', () => {
    it('reads window.innerWidth/innerHeight', () => {
      const original = { w: window.innerWidth, h: window.innerHeight };
      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });

      expect(getViewport()).toEqual({ w: 1280, h: 720 });

      Object.defineProperty(window, 'innerWidth', { value: original.w, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: original.h, configurable: true });
    });
  });
});

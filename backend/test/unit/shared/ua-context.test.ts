import { describe, it, expect } from 'vitest';
import { parseUaContext } from '../../../src/functions/shared/ua-context.js';

// Real UA strings sampled from common devices/browsers
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadOs13Plus: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  capacitorIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  capacitorAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
};

describe('parseUaContext — device_type', () => {
  it('iPhone → mobile', () => expect(parseUaContext(UA.iphoneSafari).device_type).toBe('mobile'));
  it('Android phone → mobile', () => expect(parseUaContext(UA.androidPhone).device_type).toBe('mobile'));
  it('iPad → tablet', () => expect(parseUaContext(UA.ipadSafari).device_type).toBe('tablet'));
  it('Android tablet (no Mobile token) → tablet', () => expect(parseUaContext(UA.androidTablet).device_type).toBe('tablet'));
  it('Windows Chrome → desktop', () => expect(parseUaContext(UA.windowsChrome).device_type).toBe('desktop'));
  it('macOS Safari → desktop', () => expect(parseUaContext(UA.macSafari).device_type).toBe('desktop'));
  it('iPadOS 13+ (Macintosh UA) without header → desktop', () => expect(parseUaContext(UA.ipadOs13Plus).device_type).toBe('desktop'));
  it('iPadOS 13+ with X-Platform: ios → tablet', () => expect(parseUaContext(UA.ipadOs13Plus, 'ios').device_type).toBe('tablet'));
});

describe('parseUaContext — os', () => {
  it('iPhone → ios', () => expect(parseUaContext(UA.iphoneSafari).os).toBe('ios'));
  it('iPad → ios', () => expect(parseUaContext(UA.ipadSafari).os).toBe('ios'));
  it('iPadOS 13+ Macintosh UA + X-Platform: ios → ios (corrected)', () => expect(parseUaContext(UA.ipadOs13Plus, 'ios').os).toBe('ios'));
  it('Android phone → android', () => expect(parseUaContext(UA.androidPhone).os).toBe('android'));
  it('Windows → windows', () => expect(parseUaContext(UA.windowsChrome).os).toBe('windows'));
  it('macOS Safari → macos', () => expect(parseUaContext(UA.macSafari).os).toBe('macos'));
  it('Linux Firefox → linux', () => expect(parseUaContext(UA.linuxFirefox).os).toBe('linux'));
});

describe('parseUaContext — platform', () => {
  it('X-Platform: ios overrides UA', () => expect(parseUaContext(UA.windowsChrome, 'ios').platform).toBe('ios'));
  it('X-Platform: android overrides UA', () => expect(parseUaContext(UA.windowsChrome, 'android').platform).toBe('android'));
  it('X-Platform: web → web', () => expect(parseUaContext(UA.iphoneSafari, 'web').platform).toBe('web'));
  it('iPhone UA without header → ios', () => expect(parseUaContext(UA.iphoneSafari).platform).toBe('ios'));
  it('Android UA without header → android', () => expect(parseUaContext(UA.androidPhone).platform).toBe('android'));
  it('Desktop UA without header → web', () => expect(parseUaContext(UA.windowsChrome).platform).toBe('web'));
  it('Capacitor iOS (X-Platform: ios) → ios', () => expect(parseUaContext(UA.capacitorIos, 'ios').platform).toBe('ios'));
  it('Capacitor Android (X-Platform: android) → android', () => expect(parseUaContext(UA.capacitorAndroid, 'android').platform).toBe('android'));
});

describe('parseUaContext — browser', () => {
  it('Edge identified before Chrome', () => expect(parseUaContext(UA.windowsEdge).browser).toBe('edge'));
  it('Chrome on Windows', () => expect(parseUaContext(UA.windowsChrome).browser).toBe('chrome'));
  it('Chrome on Mac', () => expect(parseUaContext(UA.macChrome).browser).toBe('chrome'));
  it('Firefox on Linux', () => expect(parseUaContext(UA.linuxFirefox).browser).toBe('firefox'));
  it('Safari on macOS', () => expect(parseUaContext(UA.macSafari).browser).toBe('safari'));
  it('Safari on iPhone', () => expect(parseUaContext(UA.iphoneSafari).browser).toBe('safari'));
  it('unknown UA → other', () => expect(parseUaContext('DalTimeBot/1.0').browser).toBe('other'));
});

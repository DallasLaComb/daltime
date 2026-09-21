import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth';
import { Navbar } from './shared/navbar/navbar';
import { Footer } from './shared/footer/footer';
import { IS_NATIVE_PLATFORM } from './core/storage/token-storage';

// Web keeps a small gutter around the page. The native app is edge-to-edge: no gutter, only the
// notch/landscape insets so content is never hidden behind system UI.
const WEB_HOST_CLASS =
  'flex flex-col min-h-screen pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0px,calc(0.5rem_-_env(safe-area-inset-top)))] md:pl-[max(0.75rem,env(safe-area-inset-left))] md:pr-[max(0.75rem,env(safe-area-inset-right))] md:pt-[max(0px,calc(0.75rem_-_env(safe-area-inset-top)))]';
const NATIVE_HOST_CLASS = 'flex flex-col min-h-screen pl-safe-left pr-safe-right';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Navbar, Footer],
  templateUrl: './app.html',
  host: { '[class]': 'hostClass' },
})
export class App implements OnInit {
  protected readonly authService = inject(AuthService);
  protected readonly hostClass = inject(IS_NATIVE_PLATFORM) ? NATIVE_HOST_CLASS : WEB_HOST_CLASS;

  ngOnInit(): void {
    this.authService.initialize();
  }
}

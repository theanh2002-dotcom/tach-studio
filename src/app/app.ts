import { Component, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Header } from './layout/header/header';
import { Footer } from './layout/footer/footer';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('Tách Tách Photobooth');
  protected showHeader = signal(true);
  protected showFooter = signal(true);

  constructor(private router: Router) {
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe((e: any) => {
      const isGalleryPage = e.url.startsWith('/event/') || e.url.startsWith('/gallery/');
      
      // Trang gallery sự kiện: Hiện Header, Ẩn Footer để tối ưu giao diện xem ảnh toàn màn hình trên mobile
      this.showHeader.set(true);
      this.showFooter.set(!isGalleryPage);
    });
  }
}

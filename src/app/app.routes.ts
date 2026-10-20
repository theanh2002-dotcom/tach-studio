import { Routes } from '@angular/router';
import { Home } from './features/home/home';
import { StudioShowcase } from './features/studio-showcase/studio-showcase';
import { PrintOrder } from './features/print-order/print-order';
import { Booking } from './features/booking/booking';
import { EventGallery } from './features/event-gallery/event-gallery';
import { Admin } from './features/admin/admin';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'phong-chup', component: StudioShowcase },
  { path: 'in-anh', component: PrintOrder },
  { path: 'portfolio', component: PrintOrder }, // Alias cho khách quen
  { path: 'dat-lich', component: Booking },
  { path: 'contact', component: Booking }, // Alias
  { path: 'event/:id', component: EventGallery },
  { path: 'gallery/:id', component: EventGallery },
  { path: 'admin', component: Admin },
  { path: '**', redirectTo: '' }
];

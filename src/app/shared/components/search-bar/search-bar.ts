import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search-bar',
  imports: [FormsModule],
  templateUrl: './search-bar.html',
  styleUrl: './search-bar.scss',
})
export class SearchBar {
  eventId: string = '';
  
  constructor(private router: Router) {}

  search() {
    if (this.eventId.trim()) {
      this.router.navigate(['/event', this.eventId.trim()]);
    }
  }
}

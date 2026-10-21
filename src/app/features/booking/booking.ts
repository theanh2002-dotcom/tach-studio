import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';

@Component({
  selector: 'app-booking',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './booking.html',
  styleUrl: './booking.scss'
})
export class Booking implements OnInit {
  private route = inject(ActivatedRoute);

  name = '';
  phone = '';
  bookingDate = '';
  timeSlot = '14:30 - 15:00';
  selectedPackage = 'Gói Solo & Couple (80.000đ)';
  selectedBackdrop = 'Kem Ấm Vintage (Signature Tách Tách)';
  peopleCount = '2 người';
  note = '';

  isSubmitting = false;
  isSuccess = false;
  errorMessage = '';

  packages = [
    { name: 'Gói Solo & Couple (80.000đ)', desc: '1-2 người, phiên chụp, in 2 dải ảnh Photostrip 1x4' },
    { name: 'Gói Nhóm Bạn Thân (100.000đ)', desc: '3-4 người, phiên chụp, in 4 dải ảnh Photostrip cao cấp' }
  ];

  backdrops = [
    'Kem Ấm Vintage (Signature Tách Tách)',
    'Xám Xi Măng Hàn Quốc (Seoul Minimalist)',
    'Hồng Barbie Pastel',
    'Xanh Mint Dịu Mát',
    'Đen Trắng Nghệ Thuật'
  ];

  timeSlots = [
    '08:00 - 08:30', '08:30 - 09:00', '09:00 - 09:30', '09:30 - 10:00',
    '10:00 - 10:30', '10:30 - 11:00', '11:00 - 11:30',
    '13:30 - 14:00', '14:00 - 14:30', '14:30 - 15:00', '15:00 - 15:30',
    '15:30 - 16:00', '16:00 - 16:30', '16:30 - 17:00', '17:00 - 17:30',
    '18:00 - 18:30', '18:30 - 19:00', '19:00 - 19:30', '19:30 - 20:00',
    '20:00 - 20:30', '20:30 - 21:00', '21:00 - 21:30'
  ];

  ngOnInit() {
    // Set default date to today in YYYY-MM-DD
    const today = new Date();
    this.bookingDate = today.toISOString().split('T')[0];

    this.route.queryParams.subscribe(params => {
      if (params['package']) {
        const found = this.packages.find(p => p.name.includes(params['package']));
        if (found) this.selectedPackage = found.name;
      }
    });
  }

  async submitBooking() {
    if (!this.name.trim()) {
      this.errorMessage = 'Vui lòng nhập họ tên của bạn.';
      return;
    }
    if (!this.phone.trim()) {
      this.errorMessage = 'Vui lòng nhập số điện thoại để Tách Tách liên hệ xác nhận.';
      return;
    }
    const phoneRegex = /^0\d{9}$/;
    if (!phoneRegex.test(this.phone.trim())) {
      this.errorMessage = 'Số điện thoại không hợp lệ (phải bắt đầu bằng số 0 và có đúng 10 chữ số).';
      return;
    }
    if (!this.bookingDate) {
      this.errorMessage = 'Vui lòng chọn ngày chụp.';
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      const response = await fetch('/api/submit-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.name,
          phone: this.phone,
          service: this.selectedPackage,
          date: this.bookingDate,
          timeSlot: this.timeSlot,
          backdrop: this.selectedBackdrop,
          peopleCount: this.peopleCount,
          note: this.note
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Không thể gửi yêu cầu đặt lịch lúc này. Vui lòng thử lại sau.');
      }

      this.isSuccess = true;
    } catch (err: any) {
      this.errorMessage = err.message || 'Đã có lỗi xảy ra. Vui lòng liên hệ hotline 0812955909.';
    } finally {
      this.isSubmitting = false;
    }
  }

  resetBooking() {
    this.isSuccess = false;
    this.name = '';
    this.phone = '';
    this.note = '';
  }
}

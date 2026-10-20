import { Component, OnInit, OnDestroy, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

export interface BoothMachine {
  id: string;
  store_id: string;
  store_name?: string;
  name: string;
  status: 'IDLE' | 'IN_SESSION' | 'PRINTING' | 'OFFLINE' | 'ERROR';
  paper_remaining: number;
  paper_total_capacity: number;
  printer_status: string;
  camera_status: string;
  camera_model?: string;
  disk_free_gb: number;
  app_version?: string;
  last_heartbeat_at: string;
}

export interface BoothTransaction {
  id: string;
  machine_id: string;
  machine_name?: string;
  store_name?: string;
  session_code?: string;
  package_name: string;
  total_amount: number;
  print_copies: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
}

export interface DashboardOverview {
  today_sessions: number;
  today_revenue: number;
  today_prints: number;
  qr_revenue: number;
  cash_revenue: number;
}

@Component({
  selector: 'app-admin',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './admin.html',
  styleUrl: './admin.scss'
})
export class Admin implements OnInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);

  adminSecret = signal<string>('');
  isAuthenticated = signal<boolean>(false);
  activeTab = signal<'monitoring' | 'revenue' | 'settings'>('monitoring');
  isLoading = signal<boolean>(false);
  errorMessage = signal<string>('');
  successMessage = signal<string>('');
  resettingMachineId = signal<string | null>(null);

  // Data Signals
  overview = signal<DashboardOverview>({
    today_sessions: 28,
    today_revenue: 4250000,
    today_prints: 86,
    qr_revenue: 3180000,
    cash_revenue: 1070000
  });

  machines = signal<BoothMachine[]>([
    {
      id: 'BOOTH_GP_01',
      store_id: 'store_gp_01',
      store_name: 'Tách Tách Giải Phóng',
      name: 'Phòng Kem Vintage 01',
      status: 'IDLE',
      paper_remaining: 520,
      paper_total_capacity: 700,
      printer_status: 'READY',
      camera_status: 'CONNECTED',
      camera_model: 'Canon EOS 200D II',
      disk_free_gb: 142.5,
      app_version: '1.0.4',
      last_heartbeat_at: new Date(Date.now() - 60000).toISOString()
    },
    {
      id: 'BOOTH_GP_02',
      store_id: 'store_gp_01',
      store_name: 'Tách Tách Giải Phóng',
      name: 'Phòng Xám Seoul 02',
      status: 'IN_SESSION',
      paper_remaining: 18,
      paper_total_capacity: 700,
      printer_status: 'READY',
      camera_status: 'CONNECTED',
      camera_model: 'Canon EOS 200D II',
      disk_free_gb: 98.2,
      app_version: '1.0.4',
      last_heartbeat_at: new Date(Date.now() - 30000).toISOString()
    }
  ]);

  transactions = signal<BoothTransaction[]>([
    {
      id: 'tx_01',
      machine_id: 'BOOTH_GP_02',
      machine_name: 'Phòng Xám Seoul 02',
      store_name: 'Tách Tách Giải Phóng',
      session_code: '#ses_89ab12',
      package_name: 'Gói Nhóm Bạn Thân (149k)',
      total_amount: 149000,
      print_copies: 4,
      payment_method: 'VIETQR_SEPAY',
      payment_status: 'PAID',
      created_at: new Date(Date.now() - 15 * 60000).toISOString()
    },
    {
      id: 'tx_02',
      machine_id: 'BOOTH_GP_01',
      machine_name: 'Phòng Kem Vintage 01',
      session_code: '#ses_77cd34',
      package_name: 'Gói Basic — Solo & Couple (99k)',
      total_amount: 99000,
      print_copies: 2,
      payment_method: 'CASH',
      payment_status: 'PAID',
      created_at: new Date(Date.now() - 45 * 60000).toISOString()
    },
    {
      id: 'tx_03',
      machine_id: 'ONLINE_ORDER',
      machine_name: 'Web In Ảnh Online',
      store_name: 'Tách Tách Studio',
      session_code: '#order_55ef12',
      package_name: 'Đẩy Ảnh In Theo Yêu Cầu (6 ảnh)',
      total_amount: 90000,
      print_copies: 6,
      payment_method: 'VIETQR_SEPAY',
      payment_status: 'PAID',
      created_at: new Date(Date.now() - 75 * 60000).toISOString()
    }
  ]);

  private refreshIntervalId: any = null;
  private readonly defaultWorkerUrl = 'https://tanhbooth-api.laihoanganh456.workers.dev';

  ngOnInit() {
    const savedToken = localStorage.getItem('tach_admin_secret');
    if (savedToken) {
      this.adminSecret.set(savedToken);
      this.isAuthenticated.set(true);
      this.fetchCloudflareDashboard();
    }

    // Auto-refresh every 30s when tab is active
    this.refreshIntervalId = setInterval(() => {
      if (this.isAuthenticated() && !document.hidden) {
        this.fetchCloudflareDashboard(true);
      }
    }, 30000);
  }

  ngOnDestroy() {
    if (this.refreshIntervalId) clearInterval(this.refreshIntervalId);
  }

  login() {
    const secret = this.adminSecret().trim();
    if (!secret) {
      this.errorMessage.set('Vui lòng nhập mã bảo mật Admin Secret.');
      return;
    }
    localStorage.setItem('tach_admin_secret', secret);
    this.isAuthenticated.set(true);
    this.errorMessage.set('');
    this.fetchCloudflareDashboard();
  }

  logout() {
    localStorage.removeItem('tach_admin_secret');
    this.isAuthenticated.set(false);
    this.adminSecret.set('');
  }

  async fetchCloudflareDashboard(silent: boolean = false) {
    if (!silent) this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/dashboard`, {
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok) {
          if (data.overview) this.overview.set(data.overview);
          if (Array.isArray(data.machines) && data.machines.length > 0) {
            this.machines.set(data.machines);
          }
          if (Array.isArray(data.recentTransactions) && data.recentTransactions.length > 0) {
            this.transactions.set(data.recentTransactions);
          }
        }
      } else if (!silent) {
        // If unauthorized or network error, fallback to preview demo mode
        console.warn('Could not connect to live Cloudflare Worker, showing local preview state.');
      }
    } catch (e: any) {
      if (!silent) {
        console.warn('Cloudflare fetch exception:', e?.message || e);
      }
    } finally {
      if (!silent) this.isLoading.set(false);
      this.cdr.markForCheck();
    }
  }

  async resetPaper(machineId: string) {
    if (!confirm(`Xác nhận bạn đã thay cuộn giấy DNP mới và muốn reset bộ đếm máy ${machineId} về 700 ảnh?`)) {
      return;
    }

    this.resettingMachineId.set(machineId);
    this.errorMessage.set('');

    try {
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/machines/${encodeURIComponent(machineId)}/reset-paper`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`
        }
      });

      if (response.ok) {
        this.successMessage.set(`Đã reset thành công cuộn giấy máy ${machineId} về 700 ảnh!`);
        setTimeout(() => this.successMessage.set(''), 4000);
      }

      // Optimistic local update
      this.machines.update(list => list.map(m => m.id === machineId ? { ...m, paper_remaining: 700 } : m));
    } catch {
      // Optimistic fallback
      this.machines.update(list => list.map(m => m.id === machineId ? { ...m, paper_remaining: 700 } : m));
    } finally {
      this.resettingMachineId.set(null);
      this.cdr.markForCheck();
    }
  }

  getPaperPercentage(m: BoothMachine): number {
    const total = m.paper_total_capacity || 700;
    return Math.min(100, Math.round((m.paper_remaining / total) * 100));
  }

  getPaperColorClass(m: BoothMachine): string {
    if (m.paper_remaining <= 20) return 'bg-red-500';
    if (m.paper_remaining <= 100) return 'bg-amber-500';
    return 'bg-emerald-500';
  }

  getPaperTextColorClass(m: BoothMachine): string {
    if (m.paper_remaining <= 20) return 'text-red-600 font-bold';
    if (m.paper_remaining <= 100) return 'text-amber-600 font-bold';
    return 'text-emerald-700 font-semibold';
  }

  getStatusBadge(status: string): { text: string; bg: string; textCol: string; dot: string } {
    switch (status) {
      case 'IDLE':
        return { text: 'ĐANG RẢNH / CHỜ KHÁCH', bg: 'bg-emerald-50 border-emerald-200', textCol: 'text-emerald-800', dot: 'bg-emerald-500' };
      case 'IN_SESSION':
        return { text: 'ĐANG CÓ KHÁCH CHỤP', bg: 'bg-amber-50 border-amber-200', textCol: 'text-amber-800', dot: 'bg-amber-500 animate-pulse' };
      case 'PRINTING':
        return { text: 'ĐANG IN ẢNH...', bg: 'bg-purple-50 border-purple-200', textCol: 'text-purple-800', dot: 'bg-purple-500 animate-ping' };
      case 'ERROR':
        return { text: 'SỰ CỐ / KẸT GIẤY', bg: 'bg-red-50 border-red-200', textCol: 'text-red-800', dot: 'bg-red-500 animate-bounce' };
      default:
        return { text: 'MẤT MẠNG / OFFLINE', bg: 'bg-gray-100 border-gray-200', textCol: 'text-gray-600', dot: 'bg-gray-400' };
    }
  }

  formatTime(isoString: string): string {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    } catch {
      return isoString;
    }
  }

  formatVND(amount: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
  }
}

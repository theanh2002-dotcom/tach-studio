import { Component, OnInit, OnDestroy, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

export interface BoothMachine {
  id: string;
  license_id?: string;
  license_key_prefix?: string;
  license_expires_at?: string;
  license_plan?: string;
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

  adminSecret = signal<string>('theanh2002');
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

  // Modal State for Editing / Creating Machine
  isMachineModalOpen = signal<boolean>(false);
  isCreateMode = signal<boolean>(false);
  isSavingMachine = signal<boolean>(false);

  // System Settings State (Cloudflare D1 Dynamic Config)
  settingsForm = signal<{
    telegram_bot_token: string;
    telegram_chat_id: string;
    google_drive_root_folder_id: string;
    google_client_id: string;
    google_client_secret: string;
    google_refresh_token: string;
  }>({
    telegram_bot_token: '',
    telegram_chat_id: '',
    google_drive_root_folder_id: '',
    google_client_id: '',
    google_client_secret: '',
    google_refresh_token: ''
  });
  isLoadingSettings = signal<boolean>(false);
  isSavingSettings = signal<boolean>(false);
  isTestingTelegram = signal<boolean>(false);
  telegramTestResult = signal<{ ok: boolean; message: string } | null>(null);
  showAdvancedGoogleOauth = signal<boolean>(false);
  showTokens = signal<boolean>(false);
  editForm = signal<{
    id: string;
    license_id: string;
    store_id: string;
    name: string;
    paper_remaining: number;
    paper_total_capacity: number;
    camera_model: string;
    printer_status: string;
  }>({
    id: '',
    license_id: '',
    store_id: 'store_hp_01',
    name: '',
    paper_remaining: 700,
    paper_total_capacity: 700,
    camera_model: 'Canon EOS 200D II',
    printer_status: 'READY'
  });

  machines = signal<BoothMachine[]>([
    {
      id: 'BOOTH_HP_01',
      license_id: 'lic_tach_01',
      license_key_prefix: 'LUMI-89AB',
      license_plan: 'standard',
      license_expires_at: '2027-10-20',
      store_id: 'store_hp_01',
      store_name: 'Tách Tách Hải Phòng',
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
      id: 'BOOTH_HP_02',
      license_id: 'lic_tach_02',
      license_key_prefix: 'LUMI-CD45',
      license_plan: 'standard',
      license_expires_at: '2027-12-31',
      store_id: 'store_hp_01',
      store_name: 'Tách Tách Hải Phòng',
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
      machine_id: 'BOOTH_HP_02',
      machine_name: 'Phòng Xám Seoul 02',
      store_name: 'Tách Tách Hải Phòng',
      session_code: '#ses_89ab12',
      package_name: 'Gói Nhóm Bạn Thân (100k)',
      total_amount: 100000,
      print_copies: 4,
      payment_method: 'VIETQR_SEPAY',
      payment_status: 'PAID',
      created_at: new Date(Date.now() - 15 * 60000).toISOString()
    },
    {
      id: 'tx_02',
      machine_id: 'BOOTH_HP_01',
      machine_name: 'Phòng Kem Vintage 01',
      session_code: '#ses_77cd34',
      package_name: 'Gói Solo & Couple (80k)',
      total_amount: 80000,
      print_copies: 2,
      payment_method: 'CASH',
      payment_status: 'PAID',
      created_at: new Date(Date.now() - 45 * 60000).toISOString()
    },
    {
      id: 'tx_03',
      machine_id: 'ONLINE_ORDER',
      machine_name: 'Web In Ảnh Online',
      store_name: 'Tách Tách Photobooth',
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
      this.loadSettings();
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
    this.loadSettings();
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

  // Machine CRUD Modal Management
  openCreateMachineModal() {
    this.isCreateMode.set(true);
    const nextIndex = this.machines().length + 1;
    this.editForm.set({
      id: `BOOTH_HP_0${nextIndex}`,
      license_id: '',
      store_id: 'store_hp_01',
      name: `Phòng Chụp 0${nextIndex}`,
      paper_remaining: 700,
      paper_total_capacity: 700,
      camera_model: 'Canon EOS 200D II',
      printer_status: 'READY'
    });
    this.isMachineModalOpen.set(true);
  }

  openEditMachineModal(m: BoothMachine) {
    this.isCreateMode.set(false);
    this.editForm.set({
      id: m.id,
      license_id: m.license_id || '',
      store_id: m.store_id || 'store_hp_01',
      name: m.name,
      paper_remaining: m.paper_remaining,
      paper_total_capacity: m.paper_total_capacity || 700,
      camera_model: m.camera_model || 'Canon EOS 200D II',
      printer_status: m.printer_status || 'READY'
    });
    this.isMachineModalOpen.set(true);
  }

  closeMachineModal() {
    this.isMachineModalOpen.set(false);
  }

  async saveMachineModal() {
    const form = this.editForm();
    if (!form.id.trim() || !form.name.trim()) {
      alert('Vui lòng nhập đầy đủ Mã phòng và Tên phòng chụp!');
      return;
    }

    this.isSavingMachine.set(true);
    const isCreate = this.isCreateMode();
    const endpoint = isCreate
      ? `${this.defaultWorkerUrl}/v1/admin/machines`
      : `${this.defaultWorkerUrl}/v1/admin/machines/${encodeURIComponent(form.id)}`;
    const method = isCreate ? 'POST' : 'PUT';

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: form.id.trim(),
          licenseId: form.license_id.trim() || undefined,
          name: form.name.trim(),
          storeId: form.store_id.trim(),
          paperRemaining: Number(form.paper_remaining),
          paperTotalCapacity: Number(form.paper_total_capacity),
          cameraModel: form.camera_model.trim(),
          printerStatus: form.printer_status
        })
      });

      if (response.ok) {
        this.successMessage.set(isCreate ? 'Đã thêm phòng chụp mới thành công!' : 'Đã cập nhật thông tin phòng chụp thành công!');
        setTimeout(() => this.successMessage.set(''), 4000);
      }
    } catch (e) {
      console.warn('Backend sync failed, updated locally', e);
    } finally {
      // Local reactive update
      if (isCreate) {
        const newMachine: BoothMachine = {
          id: form.id.trim(),
          license_id: form.license_id.trim() || undefined,
          store_id: form.store_id.trim(),
          store_name: 'Tách Tách Studio',
          name: form.name.trim(),
          status: 'IDLE',
          paper_remaining: Number(form.paper_remaining),
          paper_total_capacity: Number(form.paper_total_capacity),
          printer_status: form.printer_status,
          camera_status: 'CONNECTED',
          camera_model: form.camera_model.trim(),
          disk_free_gb: 120,
          app_version: '1.0.4',
          last_heartbeat_at: new Date().toISOString()
        };
        this.machines.update(list => [...list, newMachine]);
      } else {
        this.machines.update(list => list.map(m => {
          if (m.id === form.id) {
            return {
              ...m,
              name: form.name.trim(),
              license_id: form.license_id.trim() || undefined,
              store_id: form.store_id.trim(),
              paper_remaining: Number(form.paper_remaining),
              paper_total_capacity: Number(form.paper_total_capacity),
              camera_model: form.camera_model.trim(),
              printer_status: form.printer_status
            };
          }
          return m;
        }));
      }

      this.isSavingMachine.set(false);
      this.isMachineModalOpen.set(false);
      this.cdr.markForCheck();
    }
  }

  async deleteMachine(machineId: string) {
    if (!confirm(`Bạn có chắc chắn muốn xóa buồng chụp ${machineId} khỏi hệ thống giám sát?`)) {
      return;
    }

    try {
      await fetch(`${this.defaultWorkerUrl}/v1/admin/machines/${encodeURIComponent(machineId)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`
        }
      });
      this.successMessage.set(`Đã xóa buồng chụp ${machineId}!`);
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch {
      // Fallback
    } finally {
      this.machines.update(list => list.filter(m => m.id !== machineId));
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

  // ==========================================
  // SETTINGS & TELEGRAM / GOOGLE DRIVE ACTIONS
  // ==========================================
  switchTab(tab: 'monitoring' | 'revenue' | 'settings') {
    this.activeTab.set(tab);
    if (tab === 'settings') {
      this.loadSettings();
    }
  }

  toggleShowTokens() {
    this.showTokens.update(v => !v);
  }

  toggleAdvancedGoogleOauth() {
    this.showAdvancedGoogleOauth.update(v => !v);
  }

  async loadSettings() {
    this.isLoadingSettings.set(true);
    this.errorMessage.set('');
    try {
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/settings`, {
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Accept': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.settings) {
          this.settingsForm.set({
            telegram_bot_token: data.settings.TELEGRAM_BOT_TOKEN || '',
            telegram_chat_id: data.settings.TELEGRAM_CHAT_ID || '',
            google_drive_root_folder_id: data.settings.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
            google_client_id: data.settings.GOOGLE_CLIENT_ID || '',
            google_client_secret: data.settings.GOOGLE_CLIENT_SECRET || '',
            google_refresh_token: data.settings.GOOGLE_REFRESH_TOKEN || ''
          });
        }
      }
    } catch (err: any) {
      console.warn('Failed to load settings from Cloudflare Worker:', err?.message || err);
    } finally {
      this.isLoadingSettings.set(false);
      this.cdr.markForCheck();
    }
  }

  async saveSettings() {
    this.isSavingSettings.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    try {
      const form = this.settingsForm();
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/settings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          settings: {
            TELEGRAM_BOT_TOKEN: form.telegram_bot_token.trim(),
            TELEGRAM_CHAT_ID: form.telegram_chat_id.trim(),
            GOOGLE_DRIVE_ROOT_FOLDER_ID: form.google_drive_root_folder_id.trim(),
            GOOGLE_CLIENT_ID: form.google_client_id.trim(),
            GOOGLE_CLIENT_SECRET: form.google_client_secret.trim(),
            GOOGLE_REFRESH_TOKEN: form.google_refresh_token.trim(),
          }
        })
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        this.successMessage.set('Đã lưu thành công cấu hình vào Cloudflare D1!');
        setTimeout(() => this.successMessage.set(''), 4000);
      } else {
        this.errorMessage.set(data.message || 'Không thể lưu cấu hình.');
      }
    } catch (err: any) {
      this.errorMessage.set('Lỗi kết nối khi lưu cấu hình: ' + (err?.message || err));
    } finally {
      this.isSavingSettings.set(false);
      this.cdr.markForCheck();
    }
  }

  async testTelegram() {
    this.isTestingTelegram.set(true);
    this.telegramTestResult.set(null);
    try {
      const form = this.settingsForm();
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/test-telegram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          botToken: form.telegram_bot_token.trim(),
          chatId: form.telegram_chat_id.trim()
        })
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        this.telegramTestResult.set({
          ok: true,
          message: `✓ Gửi tin nhắn test thành công tới Chat ID: ${data.chatId || form.telegram_chat_id}!`
        });
      } else {
        this.telegramTestResult.set({
          ok: false,
          message: data.message || 'Telegram từ chối gửi tin nhắn. Hãy kiểm tra lại Bot Token hoặc Chat ID!'
        });
      }
    } catch (err: any) {
      this.telegramTestResult.set({
        ok: false,
        message: 'Lỗi mạng khi kiểm tra Telegram: ' + (err?.message || err)
      });
    } finally {
      this.isTestingTelegram.set(false);
      this.cdr.markForCheck();
    }
  }

  openGoogleDriveFolder() {
    const folderId = this.settingsForm().google_drive_root_folder_id.trim();
    if (!folderId) {
      alert('Chưa có Google Drive Folder ID! Vui lòng nhập Folder ID trước.');
      return;
    }
    window.open(`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`, '_blank');
  }
}

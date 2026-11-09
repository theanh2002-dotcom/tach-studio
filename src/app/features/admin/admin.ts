import { Component, OnInit, OnDestroy, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import JSZip from 'jszip';

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
  session_public_id?: string;
  package_name: string;
  original_amount?: number;
  discount_amount?: number;
  voucher_code?: string;
  total_amount: number;
  print_copies: number;
  payment_method: string;
  payment_status: string;
  event_public_id?: string;
  event_name?: string;
  paid_at?: string;
  created_at: string;
}

export interface DashboardOverview {
  today_sessions: number;
  today_revenue: number;
  today_prints: number;
  qr_revenue: number;
  cash_revenue: number;
  discount_revenue?: number;
  original_revenue?: number;
}

export interface MarketingPhoto {
  id: string;
  session_public_id: string;
  session_code: string;
  store_id: string;
  machine_id: string;
  machine_name?: string;
  event_public_id?: string;
  event_name?: string;
  guest_name?: string;
  guest_phone?: string;
  photo_usage_consent: number;
  consent_at: string;
  is_featured: number;
  created_at: string;
  final_drive_file_id?: string;
  signed_final_url?: string;
  signed_thumb_url?: string;
  signed_guest_share_url?: string;
}

export interface BoothEvent {
  id: string;
  public_id: string;
  store_id: string;
  machine_id?: string;
  machine_name?: string;
  name: string;
  date: string;
  drive_folder_id: string;
  gallery_url?: string;
  total_sessions: number;
  consented_sessions: number;
  is_active: number;
  created_at: string;
}

export interface EventSessionFile {
  id: string;
  name: string;
  signedUrl: string;
  signedThumbUrl?: string;
}

export interface EventSession {
  id: string;
  session_public_id: string;
  session_code: string;
  guest_name?: string;
  photo_usage_consent: number;
  created_at: string;
  drive_session_folder_id?: string;
  finalPhoto: EventSessionFile | null;
  shots: EventSessionFile[];
  btsVideo: EventSessionFile | null;
  guestShareUrl: string;
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
  activeTab = signal<'monitoring' | 'revenue' | 'marketing' | 'events' | 'settings'>('monitoring');
  isLoading = signal<boolean>(false);
  errorMessage = signal<string>('');
  successMessage = signal<string>('');
  resettingMachineId = signal<string | null>(null);

  // Data Signals (Clean initialization with no mock data)
  overview = signal<DashboardOverview>({
    today_sessions: 0,
    today_revenue: 0,
    today_prints: 0,
    qr_revenue: 0,
    cash_revenue: 0,
    discount_revenue: 0,
    original_revenue: 0
  });

  // Revenue Filters
  selectedRange = signal<'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom'>('today');
  customFrom = signal<string>('');
  customTo = signal<string>('');
  selectedMachineId = signal<string>('');

  // Marketing Gallery State
  marketingPhotos = signal<MarketingPhoto[]>([]);
  isLoadingMarketing = signal<boolean>(false);
  selectedMarketingMachineId = signal<string>('');
  marketingRange = signal<'all' | 'today' | '7d' | '30d'>('all');
  marketingFeaturedOnly = signal<boolean>(false);
  selectedMarketingIds = signal<string[]>([]);
  isBatchDownloading = signal<boolean>(false);
  batchDownloadProgress = signal<string>('');
  previewPhoto = signal<MarketingPhoto | null>(null);

  // Events & Gallery State
  eventsList = signal<BoothEvent[]>([]);
  isLoadingEvents = signal<boolean>(false);
  selectedEventMachineId = signal<string>('');
  selectedEvent = signal<BoothEvent | null>(null);
  eventSessions = signal<EventSession[]>([]);
  isLoadingEventSessions = signal<boolean>(false);
  filterOnlyConsentedSessions = signal<boolean>(false);
  filteredEventSessions = computed(() => {
    const list = this.eventSessions();
    if (this.filterOnlyConsentedSessions()) {
      return list.filter(s => s.photo_usage_consent === 1);
    }
    return list;
  });
  consentedSessionsCount = computed(() => {
    return this.eventSessions().filter(s => s.photo_usage_consent === 1).length;
  });
  selectedSession = signal<EventSession | null>(null);
  eventQrModal = signal<BoothEvent | null>(null);

  // Modal State for Editing / Creating Event
  isEventModalOpen = signal<boolean>(false);
  isCreateEventMode = signal<boolean>(true);
  isSavingEvent = signal<boolean>(false);
  eventForm = signal<{
    id: string;
    name: string;
    machine_id: string;
    drive_folder_id: string;
    is_active: boolean;
  }>({
    id: '',
    name: '',
    machine_id: '',
    drive_folder_id: '',
    is_active: true
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

  // Managed machines & transactions - strictly isolated (no mock data)
  machines = signal<BoothMachine[]>([]);
  transactions = signal<BoothTransaction[]>([]);
  filterOnlyVouchers = signal<boolean>(false);

  filteredTransactions = computed(() => {
    let list = this.transactions();
    if (this.filterOnlyVouchers()) {
      list = list.filter(t => (t.discount_amount && t.discount_amount > 0) || (t.voucher_code && t.voucher_code.trim().length > 0));
    }
    return list;
  });

  toggleVoucherFilter() {
    this.filterOnlyVouchers.update(v => !v);
  }

  private readonly MANAGED_MACHINES_KEY = 'tach_managed_machine_ids';
  private readonly DEFAULT_STORE_MACHINES = [
    'device_a4ef47f074a84baaa74d79140d7c6a78', // PHÒNG 1
    'device_84c1f39677a9479e99bd8198234491cf'  // PHÒNG 2
  ];

  getManagedMachineIds(): string[] {
    try {
      const raw = localStorage.getItem(this.MANAGED_MACHINES_KEY);
      let list: string[] = raw ? JSON.parse(raw) : [];
      list = list.filter(id => id && id !== 'device_f30f8fb08a354cedb2612c587a3c5f5f');
      if (list.length === 0) {
        list = [...this.DEFAULT_STORE_MACHINES];
        this.saveManagedMachineIds(list);
      }
      return list;
    } catch {
      return [...this.DEFAULT_STORE_MACHINES];
    }
  }

  saveManagedMachineIds(ids: string[]) {
    localStorage.setItem(this.MANAGED_MACHINES_KEY, JSON.stringify(ids));
  }

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
        if (this.activeTab() === 'monitoring' || this.activeTab() === 'revenue') {
          this.fetchCloudflareDashboard(true);
        }
      }
    }, 30000);
  }

  ngOnDestroy() {
    if (this.refreshIntervalId) clearInterval(this.refreshIntervalId);
  }

  async login() {
    const secret = this.adminSecret().trim();
    if (!secret) {
      this.errorMessage.set('Vui lòng nhập mã bảo mật Admin Secret.');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/dashboard?storeId=store_hp_01`, {
        headers: {
          'Authorization': `Bearer ${secret}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok) {
          localStorage.setItem('tach_admin_secret', secret);
          this.isAuthenticated.set(true);
          if (data.overview) this.overview.set({ ...data.overview, discount_revenue: data.overview.discount_revenue ?? data.overview.discount_total ?? 0 });
          if (Array.isArray(data.machines) && data.machines.length > 0) {
            this.machines.set(data.machines);
          }
          if (Array.isArray(data.recentTransactions) && data.recentTransactions.length > 0) {
            this.transactions.set(data.recentTransactions);
          }
          this.loadSettings();
        } else {
          this.errorMessage.set('Mật khẩu Admin Secret không hợp lệ.');
        }
      } else if (response.status === 401 || response.status === 403) {
        this.errorMessage.set('Mật khẩu Admin Secret không chính xác. Vui lòng kiểm tra lại!');
      } else {
        this.errorMessage.set(`Lỗi kết nối máy chủ (${response.status}). Vui lòng thử lại sau.`);
      }
    } catch (e: any) {
      this.errorMessage.set('Không thể kết nối đến máy chủ quản trị. Hãy kiểm tra kết nối mạng!');
    } finally {
      this.isLoading.set(false);
      this.cdr.markForCheck();
    }
  }

  logout() {
    localStorage.removeItem('tach_admin_secret');
    this.isAuthenticated.set(false);
    this.adminSecret.set('');
  }

  async fetchCloudflareDashboard(silent: boolean = false) {
    if (!silent) this.isLoading.set(true);
    this.errorMessage.set('');

    const managedIds = this.getManagedMachineIds();

    try {
      const params = new URLSearchParams();
      params.set('storeId', 'store_hp_01');
      params.set('range', this.selectedRange());
      if (this.selectedRange() === 'custom') {
        if (this.customFrom()) params.set('from', this.customFrom());
        if (this.customTo()) params.set('to', this.customTo());
      }
      if (this.selectedMachineId()) {
        params.set('machineId', this.selectedMachineId());
      }
      if (managedIds.length > 0) {
        params.set('machineIds', managedIds.join(','));
      }

      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/dashboard?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok) {
          if (data.overview) this.overview.set({ ...data.overview, discount_revenue: data.overview.discount_revenue ?? data.overview.discount_total ?? 0 });

          const fetchedMachines: BoothMachine[] = Array.isArray(data.machines) ? data.machines : [];

// Managed IDs strictly curated by Admin (no auto-add of foreign machines)

          // Build final unique machine list
          const machineMap = new Map<string, BoothMachine>();
          for (const m of fetchedMachines) {
            machineMap.set(m.id, m);
          }

          this.machines.set(Array.from(machineMap.values()));

          if (Array.isArray(data.recentTransactions)) {
            this.transactions.set(data.recentTransactions);
          } else {
            this.transactions.set([]);
          }
        }
      } else if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('tach_admin_secret');
        this.isAuthenticated.set(false);
        this.errorMessage.set('Phiên đăng nhập đã hết hạn. Vui lòng nhập lại Admin Secret.');
      } else if (!silent) {
        console.warn('Could not connect to live Cloudflare Worker.');
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

  setRange(range: 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom') {
    this.selectedRange.set(range);
    this.fetchCloudflareDashboard();
  }

  onFilterChange() {
    this.fetchCloudflareDashboard();
  }

  exportTransactionsCsv() {
    const list = this.transactions();
    if (!list || list.length === 0) {
      alert('Không có dữ liệu giao dịch để xuất file!');
      return;
    }

    const headers = [
      'Thời gian',
      'Mã giao dịch',
      'Phòng / Máy',
      'Mã phiên',
      'Gói chụp',
      'Giá gốc (VNĐ)',
      'Giảm giá (VNĐ)',
      'Mã voucher',
      'Thực thu (VNĐ)',
      'Bản in',
      'Phương thức',
      'Trạng thái'
    ];

    const rows = list.map(tx => [
      `"${this.formatTime(tx.created_at)}"`,
      `"${tx.id}"`,
      `"${tx.machine_name || tx.machine_id}"`,
      `"${tx.session_code || tx.session_public_id || ''}"`,
      `"${tx.package_name}"`,
      tx.original_amount || tx.total_amount,
      tx.discount_amount || 0,
      `"${tx.voucher_code || ''}"`,
      tx.total_amount,
      tx.print_copies,
      `"${tx.payment_method.includes('SEPAY') || tx.payment_method.includes('QR') ? 'VietQR SePay' : 'Tiền mặt'}"`,
      `"${tx.payment_status === 'PAID' ? 'Thành công' : tx.payment_status}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tach_tach_giao_dich_${this.selectedRange()}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ==========================================
  // MARKETING PHOTOS (CONSENTED PHOTO VAULT)
  // ==========================================
  async fetchMarketingPhotos() {
    this.isLoadingMarketing.set(true);
    this.errorMessage.set('');
    try {
      const params = new URLSearchParams();
      params.set('storeId', 'store_hp_01');
      params.set('range', this.marketingRange());
      if (this.marketingFeaturedOnly()) {
        params.set('featuredOnly', 'true');
      }
      if (this.selectedMarketingMachineId()) {
        params.set('machineId', this.selectedMarketingMachineId());
      } else {
        const managedIds = this.getManagedMachineIds();
        if (managedIds.length > 0) {
          params.set('machineIds', managedIds.join(','));
        }
      }
      params.set('limit', '60');

      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/marketing-photos?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.ok && Array.isArray(data.photos)) {
          const rawPhotos = data.photos;
          const normalized: MarketingPhoto[] = rawPhotos.map((p: any) => {
            const sId = p.sessionId || p.id || p.session_public_id || '';
            return {
              id: sId,
              session_public_id: sId,
              session_code: p.sessionCode || p.session_code || (sId ? `#ses_${sId.slice(4, 12)}` : ''),
              store_id: p.storeId || p.store_id || 'store_hp_01',
              machine_id: p.machineId || p.machine_id || '',
              machine_name: p.machineName || p.machine_name || '',
              event_public_id: p.eventPublicId || p.event_public_id || '',
              event_name: p.eventName || p.event_name || '',
              guest_name: p.guestName || p.guest_name || '',
              guest_phone: p.guestPhone || p.guest_phone || '',
              photo_usage_consent: p.photoUsageConsent === 1 || p.photo_usage_consent === 1 || p.photoUsageConsent === true ? 1 : 0,
              consent_at: p.consentedAt || p.consent_at || '',
              is_featured: p.isFeatured === true || p.is_featured === 1 ? 1 : 0,
              created_at: p.createdAt || p.created_at || '',
              final_drive_file_id: p.finalDriveFileId || p.final_drive_file_id || '',
              signed_final_url: p.finalPhoto?.mediaUrl || p.finalPhoto?.downloadUrl || p.signed_final_url || '',
              signed_thumb_url: p.finalPhoto?.thumbnailUrl || p.finalPhoto?.mediaUrl || p.signed_thumb_url || p.signed_final_url || '',
              signed_guest_share_url: p.guestShareUrl || p.signed_guest_share_url || ''
            };
          });
          this.marketingPhotos.set(normalized);
        } else {
          this.marketingPhotos.set([]);
        }
      }
    } catch (err: any) {
      console.warn('Failed to fetch marketing photos:', err?.message || err);
    } finally {
      this.isLoadingMarketing.set(false);
      this.cdr.markForCheck();
    }
  }

  setMarketingRange(range: 'all' | 'today' | '7d' | '30d') {
    this.marketingRange.set(range);
    this.fetchMarketingPhotos();
  }

  toggleMarketingFeaturedOnly() {
    this.marketingFeaturedOnly.update(v => !v);
    this.fetchMarketingPhotos();
  }

  async toggleStarPhoto(photo: MarketingPhoto, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    const nextFeatured = photo.is_featured === 1 ? 0 : 1;

    // Optimistic local update
    this.marketingPhotos.update(list => list.map(p => p.id === photo.id ? { ...p, is_featured: nextFeatured } : p));

    try {
      await fetch(`${this.defaultWorkerUrl}/v1/admin/marketing-photos/star`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: photo.session_public_id,
          isFeatured: nextFeatured === 1
        })
      });
    } catch (err) {
      console.warn('Failed to star photo:', err);
    }
  }

  toggleSelectPhoto(id: string, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    const current = this.selectedMarketingIds();
    if (current.includes(id)) {
      this.selectedMarketingIds.set(current.filter(item => item !== id));
    } else {
      this.selectedMarketingIds.set([...current, id]);
    }
  }

  selectAllMarketingPhotos() {
    const allIds = this.marketingPhotos().map(p => p.id);
    this.selectedMarketingIds.set(allIds);
  }

  clearSelectedMarketingPhotos() {
    this.selectedMarketingIds.set([]);
  }

  async downloadSinglePhoto(photo: MarketingPhoto, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    const url = photo.signed_final_url;
    if (!url) {
      alert('Không tìm thấy link tải ảnh in!');
      return;
    }
    const filename = `${photo.event_name || 'TachTach'}_${photo.session_code || photo.session_public_id}.jpg`;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(url, '_blank');
    }
  }

  async downloadBatchZip() {
    const selectedIds = this.selectedMarketingIds();
    const targetPhotos = selectedIds.length > 0
      ? this.marketingPhotos().filter(p => selectedIds.includes(p.id))
      : this.marketingPhotos();

    if (targetPhotos.length === 0) {
      alert('Không có ảnh nào để tải về!');
      return;
    }

    this.isBatchDownloading.set(true);
    this.batchDownloadProgress.set(`0/${targetPhotos.length}`);

    try {
      const zip = new JSZip();
      let completed = 0;

      for (let i = 0; i < targetPhotos.length; i++) {
        const photo = targetPhotos[i];
        const url = photo.signed_final_url;
        if (url) {
          try {
            const resp = await fetch(url);
            if (resp.ok) {
              const arrayBuffer = await resp.arrayBuffer();
              const filename = `${photo.event_name || 'TachTach'}_${photo.session_code || photo.session_public_id}_${i + 1}.jpg`;
              zip.file(filename, arrayBuffer);
            }
          } catch (fetchErr) {
            console.warn('Failed to fetch photo for zip:', photo.id, fetchErr);
          }
        }
        completed++;
        this.batchDownloadProgress.set(`${completed}/${targetPhotos.length}`);
        this.cdr.markForCheck();
      }

      this.batchDownloadProgress.set('Đang nén file ZIP...');
      const content = await zip.generateAsync({ type: 'blob' });
      const objUrl = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `tach_tach_marketing_photos_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      this.successMessage.set(`Đã tải về thành công ${completed} ảnh marketing!`);
      setTimeout(() => this.successMessage.set(''), 4000);
    } catch (zipErr: any) {
      alert('Lỗi tạo file ZIP: ' + (zipErr?.message || zipErr));
    } finally {
      this.isBatchDownloading.set(false);
      this.batchDownloadProgress.set('');
      this.cdr.markForCheck();
    }
  }

  openPhotoPreview(photo: MarketingPhoto) {
    this.previewPhoto.set(photo);
  }

  closePhotoPreview() {
    this.previewPhoto.set(null);
  }

  // ==========================================
  // EVENTS & PHOTO GALLERY DRILLDOWN
  // ==========================================
  async fetchEvents() {
    this.isLoadingEvents.set(true);
    this.errorMessage.set('');
    try {
      const params = new URLSearchParams();
      params.set('storeId', 'store_hp_01');
      if (this.selectedEventMachineId()) {
        params.set('machineId', this.selectedEventMachineId());
      } else {
        const managedIds = this.getManagedMachineIds();
        if (managedIds.length > 0) {
          params.set('machineIds', managedIds.join(','));
        }
      }
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/events?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Accept': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.ok && Array.isArray(data.events)) {
          const rawEvents = data.events;
          const normalizedEvents: BoothEvent[] = rawEvents.map((e: any) => ({
            id: e.id,
            public_id: e.public_id || e.id,
            store_id: e.store_id || 'store_hp_01',
            machine_id: e.machine_id || '',
            machine_name: e.machine_name || this.getMachineName(e.machine_id) || '',
            name: e.name || e.id,
            date: e.date || (e.created_at ? e.created_at.slice(0, 10) : ''),
            drive_folder_id: e.drive_folder_id || '',
            gallery_url: e.gallery_url || '',
            total_sessions: Number(e.session_count ?? e.total_sessions ?? 0),
            consented_sessions: Number(e.consented_count ?? e.consented_sessions ?? 0),
            is_active: e.is_active !== undefined ? Number(e.is_active) : 1,
            created_at: e.created_at || ''
          }));
          this.eventsList.set(normalizedEvents);
        } else {
          this.eventsList.set([]);
        }
      }
    } catch (err: any) {
      console.warn('Failed to fetch events:', err?.message || err);
    } finally {
      this.isLoadingEvents.set(false);
      this.cdr.markForCheck();
    }
  }

  async selectEvent(evt: BoothEvent) {
    this.selectedEvent.set(evt);
    this.isLoadingEventSessions.set(true);
    this.eventSessions.set([]);
    this.selectedSession.set(null);

    try {
      const params = new URLSearchParams();
      params.set('storeId', 'store_hp_01');
      if (this.selectedEventMachineId()) {
        params.set('machineId', this.selectedEventMachineId());
      }
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/events/${encodeURIComponent(evt.id)}/sessions?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Accept': 'application/json'
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.ok && Array.isArray(data.sessions)) {
          const rawSessions = data.sessions;
          const normalizedSessions: EventSession[] = rawSessions.map((s: any) => {
            const finalPhoto = s.finalPhoto ? {
              id: s.finalPhoto.id || `${s.id}_final`,
              name: s.finalPhoto.name || `${s.id}_final.jpg`,
              signedUrl: s.finalPhoto.mediaUrl || s.finalPhoto.downloadUrl || s.finalPhoto.signedUrl || '',
              signedThumbUrl: s.finalPhoto.thumbnailUrl || s.finalPhoto.mediaUrl || s.finalPhoto.signedThumbUrl || ''
            } : null;

            const shots = Array.isArray(s.shots) ? s.shots.map((sh: any, idx: number) => ({
              id: sh.id || `${s.id}_shot_${idx + 1}`,
              name: sh.name || `Shot ${idx + 1}`,
              signedUrl: sh.mediaUrl || sh.downloadUrl || sh.signedUrl || '',
              signedThumbUrl: sh.thumbnailUrl || sh.mediaUrl || sh.signedThumbUrl || ''
            })) : [];

            const btsVideo = s.btsVideo ? {
              id: s.btsVideo.id || `${s.id}_bts`,
              name: s.btsVideo.name || 'BTS Video',
              signedUrl: s.btsVideo.mediaUrl || s.btsVideo.downloadUrl || s.btsVideo.signedUrl || '',
              signedThumbUrl: s.btsVideo.thumbnailUrl || ''
            } : null;

            return {
              id: s.id,
              session_public_id: s.id,
              session_code: s.sessionCode || s.session_code || (s.id ? `#ses_${s.id.slice(4, 12)}` : ''),
              guest_name: s.guestName || s.guest_name || '',
              photo_usage_consent: s.photoUsageConsent === 1 || s.photo_usage_consent === 1 ? 1 : 0,
              created_at: s.createdAt || s.created_at || '',
              drive_session_folder_id: s.driveFolderId || s.drive_folder_id || '',
              finalPhoto,
              shots,
              btsVideo,
              guestShareUrl: s.guestShareUrl || s.guest_share_url || ''
            };
          });
          this.eventSessions.set(normalizedSessions);
        }
      }
    } catch (err: any) {
      console.warn('Failed to fetch event sessions:', err?.message || err);
    } finally {
      this.isLoadingEventSessions.set(false);
      this.cdr.markForCheck();
    }
  }

  backToEventsList() {
    this.selectedEvent.set(null);
    this.eventSessions.set([]);
    this.selectedSession.set(null);
  }

  openSessionDetail(s: EventSession) {
    this.selectedSession.set(s);
  }

  closeSessionDetail() {
    this.selectedSession.set(null);
  }

  openEventQr(evt: BoothEvent, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    this.eventQrModal.set(evt);
  }

  closeEventQr() {
    this.eventQrModal.set(null);
  }

  getEventShareUrl(evt: BoothEvent): string {
    if (evt.gallery_url) return evt.gallery_url;
    return `https://tachtach.event-vn.com/event/${encodeURIComponent(evt.public_id || evt.id)}`;
  }

  getEventConsentedShareUrl(evt: BoothEvent): string {
    const baseUrl = this.getEventShareUrl(evt);
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}consent=1`;
  }

  getEventConsentedQrUrl(evt: BoothEvent): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(this.getEventConsentedShareUrl(evt))}`;
  }

  openEventGallery(evt: BoothEvent, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    window.open(this.getEventShareUrl(evt), '_blank');
  }

  openEventConsentedGallery(evt: BoothEvent, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    window.open(this.getEventConsentedShareUrl(evt), '_blank');
  }

  copyEventConsentedShareUrl(evt: BoothEvent, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    const url = this.getEventConsentedShareUrl(evt);
    navigator.clipboard.writeText(url);
    this.successMessage.set('Đã sao chép liên kết xem ảnh khách đồng ý (Marketing)!');
    setTimeout(() => this.successMessage.set(''), 3000);
  }

  getEventQrUrl(evt: BoothEvent): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(this.getEventShareUrl(evt))}`;
  }

  encodeURIComponent(val: string): string {
    return encodeURIComponent(val || '');
  }

  copyEventShareUrl(evt: BoothEvent, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    const url = this.getEventShareUrl(evt);
    navigator.clipboard.writeText(url);
    this.successMessage.set('Đã sao chép liên kết thư viện ảnh sự kiện!');
    setTimeout(() => this.successMessage.set(''), 3000);
  }

  copyGuestShareUrl(url: string, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    navigator.clipboard.writeText(url);
    this.successMessage.set('Đã sao chép liên kết xem ảnh của khách!');
    setTimeout(() => this.successMessage.set(''), 3000);
  }

  getMachineName(machineId?: string): string {
    if (!machineId) return '';
    const found = this.machines().find(m => m.id === machineId);
    return found ? found.name : machineId;
  }

  // ==========================================
  // EVENT CRUD (CREATE, UPDATE, DELETE)
  // ==========================================
  openCreateEventModal(defaultMachineId?: string) {
    this.isCreateEventMode.set(true);
    const mList = this.machines();
    const fallbackMachine = defaultMachineId || this.selectedEventMachineId() || (mList.length > 0 ? mList[0].id : '');
    this.eventForm.set({
      id: '',
      name: '',
      machine_id: fallbackMachine,
      drive_folder_id: '',
      is_active: true
    });
    this.isEventModalOpen.set(true);
  }

  openEditEventModal(evt: BoothEvent, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    this.isCreateEventMode.set(false);
    this.eventForm.set({
      id: evt.id,
      name: evt.name,
      machine_id: evt.machine_id || '',
      drive_folder_id: evt.drive_folder_id || '',
      is_active: evt.is_active === 1
    });
    this.isEventModalOpen.set(true);
  }

  closeEventModal() {
    this.isEventModalOpen.set(false);
  }

  async saveEventModal() {
    const form = this.eventForm();
    const name = form.name.trim();
    if (!name) {
      alert('Vui lòng nhập Tên sự kiện!');
      return;
    }

    this.isSavingEvent.set(true);
    const isCreate = this.isCreateEventMode();
    const endpoint = isCreate
      ? `${this.defaultWorkerUrl}/v1/admin/events`
      : `${this.defaultWorkerUrl}/v1/admin/events/${encodeURIComponent(form.id)}`;
    const method = isCreate ? 'POST' : 'PUT';

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: form.id || undefined,
          name,
          machineId: form.machine_id || undefined,
          driveFolderId: form.drive_folder_id.trim() || undefined,
          isActive: form.is_active ? 1 : 0,
          storeId: 'store_hp_01'
        })
      });

      if (response.ok) {
        this.successMessage.set(isCreate ? 'Đã tạo sự kiện mới thành công!' : 'Đã cập nhật sự kiện thành công!');
        setTimeout(() => this.successMessage.set(''), 3500);
        this.isEventModalOpen.set(false);
        await this.fetchEvents();
      } else {
        const errData = await response.json().catch(() => ({}));
        alert('Lưu sự kiện thất bại: ' + (errData.message || response.statusText));
      }
    } catch (e: any) {
      alert('Lỗi kết nối máy chủ khi lưu sự kiện: ' + (e?.message || e));
    } finally {
      this.isSavingEvent.set(false);
      this.cdr.markForCheck();
    }
  }

  async deleteEvent(evt: BoothEvent, ev?: MouseEvent) {
    if (ev) ev.stopPropagation();
    if (!confirm(`Bạn có chắc chắn muốn xóa sự kiện "${evt.name}"? Dữ liệu sự kiện sẽ bị xóa khỏi hệ thống.`)) {
      return;
    }

    try {
      const response = await fetch(`${this.defaultWorkerUrl}/v1/admin/events/${encodeURIComponent(evt.id)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`
        }
      });
      if (response.ok) {
        this.successMessage.set(`Đã xóa sự kiện "${evt.name}" thành công!`);
        setTimeout(() => this.successMessage.set(''), 3500);
        if (this.selectedEvent()?.id === evt.id) {
          this.selectedEvent.set(null);
        }
        await this.fetchEvents();
      } else {
        alert('Xóa sự kiện thất bại');
      }
    } catch (e: any) {
      alert('Lỗi kết nối khi xóa sự kiện: ' + (e?.message || e));
    }
  }

  // ==========================================
  // MACHINE CRUD & PAPER MANAGEMENT
  // ==========================================
  openCreateMachineModal() {
    this.isCreateMode.set(true);
    this.editForm.set({
      id: '',
      license_id: '',
      store_id: 'store_hp_01',
      name: '',
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
    const isCreate = this.isCreateMode();

    const licenseInput = form.license_id.trim();
    const idInput = form.id.trim();
    const lookupKey = isCreate ? (licenseInput || idInput) : idInput;

    if (!lookupKey) {
      alert('Vui lòng nhập Mã Kích Hoạt (License Key) của phòng chụp!');
      return;
    }

    if (!isCreate && !form.name.trim()) {
      alert('Vui lòng nhập Tên phòng chụp!');
      return;
    }

    this.isSavingMachine.set(true);
    const endpoint = isCreate
      ? `${this.defaultWorkerUrl}/v1/admin/machines`
      : `${this.defaultWorkerUrl}/v1/admin/machines/${encodeURIComponent(idInput)}`;
    const method = isCreate ? 'POST' : 'PUT';

    let linkedMachineId = lookupKey;

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: idInput || undefined,
          licenseKey: lookupKey,
          licenseId: licenseInput || undefined,
          name: form.name.trim() || undefined,
          storeId: form.store_id.trim(),
          paperRemaining: Number(form.paper_remaining),
          paperTotalCapacity: Number(form.paper_total_capacity),
          cameraModel: form.camera_model.trim(),
          printerStatus: form.printer_status
        })
      });

      if (response.ok) {
        const resData = await response.json();
        if (resData.machine && resData.machine.id) {
          linkedMachineId = resData.machine.id;
        }
        this.successMessage.set(isCreate ? 'Đã liên kết buồng chụp thành công!' : 'Đã cập nhật thông tin phòng chụp thành công!');
        setTimeout(() => this.successMessage.set(''), 4000);
      }
    } catch (e) {
      console.warn('Backend sync failed, updated locally', e);
    } finally {
      // Add ONLY canonical machine ID to managed machine IDs
      const currentIds = this.getManagedMachineIds();
      const canonicalId = linkedMachineId || lookupKey;
      const cleanedIds = new Set<string>();
      for (const id of currentIds) {
        if (id !== lookupKey && id !== canonicalId) {
          cleanedIds.add(id);
        }
      }
      cleanedIds.add(canonicalId);
      this.saveManagedMachineIds(Array.from(cleanedIds));

      // Refresh live dashboard from Cloudflare
      await this.fetchCloudflareDashboard(true);

      this.isSavingMachine.set(false);
      this.isMachineModalOpen.set(false);
      this.cdr.markForCheck();
    }
  }

  async deleteMachine(machineId: string) {
    if (!confirm(`Bạn có chắc chắn muốn xóa buồng chụp ${machineId} khỏi danh sách quản lý?`)) {
      return;
    }

    try {
      await fetch(`${this.defaultWorkerUrl}/v1/admin/machines/${encodeURIComponent(machineId)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.adminSecret().trim()}`
        }
      });
      this.successMessage.set(`Đã xóa buồng chụp khỏi danh sách!`);
      setTimeout(() => this.successMessage.set(''), 3000);
    } catch {
      // Fallback
    } finally {
      const target = this.machines().find(m => m.id === machineId);
      const prefix = target?.license_key_prefix;

      const currentIds = this.getManagedMachineIds().filter(id => {
        if (id === machineId) return false;
        if (prefix && (id === prefix || id.startsWith(prefix))) return false;
        if (target?.license_id && id === target.license_id) return false;
        return true;
      });
      this.saveManagedMachineIds(currentIds);

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

      this.machines.update(list => list.map(m => m.id === machineId ? { ...m, paper_remaining: 700 } : m));
    } catch {
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

  getRangeLabel(range: string): string {
    switch (range) {
      case 'today': return 'Hôm nay';
      case 'yesterday': return 'Hôm qua';
      case '7d': return '7 ngày qua';
      case '30d': return '30 ngày qua';
      case 'all': return 'Toàn thời gian';
      case 'custom': return 'Tùy chọn';
      default: return 'Hôm nay';
    }
  }

  getTodayDateString(): string {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    return d + '/' + m + '/' + y;
  }

  // ==========================================
  // SETTINGS & TAB SWITCHING
  // ==========================================
  switchTab(tab: 'monitoring' | 'revenue' | 'marketing' | 'events' | 'settings') {
    this.activeTab.set(tab);
    if (tab === 'revenue') {
      this.fetchCloudflareDashboard();
    } else if (tab === 'marketing') {
      this.fetchMarketingPhotos();
    } else if (tab === 'events') {
      this.fetchEvents();
    } else if (tab === 'settings') {
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

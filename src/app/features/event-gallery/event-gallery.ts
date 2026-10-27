import { Component, OnInit, OnDestroy, signal, computed, effect, ChangeDetectionStrategy, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { GoogleDriveGalleryService, GalleryPhoto, GallerySession } from './services/google-drive-gallery.service';

/** Wrapper cho windowing - giữ index gốc để opacity toggle đúng */
export interface MasonryPhotoItem {
  photo: GalleryPhoto;
  index: number;
}

export interface VisiblePhoto {
  photo: GalleryPhoto;
  originalIndex: number;
}

@Component({
  selector: 'app-event-gallery',
  imports: [CommonModule],
  templateUrl: './event-gallery.html',
  styleUrl: './event-gallery.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventGallery implements OnInit, OnDestroy {
  protected readonly Math = Math;
  eventId: string | null = '';

  // ===== STATE SIGNALS =====
  photos = signal<GalleryPhoto[]>([]);
  sessions = signal<GallerySession[]>([]);
  activeSession = signal<GallerySession | null>(null);
  activeSessionMediaIndex = signal<number>(0);
  isSingleSession = signal<boolean>(false);
  isSessionTimedOut = signal<boolean>(false);
  selectedIndex = signal<number>(0);
  isLoading = signal<boolean>(true);
  isPolling = signal<boolean>(false);
  showLightbox = signal<boolean>(false);
  lightboxIndex = signal<number>(0);
  errorMessage = signal<string | null>(null);
  galleryStatus = signal<'PENDING' | 'READY'>('PENDING');
  viewMode = signal<'slideshow' | 'grid'>('slideshow');
  eventViewMode = signal<'masonry' | 'feed'>('masonry');
  loadedImages = signal<Set<string>>(new Set());

  // ===== ZIP & DOWNLOAD SIGNALS =====
  isZippingAll = signal<boolean>(false);
  zipAllProgress = signal<string>('');
  isZippingSession = signal<boolean>(false);
  zipSessionProgress = signal<string>('');
  isDownloading = signal<boolean>(false);
  isRefreshing = signal<boolean>(false);

  // ===== COMPUTED =====
  selectedPhoto = computed(() => this.photos()[this.selectedIndex()]);
  isStripSelected = computed(() => {
    const p = this.selectedPhoto();
    return !!p && (p.role === 'final' || (p.name ? p.name.toLowerCase().includes('print') : false));
  });
  leftColumnPhotos = computed<MasonryPhotoItem[]>(() => {
    return this.photos()
      .map((photo, index) => ({ photo, index }))
      .filter((_, i) => i % 2 === 0);
  });
  rightColumnPhotos = computed<MasonryPhotoItem[]>(() => {
    return this.photos()
      .map((photo, index) => ({ photo, index }))
      .filter((_, i) => i % 2 === 1);
  });
  photoCount = computed(() => this.photos().length);
  sessionCount = computed(() => this.sessions().length);
  activeSessionMedia = computed(() => {
    const s = this.activeSession();
    if (!s) return [];
    return s.allMedia || [];
  });
  selectedSessionMedia = computed(() => {
    const list = this.activeSessionMedia();
    const idx = this.activeSessionMediaIndex();
    return list[idx] || list[0] || null;
  });
  currentLightboxMedia = computed<GalleryPhoto | null>(() => {
    const s = this.activeSession();
    if (s && s.allMedia && s.allMedia.length > 0) {
      return s.allMedia[this.activeSessionMediaIndex()] || s.allMedia[0];
    }
    return this.photos()[this.lightboxIndex()] || null;
  });
  currentBatchMedia = computed<GalleryPhoto[]>(() => {
    const s = this.activeSession();
    if (s && s.allMedia && s.allMedia.length > 0) {
      return s.allMedia;
    }
    if (this.isSingleSession()) {
      return this.photos();
    }
    return [];
  });
  currentBatchCount = computed(() => this.currentBatchMedia().length);

  /**
   * WINDOWING: Chỉ render ±2 ảnh xung quanh ảnh đang xem trong DOM.
   * 100 ảnh → chỉ 5 thẻ <img> trong DOM → không bao giờ lag mobile.
   */
  visibleMainPhotos = computed<VisiblePhoto[]>(() => {
    const all = this.photos();
    const idx = this.selectedIndex();
    const total = all.length;
    if (total === 0) return [];

    const WINDOW = 2;
    const seen = new Set<number>();
    const result: VisiblePhoto[] = [];

    for (let offset = -WINDOW; offset <= WINDOW; offset++) {
      const i = (idx + offset + total) % total;
      if (!seen.has(i)) {
        seen.add(i);
        result.push({ photo: all[i], originalIndex: i });
      }
    }
    return result;
  });

  // ===== POLLING CONFIG (Exponential Backoff) =====
  private pollTimeoutId: any = null;
  private knownMediaIds = new Set<string>();
  private noNewPhotosSince = 0;
  private pollIntervalMs = 5000;
  private readonly POLL_BASE_MS = 5000;
  private readonly POLL_MAX_MS = 30000;
  private readonly SESSION_POLL_INTERVAL_MS = 2500;
  private readonly AUTO_STOP_MS = 5 * 60 * 1000;
  private readonly SESSION_AUTO_STOP_MS = 3 * 60 * 1000;
  private isSessionGallery = false;
  private readonly visibilityHandler = () => {
    if (document.hidden) {
      this.stopPolling();
    } else if (this.eventId && !this.errorMessage()) {
      if (this.isSessionGallery || this.galleryStatus() === 'PENDING') {
        this.startPolling();
      }
    }
  };

  // ===== LRU CACHE (giữ tối đa 20 ảnh gần nhất trong RAM) =====
  private lruCache = new Map<string, HTMLImageElement>();
  private readonly MAX_CACHE = 20;

  // ===== IOS WEB SHARE PREPARATION =====
  private preparedShareFile: File | null = null;
  private preparedShareMediaId: string | null = null;
  private sharePrepareAbort: AbortController | null = null;

  // Demo mode
  private demoPhotos: GalleryPhoto[] = [
    { mediaId: 'demo1', name: 'Khoảnh khắc hạnh phúc', kind: 'image', thumbnailUrl: 'photos/photo1.png', mediaUrl: 'photos/photo1.png', lightboxUrl: 'photos/photo1.png', downloadUrl: 'photos/photo1.png', createdTime: new Date().toISOString() },
    { mediaId: 'demo2', name: 'Lễ cắt bánh', kind: 'image', thumbnailUrl: 'photos/photo2.png', mediaUrl: 'photos/photo2.png', lightboxUrl: 'photos/photo2.png', downloadUrl: 'photos/photo2.png', createdTime: new Date().toISOString() },
    { mediaId: 'demo3', name: 'Trao nhẫn cưới', kind: 'image', thumbnailUrl: 'photos/photo3.png', mediaUrl: 'photos/photo3.png', lightboxUrl: 'photos/photo3.png', downloadUrl: 'photos/photo3.png', createdTime: new Date().toISOString() },
    { mediaId: 'demo4', name: 'Chân dung cặp đôi', kind: 'image', thumbnailUrl: 'photos/photo4.png', mediaUrl: 'photos/photo4.png', lightboxUrl: 'photos/photo4.png', downloadUrl: 'photos/photo4.png', createdTime: new Date().toISOString() },
  ];

  private demoSessions: GallerySession[] = [
    {
      sessionId: 'ses_demo2',
      sessionNumber: 2,
      timestamp: Date.now(),
      timeFormatted: '20:45',
      finalPhoto: { mediaId: 'demo1', name: 'Dải ảnh in #2', kind: 'image', thumbnailUrl: 'photos/photo1.png', mediaUrl: 'photos/photo1.png', lightboxUrl: 'photos/photo1.png', downloadUrl: 'photos/photo1.png', createdTime: new Date().toISOString(), sessionInfo: { sessionId: 'ses_demo2', sessionNumber: 2, timeFormatted: '20:45', shotCount: 2, hasBts: false, totalMediaCount: 3 } },
      shots: [
        { mediaId: 'demo2', name: 'Ảnh chụp 1', kind: 'image', thumbnailUrl: 'photos/photo2.png', mediaUrl: 'photos/photo2.png', lightboxUrl: 'photos/photo2.png', downloadUrl: 'photos/photo2.png', createdTime: new Date().toISOString() },
        { mediaId: 'demo3', name: 'Ảnh chụp 2', kind: 'image', thumbnailUrl: 'photos/photo3.png', mediaUrl: 'photos/photo3.png', lightboxUrl: 'photos/photo3.png', downloadUrl: 'photos/photo3.png', createdTime: new Date().toISOString() }
      ],
      allMedia: [
        { mediaId: 'demo1', name: 'Dải ảnh in #2', kind: 'image', thumbnailUrl: 'photos/photo1.png', mediaUrl: 'photos/photo1.png', lightboxUrl: 'photos/photo1.png', downloadUrl: 'photos/photo1.png', createdTime: new Date().toISOString() },
        { mediaId: 'demo2', name: 'Ảnh chụp 1', kind: 'image', thumbnailUrl: 'photos/photo2.png', mediaUrl: 'photos/photo2.png', lightboxUrl: 'photos/photo2.png', downloadUrl: 'photos/photo2.png', createdTime: new Date().toISOString() },
        { mediaId: 'demo3', name: 'Ảnh chụp 2', kind: 'image', thumbnailUrl: 'photos/photo3.png', mediaUrl: 'photos/photo3.png', lightboxUrl: 'photos/photo3.png', downloadUrl: 'photos/photo3.png', createdTime: new Date().toISOString() }
      ],
      mediaCount: 3
    },
    {
      sessionId: 'ses_demo1',
      sessionNumber: 1,
      timestamp: Date.now() - 600000,
      timeFormatted: '20:35',
      finalPhoto: { mediaId: 'demo4', name: 'Dải ảnh in #1', kind: 'image', thumbnailUrl: 'photos/photo4.png', mediaUrl: 'photos/photo4.png', lightboxUrl: 'photos/photo4.png', downloadUrl: 'photos/photo4.png', createdTime: new Date().toISOString(), sessionInfo: { sessionId: 'ses_demo1', sessionNumber: 1, timeFormatted: '20:35', shotCount: 1, hasBts: false, totalMediaCount: 2 } },
      shots: [
        { mediaId: 'demo3', name: 'Ảnh chụp 1', kind: 'image', thumbnailUrl: 'photos/photo3.png', mediaUrl: 'photos/photo3.png', lightboxUrl: 'photos/photo3.png', downloadUrl: 'photos/photo3.png', createdTime: new Date().toISOString() }
      ],
      allMedia: [
        { mediaId: 'demo4', name: 'Dải ảnh in #1', kind: 'image', thumbnailUrl: 'photos/photo4.png', mediaUrl: 'photos/photo4.png', lightboxUrl: 'photos/photo4.png', downloadUrl: 'photos/photo4.png', createdTime: new Date().toISOString() },
        { mediaId: 'demo3', name: 'Ảnh chụp 1', kind: 'image', thumbnailUrl: 'photos/photo3.png', mediaUrl: 'photos/photo3.png', lightboxUrl: 'photos/photo3.png', downloadUrl: 'photos/photo3.png', createdTime: new Date().toISOString() }
      ],
      mediaCount: 2
    }
  ];

  constructor(
    private route: ActivatedRoute,
    private driveService: GoogleDriveGalleryService
  ) {
    // PREDICTIVE PRELOADING: chỉ preload ảnh current ± 1 (3 ảnh thay vì tất cả)
    effect(() => {
      const idx = this.selectedIndex();
      const all = this.photos();
      if (all.length === 0) {
        this.prepareShareFile(undefined);
        return;
      }

      const total = all.length;
      const targets = [
        (idx - 1 + total) % total,
        idx,
        (idx + 1) % total
      ];
      for (const i of targets) {
        this.preloadSingle(all[i], this.isSingleSession() ? 2560 : 1080);
      }

      this.prepareShareFile(all[idx]);
    });
  }

  ngOnInit() {
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.route.paramMap.subscribe(params => {
      this.eventId = params.get('id');
      this.route.queryParamMap.subscribe(queryParams => {
        const legacyQueryValue = queryParams.get('m');
        const sessionPublicId = queryParams.get('s');
        this.isSessionGallery = Boolean(sessionPublicId);
        this.isSingleSession.set(Boolean(sessionPublicId));
        this.driveService.setRouteQuery(legacyQueryValue, sessionPublicId);
        this.loadInitialPhotos();
      });
    });
  }

  ngOnDestroy() {
    this.stopPolling();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.lruCache.clear();
    this.sharePrepareAbort?.abort();
    this.sharePrepareAbort = null;
    this.preparedShareFile = null;
    this.preparedShareMediaId = null;
  }

  // ========== DATA LOADING ==========

  private loadInitialPhotos() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.knownMediaIds.clear();
    this.isSessionTimedOut.set(false);

    if (this.eventId && this.eventId.startsWith('demo')) {
      setTimeout(() => {
        this.photos.set(this.demoPhotos);
        this.sessions.set(this.demoSessions);
        this.demoPhotos.forEach(p => this.knownMediaIds.add(p.mediaId));
        this.isLoading.set(false);
      }, 800);
      return;
    }

    if (!this.eventId) return;

    this.loadGalleryPage(null, []);
  }

  private loadGalleryPage(cursor: string | null, accumulated: GalleryPhoto[]) {
    if (!this.eventId) return;
    this.driveService.listPhotosInFolder(this.eventId, cursor).subscribe({
      next: (result) => {
        const byId = new Map(accumulated.map(photo => [photo.mediaId, photo]));
        result.photos.forEach(photo => byId.set(photo.mediaId, photo));
        const photos = Array.from(byId.values());
        if (!this.isSessionGallery && result.status === 'READY' && result.nextCursor) {
          this.loadGalleryPage(result.nextCursor, photos);
          return;
        }
        if (result.sessions && result.sessions.length > 0) {
          this.sessions.set(result.sessions);
        }
        this.galleryStatus.set(result.status);
        this.photos.set(this.sortPhotos(photos));
        photos.forEach(p => this.knownMediaIds.add(p.mediaId));
        this.isLoading.set(false);
        if (this.isSessionGallery) {
          // Luồng phiên chụp: Luôn bật polling tự động để đón các ảnh chụp (shots) và video hậu trường (bts) đang tải lên
          this.pollIntervalMs = this.SESSION_POLL_INTERVAL_MS;
          this.startPolling();
        } else if (result.status === 'PENDING') {
          this.pollIntervalMs = result.pollAfterMs || this.POLL_BASE_MS;
          this.startPolling();
        } else {
          this.stopPolling();
        }
      },
      error: (err) => {
        console.error('Failed to load photos:', err);
        this.errorMessage.set(this.describeGalleryError(err));
        this.isLoading.set(false);
      }
    });
  }

  // ========== POLLING (Exponential Backoff) ==========

  private startPolling() {
    if (this.pollTimeoutId || !this.eventId || this.errorMessage()) return;
    if (!this.isSessionGallery && this.galleryStatus() !== 'PENDING') return;
    this.isPolling.set(true);
    this.noNewPhotosSince = Date.now();
    this.pollIntervalMs = this.isSessionGallery
      ? this.SESSION_POLL_INTERVAL_MS
      : Math.max(this.POLL_BASE_MS, Math.min(this.pollIntervalMs, this.POLL_MAX_MS));
    this.schedulePollTick();
  }

  private schedulePollTick() {
    this.pollTimeoutId = setTimeout(() => this.executePollTick(), this.pollIntervalMs);
  }

  private executePollTick() {
    if (!this.isPolling() || !this.eventId) return;

    this.driveService.listPhotosInFolder(this.eventId).subscribe({
      next: (result) => {
        if (!this.isSessionGallery && result.status === 'READY') {
          this.stopPolling();
          this.loadInitialPhotos();
          return;
        }
        const files = result.photos;
        this.galleryStatus.set(result.status);
        if (result.sessions && result.sessions.length > 0) {
          this.sessions.set(result.sessions);
          const curr = this.activeSession();
          if (curr) {
            const found = result.sessions.find(s => s.sessionId === curr.sessionId);
            if (found) this.activeSession.set(found);
          }
        }
        const newFiles = files.filter(f => !this.knownMediaIds.has(f.mediaId));

        if (newFiles.length > 0) {
          newFiles.forEach(f => { f.isNew = true; this.knownMediaIds.add(f.mediaId); });
          const selectedMediaId = this.selectedPhoto()?.mediaId;
          const wasEmpty = this.photos().length === 0;
          const merged = this.sortPhotos([...this.photos(), ...newFiles]);
          this.photos.set(merged);

          if (wasEmpty) {
            this.selectedIndex.set(0);
          } else if (selectedMediaId) {
            const nextIndex = merged.findIndex(photo => photo.mediaId === selectedMediaId);
            if (nextIndex >= 0) this.selectedIndex.set(nextIndex);
          }
          this.noNewPhotosSince = Date.now();
          this.pollIntervalMs = this.isSessionGallery ? this.SESSION_POLL_INTERVAL_MS : this.POLL_BASE_MS;

          setTimeout(() => {
            this.photos.update(current => current.map(p => ({ ...p, isNew: false })));
          }, 5000);
        } else {
          if (this.isSessionGallery) {
            // Trong luồng phiên chụp: nếu chưa có ảnh nào -> giữ chu kỳ 2.5s để đón ảnh ngay khi upload xong
            // Nếu đã có ảnh -> sau 30s không có ảnh mới thì giãn dần chu kỳ (tối đa 8s)
            if (this.photos().length === 0) {
              this.pollIntervalMs = this.SESSION_POLL_INTERVAL_MS;
            } else if (Date.now() - this.noNewPhotosSince > 30000) {
              this.pollIntervalMs = Math.min(Math.round(this.pollIntervalMs * 1.3), 8000);
            }
          } else {
            this.pollIntervalMs = Math.min(Math.round(this.pollIntervalMs * 1.5), this.POLL_MAX_MS);
          }
        }

        const autoStopLimit = this.isSessionGallery ? this.SESSION_AUTO_STOP_MS : this.AUTO_STOP_MS;
        if (Date.now() - this.noNewPhotosSince > autoStopLimit) {
          this.stopPolling();
          if (this.photos().length === 0) {
            this.isSessionTimedOut.set(true);
          }
          return;
        }

        if (this.isPolling()) {
          this.schedulePollTick();
        }
      },
      error: (err) => {
        if (this.photos().length === 0) {
          this.errorMessage.set(this.describeGalleryError(err));
        }
        this.stopPolling();
      }
    });
  }

  retrySessionSync() {
    this.isSessionTimedOut.set(false);
    this.noNewPhotosSince = Date.now();
    this.loadInitialPhotos();
  }

  refreshNow() {
    if (this.isRefreshing() || !this.eventId) return;
    this.isSessionTimedOut.set(false);
    this.isRefreshing.set(true);
    this.driveService.listPhotosInFolder(this.eventId).subscribe({
      next: (result) => {
        const files = result.photos;
        this.galleryStatus.set(result.status);
        if (result.sessions && result.sessions.length > 0) {
          this.sessions.set(result.sessions);
        }
        const newFiles = files.filter(f => !this.knownMediaIds.has(f.mediaId));
        if (newFiles.length > 0) {
          newFiles.forEach(f => { f.isNew = true; this.knownMediaIds.add(f.mediaId); });
          const wasEmpty = this.photos().length === 0;
          const merged = this.sortPhotos([...this.photos(), ...newFiles]);
          this.photos.set(merged);
          if (wasEmpty) this.selectedIndex.set(0);
          this.noNewPhotosSince = Date.now();
        } else if (this.photos().length === 0 && files.length > 0) {
          this.photos.set(this.sortPhotos(files));
          files.forEach(f => this.knownMediaIds.add(f.mediaId));
          this.selectedIndex.set(0);
        }
        this.isRefreshing.set(false);
        this.startPolling();
      },
      error: () => {
        this.isRefreshing.set(false);
      }
    });
  }

  private sortPhotos(photos: GalleryPhoto[]): GalleryPhoto[] {
    return [...photos].sort((left, right) => {
      // 1. Cùng một phiên chụp: final -> shot 1..N -> bts
      if (left.sessionId && right.sessionId && left.sessionId === right.sessionId) {
        const roleRank = (role?: string) => (role === 'final' ? 1 : (role === 'shot' ? 2 : (role === 'bts' ? 3 : 4)));
        const rankDiff = roleRank(left.role) - roleRank(right.role);
        if (rankDiff !== 0) return rankDiff;
        if (left.role === 'shot' && right.role === 'shot') {
          return (left.slotIndex || 0) - (right.slotIndex || 0);
        }
      }

      // 2. Sắp xếp giữa các phiên theo createdTime / timestamp giảm dần
      const leftTime = Date.parse(left.createdTime || '');
      const rightTime = Date.parse(right.createdTime || '');
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return 0;
    });
  }

  private stopPolling() {
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
    this.isPolling.set(false);
  }

  retryLoad() {
    this.errorMessage.set(null);
    this.stopPolling();
    this.loadInitialPhotos();
  }

  private describeGalleryError(error: any): string {
    const status = Number(error?.status || 0);
    if (status === 400 || status === 403) return 'Liên kết thư viện không hợp lệ hoặc không còn quyền truy cập.';
    if (status === 502 || status === 503) return 'Dịch vụ thư viện đang tạm thời gián đoạn. Vui lòng thử lại sau.';
    return 'Không thể tải ảnh. Vui lòng kiểm tra kết nối và thử lại.';
  }

  // ========== UI ACTIONS ==========

  private syncScrollAnimations(index: number) {
    requestAnimationFrame(() => {
      const mainEl = document.querySelector('.gallery-main-photo');
      mainEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });

      const thumbEls = document.querySelectorAll('.thumbnail-item');
      if (thumbEls && thumbEls[index]) {
        thumbEls[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
  }

  selectPhoto(index: number) {
    this.resetMainZoom();
    this.selectedIndex.set(index);
    this.syncScrollAnimations(index);
  }

  openSessionByPhoto(photo: GalleryPhoto, index = 0) {
    this.lightboxIndex.set(index);
    let session = photo ? this.sessions().find(s => s.sessionId === photo.sessionId || s.finalPhoto?.mediaId === photo.mediaId) : null;
    if (session) {
      this.activeSession.set(session);
      this.activeSessionMediaIndex.set(0);
      if (session.allMedia[0]) {
        this.preloadSingle(session.allMedia[0], 2160);
        this.prepareShareFile(session.allMedia[0]);
      }
    } else {
      this.activeSession.set(null);
      this.activeSessionMediaIndex.set(0);
      if (photo) {
        this.preloadSingle(photo, 2160);
        this.prepareShareFile(photo);
      }
    }
    this.resetLightboxZoom();
    this.showLightbox.set(true);
    document.body.style.overflow = 'hidden';
  }

  openLightbox(index: number) {
    const photo = this.photos()[index];
    if (photo) {
      this.openSessionByPhoto(photo, index);
    }
  }

  selectSessionMedia(index: number) {
    this.resetLightboxZoom();
    this.activeSessionMediaIndex.set(index);
    const media = this.activeSessionMedia()[index];
    if (media) {
      this.preloadSingle(media, 2160);
      this.prepareShareFile(media);
    }
  }

  closeLightbox() {
    this.resetLightboxZoom();
    this.showLightbox.set(false);
    this.activeSession.set(null);
    this.activeSessionMediaIndex.set(0);
    document.body.style.overflow = '';
  }

  lightboxPrev() {
    this.resetLightboxZoom();
    const session = this.activeSession();
    if (session && session.allMedia && session.allMedia.length > 1) {
      const total = session.allMedia.length;
      this.activeSessionMediaIndex.update(i => (i - 1 + total) % total);
      const cur = session.allMedia[this.activeSessionMediaIndex()];
      if (cur) {
        this.preloadSingle(cur, 2160);
        this.prepareShareFile(cur);
      }
      return;
    }
    const total = this.photoCount();
    this.lightboxIndex.update(i => (i - 1 + total) % total);
    const cur = this.photos()[this.lightboxIndex()];
    if (cur) {
      this.preloadSingle(cur, 2160);
      this.prepareShareFile(cur);
    }
  }

  lightboxNext() {
    this.resetLightboxZoom();
    const session = this.activeSession();
    if (session && session.allMedia && session.allMedia.length > 1) {
      const total = session.allMedia.length;
      this.activeSessionMediaIndex.update(i => (i + 1) % total);
      const cur = session.allMedia[this.activeSessionMediaIndex()];
      if (cur) {
        this.preloadSingle(cur, 2160);
        this.prepareShareFile(cur);
      }
      return;
    }
    const total = this.photoCount();
    this.lightboxIndex.update(i => (i + 1) % total);
    const cur = this.photos()[this.lightboxIndex()];
    if (cur) {
      this.preloadSingle(cur, 2160);
      this.prepareShareFile(cur);
    }
  }

  downloadCurrentLightboxMedia() {
    const media = this.currentLightboxMedia();
    if (media) this.downloadPhoto(media);
  }

  async downloadActiveSession() {
    const mediaList = this.currentBatchMedia();
    if (mediaList.length === 0) return;
    if (mediaList.length === 1) {
      this.downloadPhoto(mediaList[0]);
      return;
    }

    if (this.isZippingSession()) return;
    this.isZippingSession.set(true);
    this.zipSessionProgress.set('0%');

    try {
      // TRƯỜNG HỢP 1: TRÊN THIẾT BỊ DI ĐỘNG (Android & iOS)
      // Khách muốn lưu ảnh trực tiếp vào Thư viện ảnh / Bộ sưu tập (Apple Photos / Google Photos).
      // TUYỆT ĐỐI KHÔNG nén ZIP trên điện thoại vì:
      // 1. Khách phổ thông không biết giải nén file zip trên điện thoại.
      // 2. File zip tải về không tự hiển thị trong ứng dụng Thư viện ảnh.
      // 3. Nén zip ngốn RAM gây crash tab và Chrome Android chặn tải file zip tự động.
      if (this.isMobileDevice()) {
        await this.saveBatchToMobileGallery(mediaList);
        return;
      }

      // TRƯỜNG HỢP 2: TRÊN MÁY TÍNH (PC / Laptop)
      // Tải trọn bộ 1 file ZIP nhanh chóng và tiện lợi.
      const session = this.activeSession();
      const num = session?.sessionNumber || 'chup';
      await this.downloadZip(mediaList, `Phien_${num}.zip`, this.zipSessionProgress);
    } finally {
      this.isZippingSession.set(false);
      this.zipSessionProgress.set('');
    }
  }

  private async saveBatchToMobileGallery(mediaList: GalleryPhoto[]): Promise<void> {
    const total = mediaList.length;

    // Bước 1: Ưu tiên dùng Web Share API đa tệp (Hỗ trợ cả iOS Safari và Android Chrome)
    // Giúp khách lưu toàn bộ ảnh cùng 1 lúc vào Thư viện ảnh (iOS: "Lưu X hình ảnh", Android: "Lưu vào máy / Google Photos / Zalo")
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const files: File[] = [];
        for (let i = 0; i < total; i++) {
          this.zipSessionProgress.set(`Chuẩn bị ${i + 1}/${total}...`);
          const photo = mediaList[i];
          const url = this.driveService.getDownloadUrl(photo);
          if (!url) continue;

          try {
            const res = await fetch(url);
            if (res.ok) {
              const blob = await res.blob();
              let fileName = photo.name?.trim() || (this.isVideo(photo) ? `video_${i + 1}.mp4` : `photo_${i + 1}.jpg`);
              if (!fileName.includes('.')) fileName += this.isVideo(photo) ? '.mp4' : '.jpg';
              const mimeType = this.getShareMimeType(photo);
              files.push(new File([blob], fileName, { type: mimeType }));
            }
          } catch (fetchErr) {
            console.warn(`[Gallery] Failed to fetch photo ${i + 1} for share:`, fetchErr);
          }
        }

        if (files.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
          this.zipSessionProgress.set('Mở bảng lưu ảnh...');
          await navigator.share({
            files,
            title: 'Trọn bộ ảnh sự kiện'
          });
          return;
        }
      } catch (err) {
        if (this.isShareAbortError(err)) return;
        console.warn('[Gallery] Web Share batch failed, falling back to sequential download:', err);
      }
    }

    // Bước 2: Fallback khi Web Share không hỗ trợ (Tải lần lượt từng file ảnh JPG/MP4 vào máy)
    // Các ảnh này sẽ tải thẳng vào thư mục "Download" của máy.
    // Ứng dụng Bộ sưu tập / Thư viện ảnh trên Android sẽ tự động quét và hiển thị ngay các ảnh này!
    for (let i = 0; i < total; i++) {
      this.zipSessionProgress.set(`Đang lưu ${i + 1}/${total}...`);
      const photo = mediaList[i];
      const url = this.driveService.getDownloadUrl(photo);
      if (url) {
        let fileName = photo.name?.trim() || (this.isVideo(photo) ? `video_${i + 1}.mp4` : `photo_${i + 1}.jpg`);
        if (!fileName.includes('.')) fileName += this.isVideo(photo) ? '.mp4' : '.jpg';
        this.triggerDirectDownload(url, fileName);
        if (i < total - 1) {
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }
    }
  }

  navigatePrev() {
    this.resetMainZoom();
    const total = this.photoCount();
    this.selectedIndex.update(i => {
      const newIdx = (i - 1 + total) % total;
      this.syncScrollAnimations(newIdx);
      return newIdx;
    });
  }

  navigateNext() {
    this.resetMainZoom();
    const total = this.photoCount();
    this.selectedIndex.update(i => {
      const newIdx = (i + 1) % total;
      this.syncScrollAnimations(newIdx);
      return newIdx;
    });
  }

  async downloadPhoto(photo: GalleryPhoto | null | undefined) {
    if (!photo || this.isDownloading()) return;

    this.isDownloading.set(true);
    try {
      const url = this.driveService.getDownloadUrl(photo);
      if (!url) return;
      const fileName = photo.name?.trim() || (this.isVideo(photo) ? 'event-video.mp4' : 'event-photo.jpg');

      // 1. Trên iPhone/iOS: Dùng Web Share API để mở bảng chia sẻ của iOS có nút "Lưu hình ảnh" (Save Image)
      // giúp ảnh nhảy thẳng vào Cuộn camera (Apple Photos) mà KHÔNG nhảy sang Files/tab khác!
      if (this.isIOSDevice() && typeof navigator.share === 'function') {
        try {
          let file = this.preparedShareFile;
          if (!file || this.preparedShareMediaId !== photo.mediaId) {
            const res = await fetch(url);
            if (res.ok) {
              const blob = await res.blob();
              const mimeType = this.getShareMimeType(photo);
              file = new File([blob], fileName, { type: mimeType });
              this.preparedShareFile = file;
              this.preparedShareMediaId = photo.mediaId;
            }
          }

          if (file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            return;
          }
        } catch (error) {
          if (this.isShareAbortError(error)) return;
          console.warn('[Gallery] iOS Web Share failed, falling back to direct download:', error);
        }
      }

      // 2. Android, PC và các nền tảng khác:
      // Tải TRỰC TIẾP qua URL attachment của server (Content-Disposition: attachment).
      // TUYỆT ĐỐI KHÔNG dùng fetch() + Blob Object URL trên Android vì sẽ làm mất User Gesture,
      // dẫn đến việc Chrome Android chặn tải từ ảnh thứ 2 trở đi!
      this.triggerDirectDownload(url, fileName);
    } finally {
      this.isDownloading.set(false);
    }
  }

  async downloadAllPhotos() {
    if (this.isZippingAll()) return;
    const photos = this.photos();
    if (photos.length === 0) return;

    this.isZippingAll.set(true);
    this.zipAllProgress.set('0%');

    try {
      const eventName = this.eventId || 'su_kien';
      await this.downloadZip(photos, `Su_kien_${eventName}.zip`, this.zipAllProgress);
    } finally {
      this.isZippingAll.set(false);
      this.zipAllProgress.set('');
    }
  }

  private triggerDirectDownload(url: string, fileName: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) document.body.removeChild(link);
    }, 2000);
  }

  private async downloadZip(mediaList: GalleryPhoto[], zipFileName: string, progressSignal: WritableSignal<string>): Promise<void> {
    if (!mediaList || mediaList.length === 0) return;

    try {
      progressSignal.set('Nạp module ZIP...');
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const seenNames = new Map<string, number>();
      const total = mediaList.length;

      for (let i = 0; i < total; i++) {
        const photo = mediaList[i];
        progressSignal.set(`${i + 1}/${total}`);

        const url = this.driveService.getDownloadUrl(photo);
        if (!url) continue;

        let baseName = photo.name?.trim() || '';
        if (!baseName) {
          baseName = this.isVideo(photo) ? 'video.mp4' : 'photo.jpg';
        } else if (!baseName.includes('.')) {
          baseName += this.isVideo(photo) ? '.mp4' : '.jpg';
        }

        let finalName = baseName;
        const count = seenNames.get(baseName) || 0;
        if (count > 0) {
          const dotIdx = baseName.lastIndexOf('.');
          if (dotIdx > 0) {
            finalName = `${baseName.slice(0, dotIdx)}_${count}${baseName.slice(dotIdx)}`;
          } else {
            finalName = `${baseName}_${count}`;
          }
        }
        seenNames.set(baseName, count + 1);

        try {
          const res = await fetch(url);
          if (res.ok) {
            const blob = await res.blob();
            zip.file(finalName, blob);
          }
        } catch (fetchErr) {
          console.warn(`[Gallery] Failed to fetch file ${finalName} for zip:`, fetchErr);
        }
      }

      progressSignal.set('Nén ZIP...');
      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => {
          progressSignal.set(`${Math.round(meta.percent)}%`);
        }
      );

      // Nếu là thiết bị di động và hỗ trợ Web Share, chia sẻ file ZIP qua hệ thống để lưu an toàn không bị chặn
      if (this.isMobileDevice() && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          const zipFile = new File([zipBlob], zipFileName, { type: 'application/zip' });
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [zipFile] })) {
            await navigator.share({
              files: [zipFile],
              title: zipFileName
            });
            return;
          }
        } catch (shareErr) {
          if (this.isShareAbortError(shareErr)) return;
        }
      }

      const blobUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = zipFileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        if (document.body.contains(link)) document.body.removeChild(link);
      }, 3000);
    } catch (err) {
      console.error('[Gallery] Zip generation failed:', err);
      alert('Không thể tạo file ZIP, vui lòng thử lại.');
    }
  }

  private prepareShareFile(photo: GalleryPhoto | undefined): void {
    if (photo && this.preparedShareMediaId === photo.mediaId &&
      (this.preparedShareFile || this.sharePrepareAbort)) {
      return;
    }

    this.sharePrepareAbort?.abort();
    this.sharePrepareAbort = null;
    this.preparedShareFile = null;
    this.preparedShareMediaId = null;

    if (!photo || !this.isIOSDevice()) return;

    const url = this.driveService.getDownloadUrl(photo);
    if (!url) return;

    const controller = new AbortController();
    this.sharePrepareAbort = controller;
    this.preparedShareMediaId = photo.mediaId;

    void fetch(url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Download request failed with status ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted || this.sharePrepareAbort !== controller) return;

        const mimeType = this.getShareMimeType(photo);
        const fileName = photo.name?.trim() || (this.isVideo(photo) ? 'event-media.mp4' : 'event-media.jpg');
        this.preparedShareFile = new File([blob], fileName, { type: mimeType });
        this.sharePrepareAbort = null;
      })
      .catch(error => {
        if (this.isShareAbortError(error) || controller.signal.aborted) return;
        if (this.sharePrepareAbort === controller) {
          this.sharePrepareAbort = null;
          this.preparedShareFile = null;
          this.preparedShareMediaId = null;
          console.warn('[Gallery] Could not prepare image for sharing:', error);
        }
      });
  }

  private getShareMimeType(photo: GalleryPhoto): string {
    const mimeType = photo.mimeType?.trim();
    const mediaType = this.isVideo(photo) ? 'video' : 'image';
    const fallback = this.isVideo(photo) ? 'video/mp4' : 'image/jpeg';
    return mimeType && new RegExp(`^${mediaType}/[a-z0-9.+-]+$`, 'i').test(mimeType) ? mimeType : fallback;
  }

  isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
      (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
  }

  private isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false;

    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
  }

  private isInAppBrowser(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /FBAN|FBAV|Instagram|Zalo|Line|TikTok|MicroMessenger|musical_ly/i.test(ua);
  }

  private isShareAbortError(error: unknown): boolean {
    return typeof error === 'object' && error !== null &&
      'name' in error && (error as { name?: unknown }).name === 'AbortError';
  }

  // ========== SWIPE GESTURES ==========

    // ========== LIGHTBOX ZOOM & PAN ENGINE ==========
  lbScale = signal<number>(1);
  lbTranslateX = signal<number>(0);
  lbTranslateY = signal<number>(0);
  lbIsTransitioning = signal<boolean>(false);

  private lbTouchStartX = 0;
  private lbTouchStartY = 0;
  private lbLastTouchX = 0;
  private lbLastTouchY = 0;
  private lbPinchStartDist = 0;
  private lbPinchStartScale = 1;
  private lbPinchStartTx = 0;
  private lbPinchStartTy = 0;
  private lbPinchMidX = 0;
  private lbPinchMidY = 0;
  private lbIsPinching = false;
  private lbIsPanning = false;
  private lbMovedDist = 0;
  private lbLastTapTime = 0;
  private lbSuppressBackdropClick = false;

  getLightboxTransform(): string {
    return `translate3d(${this.lbTranslateX()}px, ${this.lbTranslateY()}px, 0) scale(${this.lbScale()})`;
  }

  onLbTouchStart(event: TouchEvent) {
    const touches = event.touches;
    this.lbMovedDist = 0;

    if (touches.length === 2) {
      this.lbIsPinching = true;
      this.lbIsPanning = false;
      this.lbIsTransitioning.set(false);
      this.lbPinchStartDist = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      this.lbPinchStartScale = this.lbScale();
      this.lbPinchStartTx = this.lbTranslateX();
      this.lbPinchStartTy = this.lbTranslateY();
      this.lbPinchMidX = (touches[0].clientX + touches[1].clientX) / 2;
      this.lbPinchMidY = (touches[0].clientY + touches[1].clientY) / 2;
    } else if (touches.length === 1) {
      this.lbTouchStartX = touches[0].clientX;
      this.lbTouchStartY = touches[0].clientY;
      this.lbLastTouchX = touches[0].clientX;
      this.lbLastTouchY = touches[0].clientY;

      if (this.lbScale() > 1.05) {
        this.lbIsPanning = true;
        this.lbIsTransitioning.set(false);
      } else {
        this.lbIsPanning = false;
      }
    }
  }

  onLbTouchMove(event: TouchEvent) {
    const touches = event.touches;

    if (this.lbIsPinching && touches.length === 2) {
      if (event.cancelable) event.preventDefault();
      const currentDist = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      if (this.lbPinchStartDist > 0) {
        const ratio = currentDist / this.lbPinchStartDist;
        const newScale = Math.min(Math.max(this.lbPinchStartScale * ratio, 0.8), 5);
        this.lbScale.set(newScale);

        const currentMidX = (touches[0].clientX + touches[1].clientX) / 2;
        const currentMidY = (touches[0].clientY + touches[1].clientY) / 2;
        const dMidX = currentMidX - this.lbPinchMidX;
        const dMidY = currentMidY - this.lbPinchMidY;
        this.lbTranslateX.set(this.lbPinchStartTx + dMidX);
        this.lbTranslateY.set(this.lbPinchStartTy + dMidY);
        this.lbMovedDist += 10;
      }
    } else if (touches.length === 1) {
      const dx = touches[0].clientX - this.lbLastTouchX;
      const dy = touches[0].clientY - this.lbLastTouchY;
      this.lbLastTouchX = touches[0].clientX;
      this.lbLastTouchY = touches[0].clientY;
      this.lbMovedDist += Math.hypot(dx, dy);

      if (this.lbScale() > 1.05) {
        if (event.cancelable) event.preventDefault();
        const curScale = this.lbScale();
        const maxTx = Math.max(0, (curScale - 1) * (window.innerWidth * 0.5));
        const maxTy = Math.max(0, (curScale - 1) * (window.innerHeight * 0.45));

        const nextTx = Math.min(Math.max(this.lbTranslateX() + dx, -maxTx), maxTx);
        const nextTy = Math.min(Math.max(this.lbTranslateY() + dy, -maxTy), maxTy);

        this.lbTranslateX.set(nextTx);
        this.lbTranslateY.set(nextTy);
      }
    }
  }

  onLbTouchEnd(event: TouchEvent) {
    if (this.lbIsPinching) {
      this.lbIsPinching = false;
      this.lbIsTransitioning.set(true);
      this.lbSuppressBackdropClick = true;
      setTimeout(() => { this.lbSuppressBackdropClick = false; }, 300);

      if (this.lbScale() < 1.05) {
        this.resetLightboxZoom();
      } else {
        const clampedScale = Math.min(Math.max(this.lbScale(), 1), 4);
        this.lbScale.set(clampedScale);
        this.clampLightboxTranslate(clampedScale);
      }
      return;
    }

    if (this.lbIsPanning) {
      this.lbIsPanning = false;
      this.lbIsTransitioning.set(true);
      this.lbSuppressBackdropClick = true;
      setTimeout(() => { this.lbSuppressBackdropClick = false; }, 300);
      this.clampLightboxTranslate(this.lbScale());
      return;
    }

    if (this.lbScale() <= 1.05) {
      const now = Date.now();
      const changeTouch = event.changedTouches[0];
      const tapDist = changeTouch
        ? Math.hypot(changeTouch.clientX - this.lbTouchStartX, changeTouch.clientY - this.lbTouchStartY)
        : 999;

      if (tapDist < 20 && now - this.lbLastTapTime < 320) {
        // DOUBLE TAP TO ZOOM!
        this.lbLastTapTime = 0;
        this.toggleLightboxZoomAtPoint(
          changeTouch ? changeTouch.clientX : window.innerWidth / 2,
          changeTouch ? changeTouch.clientY : window.innerHeight / 2
        );
        return;
      }

      this.lbLastTapTime = now;

      // Horizontal swipe navigation
      if (changeTouch && Math.abs(this.lbTouchStartX - changeTouch.clientX) > 50) {
        const diff = this.lbTouchStartX - changeTouch.clientX;
        if (diff > 0) {
          this.lightboxNext();
        } else {
          this.lightboxPrev();
        }
      }
    }
  }

  clampLightboxTranslate(scale: number) {
    if (scale <= 1.05) {
      this.lbTranslateX.set(0);
      this.lbTranslateY.set(0);
      return;
    }
    const maxTx = (scale - 1) * (window.innerWidth * 0.48);
    const maxTy = (scale - 1) * (window.innerHeight * 0.45);
    this.lbTranslateX.set(Math.min(Math.max(this.lbTranslateX(), -maxTx), maxTx));
    this.lbTranslateY.set(Math.min(Math.max(this.lbTranslateY(), -maxTy), maxTy));
  }

  toggleLightboxZoomAtPoint(clientX: number, clientY: number) {
    this.lbIsTransitioning.set(true);
    if (this.lbScale() > 1.2) {
      this.resetLightboxZoom();
    } else {
      const targetScale = 2.5;
      const offsetX = clientX - window.innerWidth / 2;
      const offsetY = clientY - window.innerHeight / 2;
      const maxTx = (targetScale - 1) * (window.innerWidth * 0.45);
      const maxTy = (targetScale - 1) * (window.innerHeight * 0.4);

      const targetTx = Math.min(Math.max(-offsetX * (targetScale - 1) * 0.65, -maxTx), maxTx);
      const targetTy = Math.min(Math.max(-offsetY * (targetScale - 1) * 0.65, -maxTy), maxTy);

      this.lbScale.set(targetScale);
      this.lbTranslateX.set(targetTx);
      this.lbTranslateY.set(targetTy);
    }
  }

  zoomLightboxStep(delta: number) {
    this.lbIsTransitioning.set(true);
    const nextScale = Math.min(Math.max(this.lbScale() + delta, 1), 4);
    if (nextScale <= 1.05) {
      this.resetLightboxZoom();
    } else {
      this.lbScale.set(nextScale);
      this.clampLightboxTranslate(nextScale);
    }
  }

  toggleLightboxZoom() {
    this.toggleLightboxZoomAtPoint(window.innerWidth / 2, window.innerHeight / 2);
  }

  resetLightboxZoom() {
    this.lbIsTransitioning.set(true);
    this.lbScale.set(1);
    this.lbTranslateX.set(0);
    this.lbTranslateY.set(0);
  }

  onLbWheel(event: WheelEvent) {
    if (this.isVideo(this.currentLightboxMedia())) return;
    if (event.cancelable) event.preventDefault();
    this.lbIsTransitioning.set(false);
    const delta = -Math.sign(event.deltaY) * 0.35;
    const nextScale = Math.min(Math.max(this.lbScale() + delta, 1), 4);
    if (nextScale <= 1.05) {
      this.resetLightboxZoom();
    } else {
      this.lbScale.set(nextScale);
      this.clampLightboxTranslate(nextScale);
    }
  }

  onLightboxBackdropClick(event: MouseEvent) {
    if (this.lbSuppressBackdropClick) return;
    if (this.lbScale() > 1.05) {
      this.resetLightboxZoom();
      return;
    }
    this.closeLightbox();
  }

  // ========== MAIN HERO VIEWER ZOOM & GESTURES ==========
  mainScale = signal<number>(1);
  mainTranslateX = signal<number>(0);
  mainTranslateY = signal<number>(0);
  mainIsTransitioning = signal<boolean>(false);

  private mainTouchStartX = 0;
  private mainTouchStartY = 0;
  private mainLastTouchX = 0;
  private mainLastTouchY = 0;
  private mainPinchStartDist = 0;
  private mainPinchStartScale = 1;
  private mainPinchStartTx = 0;
  private mainPinchStartTy = 0;
  private mainPinchMidX = 0;
  private mainPinchMidY = 0;
  private mainIsPinching = false;
  private mainIsPanning = false;
  mainMovedDist = 0;
  private mainLastTapTime = 0;

  getMainTransform(): string {
    return `translate3d(${this.mainTranslateX()}px, ${this.mainTranslateY()}px, 0) scale(${this.mainScale()})`;
  }

  onMainTouchStart(event: TouchEvent) {
    const touches = event.touches;
    this.mainMovedDist = 0;

    if (touches.length === 2) {
      this.mainIsPinching = true;
      this.mainIsPanning = false;
      this.mainIsTransitioning.set(false);
      this.mainPinchStartDist = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      this.mainPinchStartScale = this.mainScale();
      this.mainPinchStartTx = this.mainTranslateX();
      this.mainPinchStartTy = this.mainTranslateY();
      this.mainPinchMidX = (touches[0].clientX + touches[1].clientX) / 2;
      this.mainPinchMidY = (touches[0].clientY + touches[1].clientY) / 2;
    } else if (touches.length === 1) {
      this.mainTouchStartX = touches[0].clientX;
      this.mainTouchStartY = touches[0].clientY;
      this.mainLastTouchX = touches[0].clientX;
      this.mainLastTouchY = touches[0].clientY;

      if (this.mainScale() > 1.05) {
        this.mainIsPanning = true;
        this.mainIsTransitioning.set(false);
      } else {
        this.mainIsPanning = false;
      }
    }
  }

  onMainTouchMove(event: TouchEvent) {
    const touches = event.touches;

    if (this.mainIsPinching && touches.length === 2) {
      if (event.cancelable) event.preventDefault();
      const currentDist = Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
      if (this.mainPinchStartDist > 0) {
        const ratio = currentDist / this.mainPinchStartDist;
        const newScale = Math.min(Math.max(this.mainPinchStartScale * ratio, 0.8), 4.5);
        this.mainScale.set(newScale);

        const currentMidX = (touches[0].clientX + touches[1].clientX) / 2;
        const currentMidY = (touches[0].clientY + touches[1].clientY) / 2;
        const dMidX = currentMidX - this.mainPinchMidX;
        const dMidY = currentMidY - this.mainPinchMidY;
        this.mainTranslateX.set(this.mainPinchStartTx + dMidX);
        this.mainTranslateY.set(this.mainPinchStartTy + dMidY);
        this.mainMovedDist += 10;
      }
    } else if (touches.length === 1) {
      const dx = touches[0].clientX - this.mainLastTouchX;
      const dy = touches[0].clientY - this.mainLastTouchY;
      this.mainLastTouchX = touches[0].clientX;
      this.mainLastTouchY = touches[0].clientY;
      this.mainMovedDist += Math.hypot(dx, dy);

      if (this.mainScale() > 1.05) {
        if (event.cancelable) event.preventDefault();
        const curScale = this.mainScale();
        const maxTx = Math.max(0, (curScale - 1) * (window.innerWidth * 0.45));
        const maxTy = Math.max(0, (curScale - 1) * 350);

        this.mainTranslateX.set(Math.min(Math.max(this.mainTranslateX() + dx, -maxTx), maxTx));
        this.mainTranslateY.set(Math.min(Math.max(this.mainTranslateY() + dy, -maxTy), maxTy));
      }
    }
  }

  onMainTouchEnd(event: TouchEvent) {
    if (this.mainIsPinching) {
      this.mainIsPinching = false;
      this.mainIsTransitioning.set(true);
      if (this.mainScale() < 1.05) {
        this.resetMainZoom();
      } else {
        const clampedScale = Math.min(Math.max(this.mainScale(), 1), 3.5);
        this.mainScale.set(clampedScale);
        this.clampMainTranslate(clampedScale);
      }
      return;
    }

    if (this.mainIsPanning) {
      this.mainIsPanning = false;
      this.mainIsTransitioning.set(true);
      this.clampMainTranslate(this.mainScale());
      return;
    }

    if (this.mainScale() <= 1.05) {
      const now = Date.now();
      const changeTouch = event.changedTouches[0];
      const tapDist = changeTouch
        ? Math.hypot(changeTouch.clientX - this.mainTouchStartX, changeTouch.clientY - this.mainTouchStartY)
        : 999;

      if (tapDist < 20 && now - this.mainLastTapTime < 320) {
        // DOUBLE TAP ON MAIN PHOTO!
        this.mainLastTapTime = 0;
        this.toggleMainZoom();
        return;
      }
      this.mainLastTapTime = now;

      if (changeTouch && Math.abs(this.mainTouchStartX - changeTouch.clientX) > 50) {
        const diff = this.mainTouchStartX - changeTouch.clientX;
        if (diff > 0) this.navigateNext();
        else this.navigatePrev();
      }
    }
  }

  toggleMainZoom() {
    this.mainIsTransitioning.set(true);
    if (this.mainScale() > 1.2) {
      this.resetMainZoom();
    } else {
      this.mainScale.set(2.2);
      this.mainTranslateX.set(0);
      this.mainTranslateY.set(0);
    }
  }

  clampMainTranslate(scale: number) {
    if (scale <= 1.05) {
      this.mainTranslateX.set(0);
      this.mainTranslateY.set(0);
      return;
    }
    const maxTx = (scale - 1) * (window.innerWidth * 0.45);
    const maxTy = (scale - 1) * 350;
    this.mainTranslateX.set(Math.min(Math.max(this.mainTranslateX(), -maxTx), maxTx));
    this.mainTranslateY.set(Math.min(Math.max(this.mainTranslateY(), -maxTy), maxTy));
  }

  resetMainZoom() {
    this.mainIsTransitioning.set(true);
    this.mainScale.set(1);
    this.mainTranslateX.set(0);
    this.mainTranslateY.set(0);
  }

  onMainWheel(event: WheelEvent) {
    if (this.isVideo(this.selectedPhoto())) return;
    if (this.mainScale() > 1.05) {
      if (event.cancelable) event.preventDefault();
      this.mainIsTransitioning.set(false);
      const delta = -Math.sign(event.deltaY) * 0.25;
      const nextScale = Math.min(Math.max(this.mainScale() + delta, 1), 3.5);
      if (nextScale <= 1.05) {
        this.resetMainZoom();
      } else {
        this.mainScale.set(nextScale);
        this.clampMainTranslate(nextScale);
      }
    }
  }

  onMainPhotoClick(index: number) {
    if (this.mainMovedDist > 12) return;
    if (this.mainScale() > 1.1) {
      this.resetMainZoom();
      return;
    }
    this.openLightbox(index);
  }

  // Compatibility aliases
  onTouchStart(e: TouchEvent) { this.onLbTouchStart(e); }
  onTouchMove(e: TouchEvent) { this.onLbTouchMove(e); }
  onTouchEnd(e: TouchEvent) { this.onLbTouchEnd(e); }
  onTouchEndMain(e: TouchEvent) { this.onMainTouchEnd(e); }

// ========== IMAGE URL HELPERS ==========

  isVideo(photo: GalleryPhoto | null | undefined): boolean {
    return this.driveService.isVideo(photo);
  }

  /** Main photo: s1080 (không -rw, chất lượng cao) */
  getPhotoSrc(photo: GalleryPhoto): string {
    if (!photo) return '';
    if (photo.mediaId.startsWith('demo')) return photo.mediaUrl;
    return this.driveService.getHighResUrl(photo, 1080);
  }

  getVideoSrc(photo: GalleryPhoto): string {
    if (!photo) return '';
    return this.driveService.getVideoUrl(photo);
  }

  /** Retina srcset: Cung cấp nhiều mốc kích thước để trình duyệt tự chọn */
  getRetinaSrcset(photo: GalleryPhoto): string {
    if (!photo || this.isVideo(photo) || photo.mediaId.startsWith('demo') || photo._mainError) return '';
    const s800 = this.driveService.getHighResUrl(photo, 800);
    const s1440 = this.driveService.getHighResUrl(photo, 1440);
    const s2160 = this.driveService.getHighResUrl(photo, 2160);
    return `${s800} 800w, ${s1440} 1440w, ${s2160} 2160w`;
  }

  getSizesAttr(): string {
    return "(max-width: 768px) 100vw, 80vw";
  }

  onImageLoad(mediaId: string) {
    if (mediaId) {
      this.loadedImages.update(set => {
        const newSet = new Set(set);
        newSet.add(mediaId);
        return newSet;
      });
    }
  }

  /** Lightbox: 2560px cho zoom */
  getLightboxSrc(photo: GalleryPhoto): string {
    if (!photo) return '';
    if (photo.mediaId.startsWith('demo')) return photo.mediaUrl;
    return this.driveService.getLightboxUrl(photo);
  }

  getVideoPreviewSrc(photo: GalleryPhoto): string {
    if (!photo) return '';
    const src = this.getVideoSrc(photo);
    if (!src) return '';
    return src.includes('#') ? src : `${src}#t=0.001`;
  }

  /** Ảnh chất lượng cao nhất cho luồng xem theo phiên (2560px / Gốc HD) */
  getSessionPhotoSrc(photo: GalleryPhoto | null | undefined): string {
    if (!photo) return '';
    if (this.isVideo(photo)) return this.VIDEO_FALLBACK_SVG;
    return this.getLightboxSrc(photo);
  }

  /** Grid preview: 2560px ảnh gốc sắc nét, video fallback SVG nếu render thẻ img */
  getPreviewSrc(photo: GalleryPhoto): string {
    if (!photo) return '';
    if (this.isVideo(photo)) return this.VIDEO_FALLBACK_SVG;
    if (this.isSingleSession()) return this.getLightboxSrc(photo);
    return photo.thumbnailUrl || this.getLightboxSrc(photo);
  }

  readonly VIDEO_FALLBACK_SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%231a1a24"/><circle cx="150" cy="150" r="42" fill="%23d4af37" opacity="0.85"/><polygon points="142,135 166,150 142,165" fill="%23ffffff"/><text x="150" y="222" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="14" font-weight="700" fill="%23d4af37" text-anchor="middle" letter-spacing="1">VIDEO BTS</text></svg>';

  getVideoFallbackThumb(_photo: GalleryPhoto): string {
    return this.VIDEO_FALLBACK_SVG;
  }

  /** Thumbnail: s200-rw (nhẹ, WebP) cho ảnh, SVG cho video */
  getThumbSrc(photo: GalleryPhoto): string {
    if (!photo) return '';
    if (this.isVideo(photo)) return this.VIDEO_FALLBACK_SVG;
    if (photo.mediaId.startsWith('demo')) return photo.thumbnailUrl;
    if (photo._thumbError) return this.driveService.getHighResUrl(photo, 400);
    return this.driveService.getThumbnailUrl(photo);
  }

  // ========== ERROR HANDLING ==========

  onThumbError(photo: GalleryPhoto) {
    if (!photo || this.isVideo(photo)) return;

    if (!photo._thumbError) {
      photo._thumbError = true;
      this.photos.update(pts => [...pts]);
    }
  }

  onMainError(photo: GalleryPhoto) {
    if (!photo._mainError) {
      photo._mainError = true;
      this.photos.update(pts => [...pts]);
    }
  }

  // ========== LRU CACHE + PREDICTIVE PRELOAD ==========

  /**
   * Preload 1 ảnh vào LRU Cache + gọi decode() trước để 0 jank khi chuyển ảnh.
   * Cache giữ tối đa MAX_CACHE ảnh, evict ảnh cũ nhất khi đầy.
   */
  private preloadSingle(photo: GalleryPhoto, size: number = 2560) {
    // Video playback is intentionally user initiated. Preloading it as an
    // Image would request a poster/HTML response and waste bandwidth.
    if (!photo || this.isVideo(photo)) return;
    const url = (this.isSingleSession() || size >= 2160)
      ? this.getLightboxSrc(photo)
      : (size <= 1080 ? this.getPhotoSrc(photo) : this.driveService.getHighResUrl(photo, size));
    if (!url) return;

    // LRU touch: di chuyển về cuối Map nếu đã có
    if (this.lruCache.has(url)) {
      const img = this.lruCache.get(url)!;
      this.lruCache.delete(url);
      this.lruCache.set(url, img);
      return;
    }

    const img = new Image();
    img.src = url;
    // decode() ngầm → đảm bảo GPU đã giải mã xong pixel trước khi hiển thị → 0 giật frame
    img.decode().catch(() => {});

    this.lruCache.set(url, img);

    // Evict ảnh cũ nhất nếu vượt ngưỡng
    while (this.lruCache.size > this.MAX_CACHE) {
      const oldestKey = this.lruCache.keys().next().value;
      if (oldestKey) this.lruCache.delete(oldestKey);
      else break;
    }
  }
}

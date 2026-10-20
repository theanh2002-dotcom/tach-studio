import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface GallerySessionInfo {
  sessionId: string;
  sessionNumber: number;
  timeFormatted: string;
  shotCount: number;
  hasBts: boolean;
  totalMediaCount: number;
}

export interface GalleryPhoto {
  // This is an opaque public media handle, never a Google Drive file id.
  mediaId: string;
  name: string;
  kind: 'image' | 'video';
  mimeType?: string;
  role?: 'final' | 'shot' | 'bts' | string;
  slotIndex?: number | null;
  sessionId?: string | null;
  sessionInfo?: GallerySessionInfo;
  createdTime: string;
  thumbnailUrl: string;
  mediaUrl: string;
  lightboxUrl: string;
  downloadUrl: string;
  isNew?: boolean;
  _thumbError?: boolean;
  _mainError?: boolean;
  _videoThumbRetries?: number;
}

export interface GallerySession {
  sessionId: string;
  sessionNumber: number;
  timestamp: number;
  timeFormatted: string;
  finalPhoto?: GalleryPhoto;
  shots: GalleryPhoto[];
  btsVideo?: GalleryPhoto;
  allMedia: GalleryPhoto[];
  mediaCount: number;
}

interface PublicGalleryMedia {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mimeType?: string;
  role?: string;
  slotIndex?: number | null;
  sessionId?: string | null;
  sessionInfo?: GallerySessionInfo;
  createdAt: string;
  thumbnailUrl: string;
  mediaUrl: string;
  lightboxUrl: string;
  downloadUrl: string;
}

interface PublicGalleryResponse {
  mode?: 'SESSION' | 'EVENT' | 'LEGACY';
  status?: 'PENDING' | 'READY';
  pollAfterMs?: number | null;
  nextCursor?: string | null;
  sessions?: any[];
  items?: PublicGalleryMedia[];
}

export interface GalleryLoadResult {
  mode: 'SESSION' | 'EVENT' | 'LEGACY';
  status: 'PENDING' | 'READY';
  pollAfterMs: number | null;
  nextCursor: string | null;
  sessions: GallerySession[];
  photos: GalleryPhoto[];
}

/**
 * Public gallery client.
 *
 * Google Drive is resolved by the server-side gallery API. The browser only
 * receives sanitized media metadata and opaque Cloudflare media URLs; it does
 * not carry an API key or provider-specific file metadata.
 */
@Injectable({
  providedIn: 'root'
})
export class GoogleDriveGalleryService {
  private legacyQueryValue: string | null = null;
  private sessionPublicId: string | null = null;

  constructor(private http: HttpClient) {}

  /** Reads the manifest id carried by the desktop-generated QR link. */
  setRouteQuery(manifestId: string | null, sessionPublicId: string | null) {
    this.legacyQueryValue = manifestId;
    this.sessionPublicId = sessionPublicId;
  }

  listPhotosInFolder(publicGalleryId: string, cursor: string | null = null): Observable<GalleryLoadResult> {
    let params = new HttpParams().set('id', publicGalleryId);
    if (this.legacyQueryValue) params = params.set('m', this.legacyQueryValue);
    if (this.sessionPublicId) params = params.set('s', this.sessionPublicId);
    if (cursor) params = params.set('cursor', cursor);

    return this.http.get<PublicGalleryResponse | PublicGalleryMedia[]>('/api/gallery', { params }).pipe(
      map(response => {
        const items = Array.isArray(response) ? response : (response?.items || []);
        const rawSessions = Array.isArray(response) ? [] : (response?.sessions || []);
        const sessions = rawSessions.map((s: any) => this.fromPublicSession(s));
        return {
          mode: Array.isArray(response) ? 'LEGACY' : (response.mode || 'LEGACY'),
          status: Array.isArray(response) ? 'READY' : (response.status || 'READY'),
          pollAfterMs: Array.isArray(response) ? null : (response.pollAfterMs ?? null),
          nextCursor: Array.isArray(response) ? null : (response.nextCursor ?? null),
          sessions,
          photos: items.map(item => this.fromPublicMedia(item))
        } as GalleryLoadResult;
      })
    );
  }

  isVideo(photo: GalleryPhoto | null | undefined): boolean {
    if (!photo) return false;
    return photo.kind === 'video' || photo.mimeType?.toLowerCase().startsWith('video/') === true;
  }

  /** Browser playback URL supplied by the server-side gallery API. */
  getVideoUrl(photo: GalleryPhoto): string {
    return photo?.mediaUrl || '';
  }

  getHighResUrl(photo: GalleryPhoto, _size: number = 1440): string {
    return photo?.mediaUrl || '';
  }

  getLightboxUrl(photo: GalleryPhoto): string {
    return photo?.lightboxUrl || photo?.mediaUrl || '';
  }

  getThumbnailUrl(photo: GalleryPhoto): string {
    return photo?.thumbnailUrl || photo?.mediaUrl || '';
  }

  getDownloadUrl(photo: GalleryPhoto): string {
    return photo?.downloadUrl || photo?.mediaUrl || '';
  }

  private fromPublicMedia(item: PublicGalleryMedia): GalleryPhoto {
    return {
      mediaId: item.id,
      name: item.name || (item.kind === 'video' ? 'Video sự kiện' : 'Ảnh sự kiện'),
      kind: item.kind === 'video' ? 'video' : 'image',
      mimeType: item.mimeType,
      role: item.role,
      slotIndex: item.slotIndex,
      sessionId: item.sessionId,
      sessionInfo: item.sessionInfo,
      createdTime: item.createdAt || new Date().toISOString(),
      thumbnailUrl: item.thumbnailUrl || item.mediaUrl,
      mediaUrl: item.mediaUrl,
      lightboxUrl: item.lightboxUrl || item.mediaUrl,
      downloadUrl: item.downloadUrl || item.mediaUrl
    };
  }

  fromPublicSession(item: any): GallerySession {
    const finalPhoto = item?.finalPhoto ? this.fromPublicMedia(item.finalPhoto) : undefined;
    const shots = Array.isArray(item?.shots) ? item.shots.map((s: any) => this.fromPublicMedia(s)) : [];
    const btsVideo = item?.btsVideo ? this.fromPublicMedia(item.btsVideo) : undefined;
    const allMedia = Array.isArray(item?.allMedia) ? item.allMedia.map((m: any) => this.fromPublicMedia(m)) : [];

    return {
      sessionId: item?.sessionId || '',
      sessionNumber: item?.sessionNumber || 1,
      timestamp: item?.timestamp || 0,
      timeFormatted: item?.timeFormatted || '',
      finalPhoto,
      shots,
      btsVideo,
      allMedia: allMedia.length > 0 ? allMedia : ([finalPhoto, ...shots, btsVideo].filter(Boolean) as GalleryPhoto[]),
      mediaCount: item?.mediaCount || allMedia.length
    };
  }
}

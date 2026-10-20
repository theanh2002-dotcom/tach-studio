import { ChangeDetectorRef, Component, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

interface SelectedPhotoItem {
  file: File;
  quantity: number;
  previewUrl: string;
}

@Component({
  selector: 'app-print-order',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './print-order.html',
  styleUrl: './print-order.scss'
})
export class PrintOrder implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly requestTimeoutMs = 30_000;
  private readonly uploadTimeoutMs = 15 * 60_000;
  private readonly maxFileSizeBytes = 100 * 1024 * 1024; // 100 MB
  private readonly rawExtensions = new Set([
    '3fr', 'arw', 'cr2', 'cr3', 'dcr', 'dng', 'erf', 'iiq', 'k25', 'kdc',
    'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef', 'raf', 'raw', 'rw2',
    'rwl', 'sr2', 'srf', 'srw', 'x3f'
  ]);

  clientName = '';
  clientPhone = '';
  selectedPhotos: SelectedPhotoItem[] = [];

  isSubmitting = false;
  isSuccess = false;
  errorMessage = '';

  uploadProgress = 0; // percentage
  currentUploadingIndex = 0;
  currentUploadingFileName = '';

  get totalQuantity(): number {
    return this.selectedPhotos.reduce((sum, item) => sum + item.quantity, 0);
  }

  get unitPrice(): number {
    return this.totalQuantity > 5 ? 15000 : 20000;
  }

  get totalPrice(): number {
    return this.totalQuantity * this.unitPrice;
  }

  get discountApplied(): boolean {
    return this.totalQuantity > 5;
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      const filesArray = Array.from(input.files);
      const imageFiles = filesArray.filter(file =>
        this.isSupportedImage(file) && file.size <= this.maxFileSizeBytes
      );
      const rejectedFiles = filesArray.filter(file =>
        this.isSupportedImage(file) && file.size > this.maxFileSizeBytes
      );
      const unsupportedFiles = filesArray.filter(file => !this.isSupportedImage(file));

      const newItems: SelectedPhotoItem[] = imageFiles.map(file => {
        let previewUrl = '';
        if (file.type.startsWith('image/')) {
          try {
            previewUrl = URL.createObjectURL(file);
          } catch {
            previewUrl = '';
          }
        }
        return { file, quantity: 1, previewUrl };
      });

      this.selectedPhotos = [...this.selectedPhotos, ...newItems];

      const errors = [];
      if (rejectedFiles.length > 0) {
        errors.push(`Ảnh vượt quá 100 MB: ${rejectedFiles.map(file => file.name).join(', ')}`);
      }
      if (unsupportedFiles.length > 0) {
        errors.push(`Định dạng không được hỗ trợ: ${unsupportedFiles.map(file => file.name).join(', ')}`);
      }
      this.errorMessage = errors.join(' ');
      input.value = '';
      this.cdr.markForCheck();
    }
  }

  private isSupportedImage(file: File): boolean {
    if (file.type.startsWith('image/')) return true;
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    return this.rawExtensions.has(extension);
  }

  removeFile(index: number) {
    const item = this.selectedPhotos[index];
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
    this.selectedPhotos.splice(index, 1);
  }

  decreaseQty(index: number) {
    if (this.selectedPhotos[index].quantity > 1) {
      this.selectedPhotos[index].quantity--;
    }
  }

  increaseQty(index: number) {
    this.selectedPhotos[index].quantity++;
  }

  async submitOrder() {
    if (!this.clientName.trim()) {
      this.errorMessage = 'Vui lòng nhập họ tên của bạn.';
      return;
    }
    if (!this.clientPhone.trim()) {
      this.errorMessage = 'Vui lòng nhập số điện thoại để Tách Tách liên hệ.';
      return;
    }
    const phoneRegex = /^0\d{9}$/;
    if (!phoneRegex.test(this.clientPhone.trim())) {
      this.errorMessage = 'Số điện thoại không hợp lệ (phải bắt đầu bằng số 0 và gồm đúng 10 chữ số).';
      return;
    }
    if (this.selectedPhotos.length === 0) {
      this.errorMessage = 'Vui lòng chọn ít nhất 1 bức ảnh để gửi in.';
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;
    this.uploadProgress = 0;
    this.currentUploadingIndex = 0;

    try {
      // 1. Tạo thư mục trên Google Drive của studio
      const folderRes = await this.fetchWithTimeout('/api/create-upload-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.clientName, phone: this.clientPhone })
      });
      if (!folderRes.ok) {
        throw new Error(await this.getApiError(folderRes, 'Không thể chuẩn bị thư mục lưu ảnh. Vui lòng kiểm tra kết nối mạng.'));
      }
      const folderData = await folderRes.json();
      const uploadSessionToken = folderData.uploadSessionToken;
      if (!uploadSessionToken) throw new Error('Phiên tải ảnh không hợp lệ.');

      // 2. Upload tuần tự từng file nhị phân qua Cloudflare Worker Resumable Tunnel
      const totalItems = this.selectedPhotos.length;
      for (let i = 0; i < totalItems; i++) {
        this.currentUploadingIndex = i + 1;
        const item = this.selectedPhotos[i];
        const file = item.file;
        const qty = item.quantity;
        this.currentUploadingFileName = file.name;
        this.cdr.markForCheck();

        const dotIndex = file.name.lastIndexOf('.');
        const baseName = dotIndex !== -1 ? file.name.substring(0, dotIndex) : file.name;
        const extension = dotIndex !== -1 ? file.name.substring(dotIndex) : '';
        const driveFileName = `${baseName}_x${qty}${extension}`;

        const sessionRes = await this.fetchWithTimeout('/api/create-upload-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadSessionToken,
            fileName: driveFileName,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size
          })
        });

        if (!sessionRes.ok) {
          throw new Error(await this.getApiError(sessionRes, `Không thể chuẩn bị tải file: ${file.name}`));
        }
        const { uploadUrl } = await sessionRes.json();

        await this.uploadFile(uploadUrl, file, i, totalItems);
      }

      // 3. Hoàn tất đơn và gửi thông báo Telegram cho studio
      const submitRes = await this.fetchWithTimeout('/api/submit-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.clientName,
          phone: this.clientPhone,
          quantity: this.totalQuantity,
          uniquePhotos: totalItems,
          uploadSessionToken,
          photos: this.selectedPhotos.map(item => ({
            name: item.file.name,
            quantity: item.quantity
          }))
        })
      });

      if (!submitRes.ok) {
        throw new Error(await this.getApiError(submitRes, 'Đã tải ảnh lên thành công nhưng gặp sự cố khi gửi thông báo đơn hàng.'));
      }

      this.isSuccess = true;
      this.cleanupPreviews();
      this.selectedPhotos = [];
      this.clientName = '';
      this.clientPhone = '';
    } catch (err: any) {
      this.errorMessage = err?.name === 'AbortError'
        ? 'Kết nối quá thời gian chờ. Vui lòng kiểm tra lại đường truyền mạng!'
        : err.message || 'Có lỗi xảy ra trong quá trình gửi ảnh. Vui lòng thử lại!';
    } finally {
      this.isSubmitting = false;
      this.currentUploadingFileName = '';
      this.cdr.markForCheck();
    }
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async getApiError(response: Response, fallback: string): Promise<string> {
    try {
      const data = await response.json();
      return data.message || data.error || fallback;
    } catch {
      return fallback;
    }
  }

  private uploadFile(uploadUrl: string, file: File, index: number, totalItems: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.timeout = this.uploadTimeoutMs;
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const completed = index + event.loaded / event.total;
        this.uploadProgress = Math.min(100, Math.round((completed / totalItems) * 100));
        this.cdr.markForCheck();
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          this.uploadProgress = Math.round(((index + 1) / totalItems) * 100);
          this.cdr.markForCheck();
          resolve();
          return;
        }

        reject(new Error(`Tải file thất bại (${xhr.status}): ${file.name}`));
      };
      xhr.onerror = () => reject(new Error(`Mất kết nối khi tải ảnh: ${file.name}`));
      xhr.ontimeout = () => reject(new Error(`Tải ảnh quá thời gian chờ: ${file.name}`));
      xhr.send(file);
    });
  }

  resetOrder() {
    this.isSuccess = false;
    this.errorMessage = '';
    this.uploadProgress = 0;
  }

  private cleanupPreviews() {
    for (const item of this.selectedPhotos) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }

  ngOnDestroy() {
    this.cleanupPreviews();
  }
}

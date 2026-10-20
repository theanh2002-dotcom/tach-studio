import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [CommonModule, RouterModule],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {
  packages = [
    {
      name: 'Gói Basic — Solo & Couple',
      subtitle: 'Dành cho 1 - 2 người',
      price: '99.000đ',
      duration: '15 phút',
      prints: '2 dải ảnh Photostrip (1x4) hoặc 2 ảnh vuông (2x2)',
      popular: false,
      features: [
        '100% không gian phòng chụp riêng tư',
        'Tự do tạo dáng, remote bấm chụp không giới hạn',
        'Dàn đèn flash studio Softbox da trắng hồng',
        'Sử dụng toàn bộ kho phụ kiện props hơn 200+ món',
        'In ảnh sắc nét lấy ngay sau 30 giây',
        'Quét QR nhận toàn bộ ảnh gốc Full HD + video BTS hậu trường'
      ]
    },
    {
      name: 'Gói Nhóm Bạn Thân',
      subtitle: 'Dành cho 3 - 4 người',
      price: '149.000đ',
      duration: '25 phút',
      prints: '4 dải ảnh Photostrip cao cấp',
      popular: true,
      features: [
        'Phòng chụp rộng rãi, điều hoà mát lạnh',
        'Bấm remote không giới hạn số lượng shoot chụp',
        'Được đổi 2 màu phông nền tùy thích trong buổi',
        'Kho phụ kiện kính, mũ, bờm thú Y2K hot trend',
        'In mỗi bạn 1 dải ảnh kỷ niệm mang về',
        'Tải trọn bộ ảnh gốc Full HD + video BTS chuyển động'
      ]
    },
    {
      name: 'Gói Big Group & Sinh Nhật',
      subtitle: 'Dành cho 5 - 8 người',
      price: '199.000đ',
      duration: '35 phút',
      prints: '6 - 8 dải ảnh + 1 ảnh Polaroid phóng lớn',
      popular: false,
      features: [
        'Không gian thoải mái cho cả hội bạn hoặc gia đình',
        'Góc máy ống kính góc rộng chụp đủ mọi thành viên',
        'Hỗ trợ setup khung frame thiết kế riêng theo tên sự kiện',
        'Tất cả thành viên đều có ảnh in chất lượng cao mang về',
        'Miễn phí file gốc toàn bộ phiên chụp không nén',
        'Hỗ trợ xuất video BTS ghép nhạc xịn xò'
      ]
    }
  ];

  studioHighlights = [
    {
      icon: '🔒',
      title: 'Phòng Riêng Tư 100%',
      desc: 'Phòng chụp khép kín có rèm che, máy lạnh mát rượi và loa bluetooth tự bật bài hát yêu thích. Tha hồ bung xõa tạo dáng mà không sợ ngại ngùng.'
    },
    {
      icon: '✨',
      title: 'Ánh Sáng Nịnh Da Chuẩn Pro',
      desc: 'Hệ thống đèn Flash tản sáng Softbox chuyên nghiệp cho làn da trắng mịn, đôi mắt long lanh tự nhiên, chụp lên đẹp ngay không cần filter chỉnh sửa.'
    },
    {
      icon: '📸',
      title: 'Màn Hình Xem Dáng & Remote Tay',
      desc: 'Màn hình Live-View đặt ngang tầm mắt giúp bạn căn góc chụp chuẩn xác. Cầm remote không dây trên tay và chủ động bấm "Tách Tách" theo ý muốn.'
    },
    {
      icon: '🎀',
      title: 'Kho 200+ Phụ Kiện Đạo Cụ',
      desc: 'Bộ sưu tập khổng lồ gồm kính râm Y2K, bờm gấu dâu, tai thú, hoa tulip vintage, máy ảnh retro, mũ tiệc sinh nhật được khử khuẩn sạch sẽ mỗi ngày.'
    }
  ];

  steps = [
    {
      step: '01',
      title: 'Chọn Phụ Kiện & Phông Nền',
      desc: 'Ghé khu vực trang điểm, chọn phụ kiện yêu thích và chọn tone phông nền hợp với outfit hôm nay.'
    },
    {
      step: '02',
      title: 'Tự Do Bấm Remote "Tách Tách"',
      desc: 'Bước vào phòng riêng, nhìn màn hình live-view để ngắm dáng và tự tin bấm remote không dây chụp thoả thích.'
    },
    {
      step: '03',
      title: 'Chọn Ảnh & In Liền 30s',
      desc: 'Lựa chọn các shoot hình ưng ý nhất, áp khung frame xinh xắn và nhận bản in ảnh sắc nét bền màu sau 30 giây.'
    },
    {
      step: '04',
      title: 'Quét Mã QR Nhận Ảnh & Video',
      desc: 'Quét mã QR in trên ảnh hoặc trên màn hình để tải ngay trọn bộ ảnh gốc chất lượng cao và video hậu trường vào điện thoại.'
    }
  ];
}

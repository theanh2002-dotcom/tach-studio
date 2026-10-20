import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-studio-showcase',
  imports: [CommonModule, RouterModule],
  templateUrl: './studio-showcase.html',
  styleUrl: './studio-showcase.scss'
})
export class StudioShowcase {
  equipmentList = [
    {
      title: 'Máy Ảnh Canon Full-Frame',
      desc: 'Sử dụng hệ máy chuyên nghiệp với cảm biến lớn giúp từng chi tiết ánh mắt, sợi tóc và trang phục đều sắc nét đến hoàn hảo.',
      icon: '📷'
    },
    {
      title: 'Màn Hình Live-View Thời Gian Thực',
      desc: 'Màn hình độ nét cao đặt ngang tầm mắt giúp bạn nhìn rõ tư thế, dáng đứng và biểu cảm trước khi bấm nút.',
      icon: '🖥️'
    },
    {
      title: 'Dàn Đèn Flash & Softbox Nịnh Da',
      desc: 'Được căn chỉnh nhiệt độ màu chuẩn 5600K tự nhiên. Ánh sáng mềm mại tôn làn da trắng hồng mà không lo lóa mắt.',
      icon: '💡'
    },
    {
      title: 'Remote Bấm Chụp Không Dây',
      desc: 'Nhỏ gọn nằm lọt trong lòng bàn tay. Bạn chủ động tạo dáng và bấm "Tách Tách" đúng khoảnh khắc ưng ý nhất.',
      icon: '🕹️'
    },
    {
      title: 'Máy In Ảnh Nhiệt DNP Chuẩn Studio',
      desc: 'Công nghệ in nhuộm thăng hoa nhiệt cao cấp, tự động cán màng bảo vệ chống nước, chống xước, lưu giữ kỷ niệm 50+ năm.',
      icon: '🖨️'
    },
    {
      title: 'Không Gian Kín Đáo & Âm Nhạc Riêng',
      desc: 'Phòng khép kín có điều hòa mát mẻ, rèm che riêng tư và loa Bluetooth cho phép bạn tự kết nối mở playlist yêu thích.',
      icon: '🎵'
    }
  ];

  backdrops = [
    {
      name: 'Kem Ấm Vintage',
      tag: 'Signature Tách Tách',
      colorCode: '#F4ECE1',
      borderCode: '#C89965',
      desc: 'Tông màu chủ đạo của Tách Tách mang hơi hướng retro, ấm áp, cực kỳ hợp với trang phục phong cách cổ điển, be, nâu.'
    },
    {
      name: 'Xám Xi Măng Hàn Quốc',
      tag: 'Korean Minimalist',
      colorCode: '#D8D9DB',
      borderCode: '#A0A2A6',
      desc: 'Tông màu quốc dân của các bốt chụp ảnh Seoul, tôn dáng hiện đại, thanh lịch và làm nổi bật màu sắc trang phục.'
    },
    {
      name: 'Hồng Pastel Ngọt Ngào',
      tag: 'Sweet Barbie',
      colorCode: '#F8D7DA',
      borderCode: '#E39DA6',
      desc: 'Dành cho các nàng thơ yêu thích phong cách kẹo ngọt, chụp đôi bạn thân, chụp sinh nhật nữ tính.'
    },
    {
      name: 'Xanh Mint Dịu Mắt',
      tag: 'Fresh Summer',
      colorCode: '#D1E7DD',
      borderCode: '#8FBFA8',
      desc: 'Mang lại cảm giác tươi trẻ, mát mẻ, tràn đầy năng lượng thanh xuân và phong cách Y2K tươi mới.'
    },
    {
      name: 'Đen Trắng Nghệ Thuật',
      tag: 'Classic Noir',
      colorCode: '#2B2B2B',
      borderCode: '#666666',
      textColor: '#FFFFFF',
      desc: 'Phong cách ảnh chân dung đen trắng nghệ thuật, chiều sâu điện ảnh, siêu cuốn hút và cá tính.'
    }
  ];

  propsCategories = [
    {
      name: 'Kính Mắt & Kính Y2K',
      count: '60+ mẫu',
      items: ['Kính râm gọng dày Y2K', 'Kính mắt mèo retro', 'Kính trái tim phát sáng', 'Kính ngộ nghĩnh pixel']
    },
    {
      name: 'Bờm & Mũ Thú Cưng',
      count: '70+ mẫu',
      items: ['Bờm gấu dâu Lotso', 'Mũ ếch xanh Pepe', 'Tai thỏ nhung cử động', 'Mũ sinh nhật bánh kem']
    },
    {
      name: 'Đạo Cụ Cầm Tay',
      count: '50+ mẫu',
      items: ['Bó hoa tulip vintage', 'Máy quay phim cổ điển', 'Bảng chữ cầm tay', 'Súng bắn tiền & bong bóng']
    },
    {
      name: 'Bàn Trang Điểm & Phụ Trợ',
      count: 'Đầy đủ tiện ích',
      items: ['Máy uốn tóc & lược chải', 'Gương soi đèn LED', 'Xịt thơm & khăn lau', 'Kẹp tóc & nơ xinh xắn']
    }
  ];

  frameStyles = [
    {
      name: 'Dải Ảnh Dọc 1x4 (Photostrip)',
      desc: 'Khung ảnh kinh điển 4 ô dọc, kích thước 5x15cm. Hoàn hảo để kẹp ốp lưng điện thoại hoặc kẹp vào sổ nhật ký.',
      ratio: '1x4'
    },
    {
      name: 'Lưới Vuông 2x2 (Grid Y2K)',
      desc: 'Bố cục 4 ô vuông kích thước 10x15cm, phong cách hiện đại giúp bắt trọn 4 sắc thái cảm xúc đa dạng.',
      ratio: '2x2'
    },
    {
      name: 'Khung Polaroid Cỡ Lớn',
      desc: 'Khung ảnh đơn hoặc đôi với viền chữ retro Tách Tách Signature, không gian rộng rãi ghi ngày kỷ niệm.',
      ratio: 'Wide'
    }
  ];
}
